import { randomUUID } from 'node:crypto';
import { ApiError } from '../lib/errors';
import { log } from '../lib/logger';
import { ProviderHttpError } from '../providers/httpClient';
import { runImport } from '../providers/importService';
import { runSync } from '../providers/sync';
import type { JobPayload, JobQueue, QueuedJobRow } from './queue';

export interface WorkerOptions {
  workerId?: string;
  queue: JobQueue;
  /** Claim lease duration. Must exceed the heartbeat interval. */
  leaseMs?: number;
  /** Idle delay between empty polls. */
  pollIntervalMs?: number;
  /** Heartbeat cadence while a job executes. */
  heartbeatMs?: number;
  /** Max time to wait for an active job on shutdown. */
  shutdownTimeoutMs?: number;
  /** Minimum gap between jobs for the same provider (0 disables). */
  providerMinIntervalMs?: number;
  /** Disable process signal handling (tests). */
  signals?: boolean;
}

export interface TickResult {
  processed: boolean;
  jobId?: string;
  status?: string;
}

/** Per-provider throttle so concurrent jobs never storm a provider API. */
export class ProviderThrottle {
  private readonly lastStart = new Map<string, number>();

  constructor(private readonly minIntervalMs: number) {}

  async acquire(provider: string): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const wait = this.minIntervalMs - (Date.now() - (this.lastStart.get(provider) ?? 0));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastStart.set(provider, Date.now());
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof ProviderHttpError) return error.retryable;
  if (error instanceof ApiError) {
    if (error.status === 501) return false;
    return error.status === 429 || error.status >= 500;
  }
  // Unknown failures are treated as transient — attempts stay bounded.
  return true;
}

function backoffMs(attempts: number, baseMs = 1000, maxMs = 300_000): number {
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1) + jitter);
}

export class SyncWorker {
  readonly workerId: string;
  private readonly queue: JobQueue;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly heartbeatMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly throttle: ProviderThrottle;
  private running = false;
  private stopping = false;
  private activeJob: QueuedJobRow | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: WorkerOptions) {
    this.workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
    this.queue = options.queue;
    this.leaseMs = options.leaseMs ?? 120_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 60_000;
    this.throttle = new ProviderThrottle(options.providerMinIntervalMs ?? 0);
    if (options.signals !== false) {
      process.once('SIGTERM', () => void this.stop());
      process.once('SIGINT', () => void this.stop());
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    log({ msg: 'worker_started', workerId: this.workerId });
    void this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running && !this.activeJob) return;
    this.stopping = true;
    log({ msg: 'worker_stopping', workerId: this.workerId });
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const deadline = Date.now() + this.shutdownTimeoutMs;
    while (this.activeJob && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.activeJob) {
      // Abandon the claim; the expired lease makes the job recoverable.
      await this.queue.release(this.activeJob.id, this.workerId).catch(() => undefined);
      log({ msg: 'worker_abandoned_job', workerId: this.workerId, jobId: this.activeJob.id });
      this.activeJob = null;
    }
    this.running = false;
    log({ msg: 'worker_stopped', workerId: this.workerId });
  }

  private async loop(): Promise<void> {
    while (this.running && !this.stopping) {
      try {
        const tick = await this.tick();
        if (!tick.processed) {
          await new Promise((resolve) => {
            this.timer = setTimeout(resolve, this.pollIntervalMs);
          });
        }
      } catch (error) {
        log({ msg: 'worker_tick_failed', workerId: this.workerId });
        void error;
      }
    }
  }

  /** Single poll→claim→execute cycle. Directly testable without timers. */
  async tick(): Promise<TickResult> {
    if (this.stopping) return { processed: false };
    const claimed = await this.queue.claim(this.workerId, this.leaseMs);
    if (!claimed) return { processed: false };
    this.activeJob = claimed;
    const startedAt = Date.now();
    const queueLatencyMs = startedAt - Date.parse(claimed.created_at);
    log({ msg: 'job_claimed', workerId: this.workerId, jobId: claimed.id, queueLatencyMs });
    const heartbeat = setInterval(() => {
      this.queue.heartbeat(claimed.id, this.workerId, this.leaseMs).catch(() => undefined);
    }, this.heartbeatMs);
    heartbeat.unref?.();
    try {
      const status = await this.execute(claimed);
      log({
        msg: 'job_completed',
        workerId: this.workerId,
        jobId: claimed.id,
        status,
        durationMs: Date.now() - startedAt,
      });
      return { processed: true, jobId: claimed.id, status };
    } catch (error) {
      const status = await this.handleFailure(claimed, error);
      log({
        msg: 'job_failed',
        workerId: this.workerId,
        jobId: claimed.id,
        status,
        durationMs: Date.now() - startedAt,
      });
      return { processed: true, jobId: claimed.id, status };
    } finally {
      clearInterval(heartbeat);
      await this.queue.release(claimed.id, this.workerId).catch(() => undefined);
      if (this.activeJob?.id === claimed.id) this.activeJob = null;
    }
  }

  private async execute(job: QueuedJobRow): Promise<string> {
    const payload = job.payload as JobPayload | null;
    if (!payload || (payload.kind !== 'sync' && payload.kind !== 'import')) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Job payload is invalid');
    }
    const provider =
      (payload.dataSource as { provider?: string } | undefined)?.provider ?? 'unknown';
    await this.throttle.acquire(provider);
    if (payload.kind === 'sync') {
      const summary = await runSync({
        dataSource: payload.dataSource,
        jobType: job.job_type,
        entityType: payload.entityType,
        params: payload.params,
        limit: payload.limit,
        batchSize: payload.batchSize,
        jobId: job.id,
        fetchErrorMode: 'throw',
      });
      return summary.status;
    }
    const report = await runImport({
      provider: payload.dataSource.provider,
      dataSourceId: payload.dataSource.id,
      entities: payload.entities,
      limit: payload.limit,
      batchSize: payload.batchSize,
      params: payload.params,
      parentJobId: job.id,
    });
    return report.stages.every((stage) => stage.status === 'completed')
      ? 'completed'
      : report.stages.some((stage) => stage.status === 'failed')
        ? 'failed'
        : 'partial';
  }

  private async handleFailure(job: QueuedJobRow, error: unknown): Promise<string> {
    // claim() already incremented attempts for this execution, so use it directly.
    const attempts = job.attempts ?? 0;
    if (isTransient(error) && attempts < (job.max_attempts ?? 5)) {
      const runAfter = new Date(Date.now() + backoffMs(attempts));
      await this.queue.requeue(job.id, this.workerId, runAfter);
      log({ msg: 'job_retry', workerId: this.workerId, jobId: job.id, attempts });
      return 'queued';
    }
    const message = error instanceof Error ? error.message : 'Job failed';
    const { serviceClient } = await import('../lib/supabase');
    const client = serviceClient();
    await client.from('sync_errors').insert({
      sync_job_id: job.id,
      entity_type: job.entity_type,
      error_code: error instanceof ApiError ? error.code : 'WORKER_ERROR',
      error_message: message.slice(0, 1000) || 'Job failed',
    });
    await client
      .from('sync_jobs')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: message.slice(0, 1000) })
      .eq('id', job.id);
    return 'failed';
  }
}

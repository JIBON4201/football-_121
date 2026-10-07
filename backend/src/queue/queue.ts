import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError, badRequest, notFound, upstream } from '../lib/errors';
import type { DbClient } from '../lib/supabase';
import { IMPORT_ORDER } from '../providers/importService';
import { getDataSource } from '../providers/registry';
import type { SyncEntityType } from '../providers/types';

/** Public priority levels. Lower stored value dequeues first. */
export const JOB_PRIORITIES = { high: 10, normal: 100, low: 1000 } as const;
export type JobPriorityName = keyof typeof JOB_PRIORITIES;

const SECRET_KEY = /api[_-]?key|token|secret|password|auth|cookie|credential|session/i;

function payloadHasSecrets(value: unknown, depth = 0): boolean {
  if (depth > 4 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => payloadHasSecrets(item, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) => SECRET_KEY.test(key) || payloadHasSecrets(item, depth + 1),
    );
  }
  return false;
}

const dataSourceRef = z
  .object({ id: z.string().uuid().optional(), provider: z.string().min(1).max(100).optional() })
  .refine((value) => value.id ?? value.provider, 'dataSource id or provider is required');

export const jobPayloadSchema = z.object({
  kind: z.enum(['sync', 'import']),
  dataSource: dataSourceRef,
  entityType: z.enum([...IMPORT_ORDER] as [SyncEntityType, ...SyncEntityType[]]).optional(),
  entities: z.array(z.enum([...IMPORT_ORDER] as [SyncEntityType, ...SyncEntityType[]])).max(12).optional(),
  jobType: z.string().min(1).max(100).default('queued'),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  batchSize: z.number().int().min(10).max(500).optional(),
  /** Set by the scheduler/enqueue path for duplicate detection. */
  idempotencyKey: z.string().min(1).max(64).optional(),
});

export type JobPayload = z.infer<typeof jobPayloadSchema>;

/** Deterministic idempotency key: same logical sync window → same key. */
export function idempotencyKeyFor(payload: JobPayload): string {
  const normalized = {
    kind: payload.kind,
    ds: payload.dataSource.id ?? payload.dataSource.provider ?? '',
    entity: payload.entityType ?? [...(payload.entities ?? [])].sort().join('+'),
    jobType: payload.jobType,
    limit: payload.limit ?? null,
    batchSize: payload.batchSize ?? null,
    params: Object.fromEntries(
      Object.entries(payload.params ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 32);
}

export interface EnqueueRequest extends JobPayload {
  /** Named level or raw 0-1000 value (lower dequeues first). */
  priority?: JobPriorityName | number;
  maxAttempts?: number;
}

export function resolveQueuePriority(priority?: JobPriorityName | number): number {
  if (typeof priority === 'number') {
    if (!Number.isFinite(priority)) return JOB_PRIORITIES.normal;
    return Math.min(1000, Math.max(0, Math.round(priority)));
  }
  return JOB_PRIORITIES[priority ?? 'normal'];
}

export interface QueuedJobRow {
  id: string;
  job_type: string;
  entity_type: string | null;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  claimed_by: string | null;
  lease_expires_at: string | null;
  run_after: string;
  cancel_requested: boolean;
  payload: JobPayload | null;
  data_source_id: string | null;
  created_at: string;
}

/** Queue contract. Business logic depends on this, never on a vendor. */
export interface JobQueue {
  enqueue(request: EnqueueRequest): Promise<{ jobId: string }>;
  claim(workerId: string, leaseMs: number): Promise<QueuedJobRow | null>;
  heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<void>;
  release(jobId: string, workerId: string): Promise<void>;
  requeue(jobId: string, workerId: string, runAfter: Date): Promise<void>;
  cancel(jobId: string): Promise<boolean>;
  get(jobId: string): Promise<QueuedJobRow>;
  workerHealth(): Promise<WorkerHealth>;
}

export interface WorkerHealth {
  queueReachable: boolean;
  activeJobs: number;
  staleJobs: number;
  failedLast24h: number;
  lastSuccessfulAt: string | null;
}

function toRow(data: unknown): QueuedJobRow {
  return data as QueuedJobRow;
}

/**
 * Durable Postgres-backed queue over sync_jobs. Claims are atomic
 * conditional updates (only one worker can win), never in-memory locks.
 */
export class SupabaseJobQueue implements JobQueue {
  constructor(private readonly client: DbClient) {}

  async enqueue(request: EnqueueRequest): Promise<{ jobId: string }> {
    const parsed = jobPayloadSchema.safeParse(request);
    if (!parsed.success) throw badRequest('Invalid job payload', parsed.error.flatten());
    if (payloadHasSecrets(request.params)) {
      throw badRequest('Job params must not contain secrets');
    }
    const maxAttempts = request.maxAttempts ?? 5;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw badRequest('maxAttempts must be an integer between 1 and 10');
    }
    const payload: JobPayload = parsed.data;
    if (payload.kind === 'sync' && !payload.entityType) {
      throw badRequest('entityType is required for sync jobs');
    }
    const dataSource = await getDataSource(this.client, payload.dataSource);
    if (!dataSource.is_active) throw badRequest('Data source is disabled');
    const { data, error } = await this.client
      .from('sync_jobs')
      .insert({
        data_source_id: dataSource.id,
        job_type: payload.jobType,
        entity_type: payload.entityType ?? null,
        status: 'queued',
        priority: resolveQueuePriority(request.priority),
        attempts: 0,
        max_attempts: maxAttempts,
        claimed_by: null,
        lease_expires_at: null,
        run_after: new Date().toISOString(),
        cancel_requested: false,
        payload,
      })
      .select('id');
    if (error || !data?.length) throw upstream('Job enqueue failed');
    return { jobId: String((data as Array<{ id: string }>)[0].id) };
  }

  /**
   * Claim one due job: queued rows first, then stale running rows whose
   * lease expired. Conditional UPDATEs make concurrent claims safe.
   */
  async claim(workerId: string, leaseMs: number): Promise<QueuedJobRow | null> {
    const now = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
    const candidates = await this.dueCandidates(now);
    for (const candidate of candidates) {
      const claimed = await this.tryClaim(candidate, workerId, leaseUntil, now);
      if (claimed) return claimed;
    }
    return null;
  }

  private async dueCandidates(now: string): Promise<QueuedJobRow[]> {
    const out: QueuedJobRow[] = [];
    const { data: queued } = await this.client
      .from('sync_jobs')
      .select('*')
      .eq('status', 'queued')
      .lte('run_after', now)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .range(0, 9);
    out.push(...(((queued as unknown[]) ?? []) as QueuedJobRow[]));
    const { data: stale } = await this.client
      .from('sync_jobs')
      .select('*')
      .eq('status', 'running')
      .lte('lease_expires_at', now)
      .lte('run_after', now)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .range(0, 9);
    out.push(...(((stale as unknown[]) ?? []) as QueuedJobRow[]));
    return out
      .filter((row) => (row.attempts ?? 0) < (row.max_attempts ?? 5) && !row.cancel_requested)
      .sort((a, b) => a.priority - b.priority || (a.created_at < b.created_at ? -1 : 1))
      .slice(0, 10);
  }

  private async tryClaim(
    candidate: QueuedJobRow,
    workerId: string,
    leaseUntil: string,
    now: string,
  ): Promise<QueuedJobRow | null> {
    let query = this.client
      .from('sync_jobs')
      .update({
        status: 'running',
        claimed_by: workerId,
        lease_expires_at: leaseUntil,
        attempts: (candidate.attempts ?? 0) + 1,
      })
      .eq('id', candidate.id);
    query =
      candidate.status === 'queued'
        ? query.eq('status', 'queued')
        : query.eq('status', 'running').lte('lease_expires_at', now);
    const { data, error } = await query.select('*');
    if (error || !data?.length) return null;
    return toRow((data as unknown[])[0]);
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<void> {
    const { data, error } = await this.client
      .from('sync_jobs')
      .update({ lease_expires_at: new Date(Date.now() + leaseMs).toISOString() })
      .eq('id', jobId)
      .eq('claimed_by', workerId)
      .select('id');
    if (error || !data?.length) throw upstream('Heartbeat failed: claim lost');
  }

  /** Release a claim without changing lifecycle status (recovery path). */
  async release(jobId: string, workerId: string): Promise<void> {
    await this.client
      .from('sync_jobs')
      .update({ claimed_by: null, lease_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('id', jobId)
      .eq('claimed_by', workerId);
  }

  /** Requeue for retry: back to queued with a future run_after. */
  async requeue(jobId: string, workerId: string, runAfter: Date): Promise<void> {
    const { data, error } = await this.client
      .from('sync_jobs')
      .update({
        status: 'queued',
        claimed_by: null,
        lease_expires_at: null,
        run_after: runAfter.toISOString(),
      })
      .eq('id', jobId)
      .eq('claimed_by', workerId)
      .select('id');
    if (error || !data?.length) throw upstream('Requeue failed: claim lost');
  }

  /** Cancel a queued job. Running jobs observe cancel_requested instead. */
  async cancel(jobId: string): Promise<boolean> {
    const row = await this.get(jobId);
    if (row.status !== 'queued') return false;
    const { data, error } = await this.client
      .from('sync_jobs')
      .update({ status: 'failed', error_message: 'Cancelled by operator', completed_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', 'queued')
      .select('id');
    if (error) throw upstream('Cancel failed');
    return (data?.length ?? 0) > 0;
  }

  async get(jobId: string): Promise<QueuedJobRow> {
    const { data, error } = await this.client.from('sync_jobs').select('*').eq('id', jobId).maybeSingle();
    if (error) throw upstream('Job lookup failed');
    if (!data) throw notFound('Sync job');
    return toRow(data);
  }

  async workerHealth(): Promise<WorkerHealth> {
    const now = new Date().toISOString();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    try {
      const [active, stale, failed, lastOk] = await Promise.all([
        this.client.from('sync_jobs').select('id', { count: 'exact', head: true }).eq('status', 'running'),
        this.client
          .from('sync_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'running')
          .lte('lease_expires_at', now),
        this.client
          .from('sync_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'failed')
          .gte('created_at', dayAgo),
        this.client
          .from('sync_jobs')
          .select('completed_at')
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .range(0, 0),
      ]);
      const last = ((lastOk.data as Array<{ completed_at: string }> | null) ?? [])[0]?.completed_at ?? null;
      return {
        queueReachable: true,
        activeJobs: active.count ?? 0,
        staleJobs: stale.count ?? 0,
        failedLast24h: failed.count ?? 0,
        lastSuccessfulAt: last,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw upstream('Queue unreachable');
    }
  }
}

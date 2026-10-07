import { log } from '../lib/logger';
import { serviceClient, type DbClient } from '../lib/supabase';
import {
  idempotencyKeyFor,
  SupabaseJobQueue,
  type JobPayload,
} from '../queue/queue';
import { recoverStaleJobs } from './recovery';
import { getSchedule, type ScheduleRow } from './schedules';

export interface SchedulerOptions {
  queue?: SupabaseJobQueue;
  client?: DbClient;
  /** Injected clock (tests). Defaults to Date.now. */
  now?: () => number;
  /** Queue depth at which low-priority schedules defer. */
  queueDepthLimit?: number;
  /** Deferral delay for backpressure (ms). */
  deferralMs?: number;
  /** Max due schedules evaluated per tick. */
  batchLimit?: number;
}

export interface TickSummary {
  evaluated: number;
  enqueued: number;
  skippedDuplicate: number;
  deferredBackpressure: number;
  catchUpCollapsed: number;
  recovered: number;
  deadLettered: number;
}

/** Match-lifecycle windows (UTC dates) for upcoming/recent orchestration. */
export function matchLifecycleWindows(nowMs: number): {
  upcoming: { from: string; to: string };
  recent: { from: string; to: string };
} {
  const day = 24 * 60 * 60 * 1000;
  const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  const startOfToday = Date.parse(new Date(nowMs).toISOString().slice(0, 10));
  return {
    upcoming: { from: isoDay(startOfToday), to: isoDay(startOfToday + 7 * day) },
    recent: { from: isoDay(startOfToday - 2 * day), to: isoDay(nowMs) },
  };
}

function payloadForSchedule(schedule: ScheduleRow): JobPayload {
  const dataSource = { provider: schedule.provider };
  if (schedule.entity_type === 'import') {
    return {
      kind: 'import',
      dataSource,
      jobType: `schedule:${schedule.name}`.slice(0, 100),
      entities: schedule.scope.entities,
      params: schedule.scope.params,
      limit: schedule.scope.limit,
      batchSize: schedule.scope.batchSize,
    };
  }
  return {
    kind: 'sync',
    dataSource,
    jobType: `schedule:${schedule.name}`.slice(0, 100),
    entityType: schedule.entity_type as JobPayload['entityType'],
    params: schedule.scope.params,
    limit: schedule.scope.limit,
    batchSize: schedule.scope.batchSize,
  };
}

export class Scheduler {
  private readonly queue: SupabaseJobQueue;
  private readonly client: DbClient;
  private readonly clock: () => number;
  private readonly queueDepthLimit: number;
  private readonly deferralMs: number;
  private readonly batchLimit: number;

  constructor(options: SchedulerOptions = {}) {
    this.client = options.client ?? serviceClient();
    this.queue = options.queue ?? new SupabaseJobQueue(this.client);
    this.clock = options.now ?? Date.now;
    this.queueDepthLimit = options.queueDepthLimit ?? 100;
    this.deferralMs = options.deferralMs ?? 60_000;
    this.batchLimit = options.batchLimit ?? 25;
  }

  /** One evaluation cycle: recover stale jobs, then enqueue due schedules. */
  async tick(nowMs: number = this.clock()): Promise<TickSummary> {
    const summary: TickSummary = {
      evaluated: 0,
      enqueued: 0,
      skippedDuplicate: 0,
      deferredBackpressure: 0,
      catchUpCollapsed: 0,
      recovered: 0,
      deadLettered: 0,
    };
    const recovery = await recoverStaleJobs({ nowMs, client: this.client });
    summary.recovered = recovery.requeued;
    summary.deadLettered = recovery.deadLettered;

    const now = new Date(nowMs).toISOString();
    const { data, error } = await this.client
      .from('sync_schedules')
      .select('*')
      .eq('enabled', true)
      .lte('next_run_at', now)
      .order('next_run_at', { ascending: true })
      .range(0, this.batchLimit - 1);
    if (error || !data) return summary;
    const due = data as ScheduleRow[];
    if (due.length === 0) return summary;

    const depth = await this.queueDepth();
    for (const schedule of due) {
      summary.evaluated += 1;
      await this.evaluate(schedule, nowMs, depth, summary);
    }
    return summary;
  }

  /** Manual trigger: same queue/validation/idempotency path, on demand. */
  async triggerNow(scheduleId: string): Promise<{ jobId: string; deduplicated: boolean }> {
    const nowMs = this.clock();
    const schedule = await getSchedule(scheduleId, this.client);
    const payload = payloadForSchedule(schedule);
    const key = idempotencyKeyFor(payload);
    const existing = await this.findActiveJob(key);
    if (existing) {
      log({ msg: 'schedule_trigger_deduped', schedule: schedule.name, jobId: existing });
      return { jobId: existing, deduplicated: true };
    }
    const { jobId } = await this.enqueueSchedule(schedule, { ...payload, idempotencyKey: key });
    await this.touch(schedule, nowMs, nowMs + schedule.frequency_seconds * 1000, jobId, 'queued-manual');
    log({ msg: 'schedule_triggered', schedule: schedule.name, jobId });
    return { jobId, deduplicated: false };
  }

  private async evaluate(
    schedule: ScheduleRow,
    nowMs: number,
    depth: number,
    summary: TickSummary,
  ): Promise<void> {
    const now = new Date(nowMs).toISOString();
    await this.refreshPrevious(schedule);
    // Catch-up collapse: a long outage produces ONE job, never N missed ones.
    const missedWindows = Math.floor((nowMs - Date.parse(schedule.next_run_at)) / (schedule.frequency_seconds * 1000));
    if (missedWindows > 1) {
      summary.catchUpCollapsed += missedWindows - 1;
      log({ msg: 'schedule_catchup', schedule: schedule.name, missedWindows });
    }
    const payload = payloadForSchedule(schedule);
    const key = idempotencyKeyFor(payload);
    if (await this.findActiveJob(key)) {
      summary.skippedDuplicate += 1;
      await this.touch(schedule, nowMs, nowMs + schedule.frequency_seconds * 1000, null, 'skipped-duplicate');
      log({ msg: 'schedule_skipped_duplicate', schedule: schedule.name });
      return;
    }
    // Backpressure: low-priority work waits while the queue is deep.
    if (depth >= this.queueDepthLimit && schedule.priority > 100) {
      summary.deferredBackpressure += 1;
      await this.touch(schedule, nowMs, nowMs + this.deferralMs, null, 'deferred-backpressure');
      log({ msg: 'schedule_deferred', schedule: schedule.name, depth });
      return;
    }
    const { jobId } = await this.enqueueSchedule(schedule, { ...payload, idempotencyKey: key });
    summary.enqueued += 1;
    await this.touch(schedule, nowMs, nowMs + schedule.frequency_seconds * 1000, jobId, 'queued');
    log({ msg: 'schedule_enqueued', schedule: schedule.name, jobId });
  }

  private async findActiveJob(key: string): Promise<string | null> {
    const { data } = await this.client
      .from('sync_jobs')
      .select('id')
      .in('status', ['queued', 'running'])
      .contains('payload', { idempotencyKey: key })
      .range(0, 0);
    const id = ((data as Array<{ id: string }> | null) ?? [])[0]?.id;
    return id ? String(id) : null;
  }

  private async queueDepth(): Promise<number> {
    const [queued, running] = await Promise.all([
      this.client.from('sync_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
      this.client.from('sync_jobs').select('id', { count: 'exact', head: true }).eq('status', 'running'),
    ]);
    return (queued.count ?? 0) + (running.count ?? 0);
  }

  private async enqueueSchedule(
    schedule: ScheduleRow,
    payload: JobPayload,
  ): Promise<{ jobId: string }> {
    return this.queue.enqueue({
      ...payload,
      priority: schedule.priority,
      maxAttempts: schedule.max_attempts,
    });
  }

  private async refreshPrevious(schedule: ScheduleRow): Promise<void> {
    if (!schedule.last_job_id) return;
    const { data } = await this.client
      .from('sync_jobs')
      .select('status')
      .eq('id', schedule.last_job_id)
      .maybeSingle();
    const status = (data as { status?: string } | null)?.status;
    if (!status || status === schedule.last_status) return;
    await this.client
      .from('sync_schedules')
      .update({
        last_status: status,
        consecutive_failures: status === 'failed' ? (schedule.consecutive_failures ?? 0) + 1 : 0,
      })
      .eq('id', schedule.id);
  }

  private async touch(
    schedule: ScheduleRow,
    nowMs: number,
    nextRunMs: number,
    jobId: string | null,
    status: string,
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      last_run_at: new Date(nowMs).toISOString(),
      next_run_at: new Date(nextRunMs).toISOString(),
      last_status: status,
    };
    if (jobId) patch.last_job_id = jobId;
    await this.client.from('sync_schedules').update(patch).eq('id', schedule.id);
  }
}

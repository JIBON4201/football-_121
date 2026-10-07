import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';
import { serviceClient } from '../src/lib/supabase';
import { Scheduler, matchLifecycleWindows } from '../src/scheduler/scheduler';
import { SupabaseJobQueue } from '../src/queue/queue';

const SEED_DS = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  name: 'Seed Provider',
  provider: 'seed',
  api_version: 'v1',
  is_active: true,
  priority: 1000,
};

const NOW = Date.parse('2026-09-30T12:00:00.000Z');

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `sched-${Math.random().toString(36).slice(2, 10)}`,
    name: `sched-${Math.random().toString(36).slice(2, 10)}`,
    provider: 'seed',
    entity_type: 'teams',
    scope: {},
    frequency_seconds: 3600,
    enabled: true,
    priority: 100,
    max_attempts: 5,
    last_run_at: null,
    next_run_at: new Date(NOW - 1000).toISOString(),
    last_job_id: null,
    last_status: null,
    consecutive_failures: 0,
    ...overrides,
  };
}

describe('scheduler orchestration', () => {
  let fake: FakeClient;
  let queue: SupabaseJobQueue;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    fake.store.data_sources = [{ ...SEED_DS }];
    fake.store.sync_schedules = [];
    queue = new SupabaseJobQueue(serviceClient());
  });

  function makeScheduler(extra: Record<string, unknown> = {}) {
    return new Scheduler({ queue, now: () => NOW, ...extra });
  }

  it('enqueues due schedules and advances next run', async () => {
    fake.store.sync_schedules.push(scheduleRow({ entity_type: 'teams' }));
    const summary = await makeScheduler().tick(NOW);
    expect(summary).toMatchObject({ evaluated: 1, enqueued: 1 });
    expect(fake.store.sync_jobs).toHaveLength(1);
    const schedule = fake.store.sync_schedules[0] as Record<string, unknown>;
    expect(Date.parse(schedule.next_run_at as string)).toBe(NOW + 3600_000);
    expect(schedule.last_status).toBe('queued');
    expect(schedule.last_job_id).toBeDefined();
  });

  it('ignores future and disabled schedules', async () => {
    fake.store.sync_schedules.push(
      scheduleRow({ next_run_at: new Date(NOW + 3600_000).toISOString() }),
      scheduleRow({ enabled: false }),
    );
    const summary = await makeScheduler().tick(NOW);
    expect(summary).toMatchObject({ evaluated: 0, enqueued: 0 });
  });

  it('prevents duplicate jobs for the same logical window', async () => {
    fake.store.sync_schedules.push(scheduleRow({ entity_type: 'teams', frequency_seconds: 60 }));
    const scheduler = makeScheduler();
    const first = await scheduler.tick(NOW);
    expect(first.enqueued).toBe(1);
    // Second evaluation inside the same window finds the queued twin.
    const row = fake.store.sync_schedules[0] as Record<string, unknown>;
    row.next_run_at = new Date(NOW - 1000).toISOString();
    const second = await scheduler.tick(NOW);
    expect(second).toMatchObject({ evaluated: 1, enqueued: 0, skippedDuplicate: 1 });
    expect(fake.store.sync_jobs).toHaveLength(1);
  });

  it('collapses missed windows after downtime into one job', async () => {
    fake.store.sync_schedules.push(
      scheduleRow({ next_run_at: new Date(NOW - 10 * 3600_000).toISOString(), frequency_seconds: 3600 }),
    );
    const summary = await makeScheduler().tick(NOW);
    expect(summary.enqueued).toBe(1);
    expect(summary.catchUpCollapsed).toBe(9);
    expect(fake.store.sync_jobs).toHaveLength(1);
  });

  it('defers low-priority work under backpressure, not high-priority', async () => {
    fake.store.sync_schedules.push(
      scheduleRow({ name: 'low', priority: 1000 }),
      scheduleRow({ name: 'high', priority: 10 }),
    );
    for (let i = 0; i < 2; i += 1) {
      fake.store.sync_jobs.push({ status: 'queued', priority: 100, created_at: new Date(NOW).toISOString() });
    }
    const summary = await makeScheduler({ queueDepthLimit: 2 }).tick(NOW);
    expect(summary.deferredBackpressure).toBe(1);
    expect(summary.enqueued).toBe(1);
    const low = fake.store.sync_schedules.find((r) => (r as { name: string }).name === 'low') as Record<string, unknown>;
    expect(low.last_status).toBe('deferred-backpressure');
  });

  it('manual triggers deduplicate through the normal path', async () => {
    fake.store.sync_schedules.push(scheduleRow({ entity_type: 'teams' }));
    const scheduler = makeScheduler();
    const id = (fake.store.sync_schedules[0] as { id: string }).id;
    const first = await scheduler.triggerNow(id);
    expect(first.deduplicated).toBe(false);
    const second = await scheduler.triggerNow(id);
    expect(second).toMatchObject({ jobId: first.jobId, deduplicated: true });
    expect(fake.store.sync_jobs).toHaveLength(1);
  });

  it('handles UTC offsets without duplicate execution', async () => {
    // +05:00 wall time that is already past in UTC.
    fake.store.sync_schedules.push(
      scheduleRow({ next_run_at: '2026-09-30T16:59:00+05:00', frequency_seconds: 3600 }),
    );
    const summary = await makeScheduler().tick(NOW);
    expect(summary.enqueued).toBe(1);
  });

  it('computes sane match lifecycle windows', async () => {
    const windows = matchLifecycleWindows(NOW);
    expect(windows.upcoming.from).toBe('2026-09-30');
    expect(windows.upcoming.to > windows.upcoming.from).toBe(true);
    expect(windows.recent.from < windows.recent.to).toBe(true);
  });

  it('removed legacy schedule endpoint stays protected (401 unauth, 404 authed)', async () => {
    expect((await request(app).get('/api/v1/admin/schedules')).status).toBe(401);
    setTestRoles(['admin']);
    const authed = { Authorization: 'Bearer valid-token' };
    expect((await request(app).get('/api/v1/admin/schedules').set(authed)).status).toBe(404);
  });
});

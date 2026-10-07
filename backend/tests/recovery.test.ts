import { beforeEach, describe, expect, it } from 'vitest';
import { installTestEnv } from './helpers';
import type { FakeClient } from './fake';
import { getFreshness, recoverStaleJobs } from '../src/scheduler/recovery';

const SEED_DS = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  name: 'Seed Provider',
  provider: 'seed',
  api_version: 'v1',
  is_active: true,
  priority: 1000,
};

function runningJob(overrides: Record<string, unknown> = {}) {
  return {
    id: `job-${Math.random().toString(36).slice(2, 10)}`,
    data_source_id: SEED_DS.id,
    job_type: 'stale',
    entity_type: 'teams',
    status: 'running',
    priority: 100,
    attempts: 1,
    max_attempts: 5,
    claimed_by: 'dead-worker',
    lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
    run_after: new Date(Date.now() - 60_000).toISOString(),
    cancel_requested: false,
    ...overrides,
  };
}

describe('stale recovery and freshness', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    fake.store.data_sources = [{ ...SEED_DS }];
  });

  it('requeues stale jobs within budget', async () => {
    fake.store.sync_jobs.push(runningJob());
    const summary = await recoverStaleJobs();
    expect(summary).toMatchObject({ examined: 1, requeued: 1, deadLettered: 0 });
    const row = fake.store.sync_jobs[0] as Record<string, unknown>;
    expect(row.status).toBe('queued');
    expect(row.claimed_by).toBeNull();
  });

  it('dead-letters exhausted jobs with diagnostics', async () => {
    fake.store.sync_jobs.push(runningJob({ attempts: 5, max_attempts: 5 }));
    const summary = await recoverStaleJobs();
    expect(summary).toMatchObject({ examined: 1, requeued: 0, deadLettered: 1 });
    const row = fake.store.sync_jobs[0] as Record<string, unknown>;
    expect(row.status).toBe('failed');
    expect(fake.store.sync_errors).toHaveLength(1);
    expect((fake.store.sync_errors[0] as { error_code: string }).error_code).toBe('STALE_JOB');
  });

  it('leaves healthy running jobs alone', async () => {
    fake.store.sync_jobs.push(
      runningJob({ lease_expires_at: new Date(Date.now() + 60_000).toISOString() }),
    );
    const summary = await recoverStaleJobs();
    expect(summary).toMatchObject({ examined: 0, requeued: 0, deadLettered: 0 });
  });

  it('derives freshness from real sync history', async () => {
    const now = Date.now();
    fake.store.sync_jobs.push({
      ...runningJob(),
      status: 'completed',
      entity_type: 'matches',
      completed_at: new Date(now - 5 * 60_000).toISOString(),
    });
    fake.store.sync_jobs.push({
      ...runningJob(),
      status: 'completed',
      entity_type: 'teams',
      completed_at: new Date(now - 10 * 3600_000).toISOString(),
    });
    const entries = await getFreshness({ nowMs: now });
    const matches = entries.find((entry) => entry.entityType === 'matches');
    const teams = entries.find((entry) => entry.entityType === 'teams');
    expect(matches?.state).toBe('fresh');
    expect(teams?.state).toBe('aging');
    expect(matches?.provider).toBe('seed');
  });

  it('marks unknown datasets unavailable, never fabricated', async () => {
    const entries = await getFreshness({ entityType: 'transfers' });
    expect(entries).toEqual([]);
  });

  it('marks ancient history stale', async () => {
    const now = Date.now();
    fake.store.sync_jobs.push({
      ...runningJob(),
      status: 'completed',
      entity_type: 'transfers',
      completed_at: new Date(now - 30 * 24 * 3600_000).toISOString(),
    });
    const entries = await getFreshness({ nowMs: now });
    expect(entries.find((entry) => entry.entityType === 'transfers')?.state).toBe('stale');
  });
});

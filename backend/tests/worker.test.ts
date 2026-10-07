import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';
import { serviceClient } from '../src/lib/supabase';
import { ProviderHttpError } from '../src/providers/httpClient';
import { registerSeedProvider } from '../src/providers/seed/seedProvider';
import { unregisterProvider } from '../src/providers/registry';
import { SupabaseJobQueue } from '../src/queue/queue';
import { ProviderThrottle, SyncWorker } from '../src/queue/worker';
import { makeMockProvider } from './mockProvider';

const SEED_DS = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  name: 'Seed Provider',
  provider: 'seed',
  api_version: 'v1',
  is_active: true,
  priority: 1000,
};

function makeWorker(queue: SupabaseJobQueue, extra: Record<string, unknown> = {}) {
  return new SyncWorker({ queue, signals: false, heartbeatMs: 20, pollIntervalMs: 10, ...extra });
}

describe('background sync worker', () => {
  let fake: FakeClient;
  let queue: SupabaseJobQueue;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    fake.store.data_sources = [{ ...SEED_DS }];
    registerSeedProvider();
    queue = new SupabaseJobQueue(serviceClient());
  });

  afterEach(() => {
    unregisterProvider('seed');
  });

  it('processes a queued sync to completion', async () => {
    const { jobId } = await queue.enqueue({
      kind: 'sync',
      dataSource: { provider: 'seed' },
      jobType: 'worker',
      entityType: 'teams',
    });
    const worker = makeWorker(queue);
    const tick = await worker.tick();
    expect(tick).toMatchObject({ processed: true, jobId, status: 'completed' });
    expect(fake.store.teams.length).toBeGreaterThan(2);
    const row = await queue.get(jobId);
    expect(row.status).toBe('completed');
    expect(row.claimed_by).toBeNull();
  });

  it('records partial success without stopping the job', async () => {
    const { registerProvider } = await import('../src/providers/registry');
    registerProvider({
      name: 'flaky',
      priority: 1,
      enabled: true,
      createAdapter: () =>
        makeMockProvider({
          getTeams: async () => [
            { externalId: 'w-ok', name: 'Worker OK' },
            { externalId: 'w-bad' },
          ],
        }).provider,
    });
    fake.store.data_sources.push({ ...SEED_DS, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', provider: 'flaky' });
    try {
      const { jobId } = await queue.enqueue({
        kind: 'sync',
        dataSource: { provider: 'flaky' },
        jobType: 'worker',
        entityType: 'teams',
      });
      const tick = await makeWorker(queue).tick();
      expect(tick).toMatchObject({ processed: true, jobId, status: 'partial' });
      expect(fake.store.sync_errors.length).toBeGreaterThan(0);
    } finally {
      unregisterProvider('flaky');
    }
  });

  it('fails permanently on unsupported operations without retry', async () => {
    const { registerProvider } = await import('../src/providers/registry');
    registerProvider({
      name: 'narrow',
      priority: 1,
      enabled: true,
      createAdapter: () => makeMockProvider({ capabilities: { countries: false, venues: false, competitions: false, seasons: false, teams: false, players: false, matches: false, events: false, lineups: false, 'team-stats': false, 'player-stats': false, transfers: false } }).provider,
    });
    fake.store.data_sources.push({ ...SEED_DS, id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', provider: 'narrow' });
    try {
      const { jobId } = await queue.enqueue({
        kind: 'sync',
        dataSource: { provider: 'narrow' },
        jobType: 'worker',
        entityType: 'transfers',
      });
      const tick = await makeWorker(queue).tick();
      expect(tick).toMatchObject({ processed: true, jobId, status: 'failed' });
      const row = await queue.get(jobId);
      expect(row.attempts).toBe(1);
      expect(row.error_message).toContain('does not support');
      // Deterministic failure is terminal: no retry is scheduled.
      const again = await makeWorker(queue).tick();
      expect(again.processed).toBe(false);
    } finally {
      unregisterProvider('narrow');
    }
  });

  it('retries transient failures with backoff, then succeeds', async () => {
    let calls = 0;
    const { registerProvider } = await import('../src/providers/registry');
    registerProvider({
      name: 'flap',
      priority: 1,
      enabled: true,
      createAdapter: () =>
        makeMockProvider({
          getTeams: async () => {
            calls += 1;
            if (calls === 1) throw new ProviderHttpError('TIMEOUT', 'boom', undefined, true);
            return [{ externalId: 'f-ok', name: 'Flap OK' }];
          },
        }).provider,
    });
    fake.store.data_sources.push({ ...SEED_DS, id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', provider: 'flap' });
    try {
      const { jobId } = await queue.enqueue({
        kind: 'sync',
        dataSource: { provider: 'flap' },
        jobType: 'worker',
        entityType: 'teams',
        maxAttempts: 3,
      });
      const worker = makeWorker(queue);
      const first = await worker.tick();
      expect(first).toMatchObject({ processed: true, jobId, status: 'queued' });
      const requeued = await queue.get(jobId);
      expect(requeued.status).toBe('queued');
      expect(Date.parse(requeued.run_after)).toBeGreaterThan(Date.now());
      // Fast-forward past backoff.
      const stored = fake.store.sync_jobs.find((r) => (r as { id: string }).id === jobId) as Record<string, unknown>;
      stored.run_after = new Date(Date.now() - 1000).toISOString();
      const second = await worker.tick();
      expect(second).toMatchObject({ processed: true, jobId, status: 'completed' });
    } finally {
      unregisterProvider('flap');
    }
  });

  it('gives up after max attempts', async () => {
    const { registerProvider } = await import('../src/providers/registry');
    registerProvider({
      name: 'down',
      priority: 1,
      enabled: true,
      createAdapter: () =>
        makeMockProvider({
          getTeams: async () => {
            throw new ProviderHttpError('TIMEOUT', 'down', undefined, true);
          },
        }).provider,
    });
    fake.store.data_sources.push({ ...SEED_DS, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', provider: 'down' });
    try {
      const { jobId } = await queue.enqueue({
        kind: 'sync',
        dataSource: { provider: 'down' },
        jobType: 'worker',
        entityType: 'teams',
        maxAttempts: 1,
      });
      const tick = await makeWorker(queue).tick();
      // attempts (1) already reaches maxAttempts (1) → permanent failure.
      expect(tick).toMatchObject({ processed: true, jobId, status: 'failed' });
      expect(fake.store.sync_errors.length).toBeGreaterThan(0);
    } finally {
      unregisterProvider('down');
    }
  });

  it('never double-processes the same job', async () => {
    const { jobId } = await queue.enqueue({
      kind: 'sync',
      dataSource: { provider: 'seed' },
      jobType: 'worker',
      entityType: 'teams',
    });
    const first = await makeWorker(queue).tick();
    expect(first).toMatchObject({ processed: true, jobId });
    const second = await makeWorker(queue).tick();
    expect(second.processed).toBe(false);
  });

  it('recovers a stale job left by a crashed worker', async () => {
    const { serviceClient } = await import('../src/lib/supabase');
    const { data } = await serviceClient()
      .from('sync_jobs')
      .insert({
        data_source_id: SEED_DS.id,
        job_type: 'crashed',
        entity_type: 'teams',
        status: 'running',
        priority: 100,
        attempts: 1,
        max_attempts: 5,
        claimed_by: 'dead-worker',
        lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
        run_after: new Date(Date.now() - 60_000).toISOString(),
        cancel_requested: false,
        payload: { kind: 'sync', dataSource: { provider: 'seed' }, jobType: 'crashed', entityType: 'teams' },
      })
      .select('id');
    const jobId = String((data as Array<{ id: string }>)[0].id);
    const retry = await makeWorker(queue).tick();
    expect(retry).toMatchObject({ processed: true, jobId, status: 'completed' });
    expect((await queue.get(jobId)).claimed_by).toBeNull();
  });

  it('abandons the claim (recoverable) when shutdown times out', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const { registerProvider } = await import('../src/providers/registry');
    registerProvider({
      name: 'slow',
      priority: 1,
      enabled: true,
      createAdapter: () =>
        makeMockProvider({
          getTeams: async () => {
            await gate;
            return [];
          },
        }).provider,
    });
    fake.store.data_sources.push({ ...SEED_DS, id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', provider: 'slow' });
    const tickPromiseHolder: Array<Promise<unknown>> = [];
    try {
      const { jobId } = await queue.enqueue({
        kind: 'sync',
        dataSource: { provider: 'slow' },
        jobType: 'worker',
        entityType: 'teams',
      });
      const worker = makeWorker(queue, { shutdownTimeoutMs: 200 });
      tickPromiseHolder.push(worker.tick());
      await new Promise((resolve) => setTimeout(resolve, 50));
      await worker.stop();
      expect(worker.isRunning).toBe(false);
      // Claim released while work is still in flight: a later worker recovers it.
      expect((await queue.get(jobId)).claimed_by).toBeNull();
    } finally {
      releaseGate();
      await Promise.all(tickPromiseHolder);
      unregisterProvider('slow');
    }
  });

  it('stops idle workers cleanly', async () => {
    const worker = makeWorker(queue);
    worker.start();
    expect(worker.isRunning).toBe(true);
    await worker.stop();
    expect(worker.isRunning).toBe(false);
  });

  it('throttles per-provider execution', async () => {
    const throttle = new ProviderThrottle(60);
    const started = Date.now();
    await throttle.acquire('p1');
    await throttle.acquire('p1');
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });

  it('removed legacy queue endpoints stay protected (401 unauth)', async () => {
    expect((await request(app).post('/api/v1/admin/sync').send({})).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/workers/health')).status).toBe(401);
  });
});

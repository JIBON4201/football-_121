import { beforeEach, describe, expect, it } from 'vitest';
import { serviceClient } from '../src/lib/supabase';
import { SupabaseJobQueue } from '../src/queue/queue';
import { installTestEnv } from './helpers';
import type { FakeClient } from './fake';

const DS = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  name: 'Queue DS',
  provider: 'q1',
  api_version: 'v1',
  is_active: true,
  priority: 100,
};

describe('durable job queue', () => {
  let fake: FakeClient;
  let queue: SupabaseJobQueue;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    fake.store.data_sources = [{ ...DS }];
    queue = new SupabaseJobQueue(serviceClient());
  });

  it('enqueues validated payloads and rejects bad ones', async () => {
    const { jobId } = await queue.enqueue({
      kind: 'sync',
      dataSource: { provider: 'q1' },
      jobType: 'manual',
      entityType: 'teams',
    });
    expect(jobId).toBeDefined();
    const row = await queue.get(jobId);
    expect(row).toMatchObject({ status: 'queued', priority: 100, attempts: 0 });

    await expect(
      queue.enqueue({ kind: 'sync', dataSource: { provider: 'q1' }, jobType: 'x' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      queue.enqueue({ kind: 'bogus', dataSource: { provider: 'q1' }, jobType: 'x' } as never),
    ).rejects.toMatchObject({ status: 400 });
    await expect(queue.enqueue({ kind: 'sync', dataSource: { provider: 'nope' }, jobType: 'x', entityType: 'teams' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses secret-bearing payloads', async () => {
    await expect(
      queue.enqueue({
        kind: 'sync',
        dataSource: { provider: 'q1' },
        jobType: 'x',
        entityType: 'teams',
        params: { apiKey: 'shh' },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('claims highest-priority jobs first, exclusively', async () => {
    const low = await queue.enqueue({ kind: 'sync', dataSource: { provider: 'q1' }, jobType: 'a', entityType: 'teams', priority: 'low' });
    const high = await queue.enqueue({ kind: 'sync', dataSource: { provider: 'q1' }, jobType: 'b', entityType: 'teams', priority: 'high' });
    const claimed = await queue.claim('w1', 60_000);
    expect(claimed?.id).toBe(high.jobId);
    const second = await queue.claim('w2', 60_000);
    expect(second?.id).toBe(low.jobId);
    expect(await queue.claim('w3', 60_000)).toBeNull();
  });

  it('recovers stale running jobs via expired leases', async () => {
    const { jobId } = await queue.enqueue({ kind: 'sync', dataSource: { provider: 'q1' }, jobType: 'a', entityType: 'teams' });
    const first = await queue.claim('w1', 60_000);
    expect(first?.id).toBe(jobId);
    expect(await queue.claim('w2', 60_000)).toBeNull();
    // Simulate crash: expire the lease out of band.
    const row = fake.store.sync_jobs.find((r) => (r as { id: string }).id === jobId) as Record<string, unknown>;
    row.lease_expires_at = new Date(Date.now() - 1000).toISOString();
    const recovered = await queue.claim('w2', 60_000);
    expect(recovered?.id).toBe(jobId);
    expect(recovered?.claimed_by).toBe('w2');
  });

  it('renews and guards heartbeats by owner', async () => {
    const { jobId } = await queue.enqueue({ kind: 'sync', dataSource: { provider: 'q1' }, jobType: 'a', entityType: 'teams' });
    await queue.claim('w1', 60_000);
    await queue.heartbeat(jobId, 'w1', 120_000);
    await expect(queue.heartbeat(jobId, 'w2', 120_000)).rejects.toMatchObject({ status: 503 });
  });

  it('requeues and cancels safely', async () => {
    const { jobId } = await queue.enqueue({ kind: 'sync', dataSource: { provider: 'q1' }, jobType: 'a', entityType: 'teams' });
    await queue.claim('w1', 60_000);
    await queue.requeue(jobId, 'w1', new Date(Date.now() + 60_000));
    const requeued = await queue.get(jobId);
    expect(requeued.status).toBe('queued');

    expect(await queue.cancel(jobId)).toBe(true);
    expect((await queue.get(jobId)).status).toBe('failed');
    expect(await queue.cancel(jobId)).toBe(false);
  });

  it('reports queue health without secrets', async () => {
    const health = await queue.workerHealth();
    expect(health).toMatchObject({ queueReachable: true, activeJobs: 0, staleJobs: 0 });
    expect(JSON.stringify(health)).not.toContain('SECRET');
  });
});

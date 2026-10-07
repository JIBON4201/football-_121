import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';
import { runSync } from '../src/providers/sync';
import { getRegistration, registerProvider } from '../src/providers/registry';
import { ALL_CAPABILITIES, MOCK_DATA_SOURCE, makeMockProvider, registerMock, unregisterMock } from './mockProvider';

function seedDataSource(fake: FakeClient, provider = 'mock', active = true) {
  fake.store.data_sources = [{ ...MOCK_DATA_SOURCE, provider, is_active: active }];
}

describe('provider sync orchestration', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedDataSource(fake);
    registerMock();
  });

  afterEach(() => {
    unregisterMock();
  });

  it('imports teams idempotently (created then updated)', async () => {
    const first = await runSync({
      dataSource: { provider: 'mock' },
      jobType: 'full',
      entityType: 'teams',
      adapter: makeMockProvider().provider,
    });
    expect(first.status).toBe('completed');
    expect(first).toMatchObject({ processed: 2, created: 2, updated: 0, failed: 0 });
    expect(fake.store.teams).toHaveLength(4);

    const second = await runSync({
      dataSource: { provider: 'mock' },
      jobType: 'full',
      entityType: 'teams',
      adapter: makeMockProvider().provider,
    });
    expect(second).toMatchObject({ processed: 2, created: 0, updated: 2, failed: 0 });
    expect(fake.store.teams).toHaveLength(4);
    expect(fake.store.external_entity_ids.length).toBeGreaterThan(0);
  });

  it('records partial success with per-record errors', async () => {
    const { provider } = makeMockProvider({
      getTeams: async () => [
        { externalId: 'm-ok', name: 'Mock OK' },
        { externalId: 'm-bad' },
      ],
    });
    const summary = await runSync({
      dataSource: { provider: 'mock' },
      jobType: 'full',
      entityType: 'teams',
      adapter: provider,
    });
    expect(summary.status).toBe('partial');
    expect(summary).toMatchObject({ processed: 2, created: 1, failed: 1 });
    expect(fake.store.sync_errors).toHaveLength(1);
    expect(fake.store.sync_errors[0].error_code).toBe('MISSING_FIELD');
    expect(String(JSON.stringify(fake.store.sync_errors[0]))).not.toContain('SECRET');
  });

  it('fails the job for unsupported operations', async () => {
    const { provider } = makeMockProvider({
      capabilities: { ...ALL_CAPABILITIES, transfers: false },
      getTransfers: undefined,
    });
    const summary = await runSync({
      dataSource: { provider: 'mock' },
      jobType: 'full',
      entityType: 'transfers',
      adapter: provider,
    });
    expect(summary.status).toBe('failed');
  });

  it('rejects disabled data sources', async () => {
    seedDataSource(fake, 'mock', false);
    await expect(
      runSync({ dataSource: { provider: 'mock' }, jobType: 'full', entityType: 'teams', adapter: makeMockProvider().provider }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('registry resolves runtime adapters', () => {
    expect(getRegistration('mock')?.name).toBe('mock');
    registerProvider({ name: 'temp', priority: 1, enabled: false, createAdapter: () => makeMockProvider().provider });
    expect(getRegistration('temp')?.enabled).toBe(false);
  });
});

describe('admin sync boundary', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedDataSource(fake);
    registerMock();
  });

  afterEach(() => {
    unregisterMock();
  });

  it('removed legacy admin sync endpoints stay protected (401 unauth)', async () => {
    expect((await request(app).get('/api/v1/admin/sync-jobs')).status).toBe(401);
    expect((await request(app).post('/api/v1/admin/sync').send({})).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/providers/health')).status).toBe(401);
  });
});

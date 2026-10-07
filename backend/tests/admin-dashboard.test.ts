import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };
const BASE = '/api/v1/admin/dashboard';

function seedAdmin(fake: FakeClient, keys: string[] = ['dashboard.read']) {
  fake.store.roles = [
    { id: 1, name: 'super_admin' },
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [
    { user_id: 'user-1', status: 'active' },
    { user_id: 'user-2', status: 'suspended' },
  ];
  fake.store.user_roles = [
    { user_id: 'user-1', role_id: 1 },
    { user_id: 'user-2', role_id: 2 },
  ];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.flatMap((key) => [
    { role_id: 1, permission_id: ids.get(key) },
    { role_id: 2, permission_id: ids.get(key) },
  ]);
  setTestRoles(['admin']);
}

function seedActivity(fake: FakeClient) {
  fake.store.audit_logs = [
    { id: 'a1', user_id: 'user-1', action: 'articles.create', entity_type: 'articles', entity_id: null, ip_address: '127.0.0.1', user_agent: 'test', created_at: '2026-01-02T00:00:00.000Z' },
    { id: 'a2', user_id: 'user-1', action: 'teams.update', entity_type: 'teams', entity_id: null, ip_address: '127.0.0.1', user_agent: 'test', created_at: '2026-01-01T00:00:00.000Z' },
  ];
}

function seedWindow(fake: FakeClient) {
  const day = (offset: number) => {
    const d = new Date(Date.now() + offset * 86400000);
    return d.toISOString().slice(0, 10);
  };
  fake.store.transfer_windows = [
    { id: 'w-active', name: 'Current', season_id: '44444444-4444-4444-8444-444444444444', start_date: day(-1), end_date: day(1) },
  ];
}

describe('step 14: admin dashboard', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedAdmin(fake);
    seedActivity(fake);
    seedWindow(fake);
  });

  it('unauthenticated -> 401, unauthorized -> 403', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    seedAdmin(fake, []);
    expect((await request(app).get(BASE).set(AUTHED)).status).toBe(403);
  });

  it('statistics match seeded data', async () => {
    const res = await request(app).get(BASE).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      articles: { total: 3, published: 2, draft: 1, archived: 0, breaking: 1 },
      transfers: { total: 2 },
      matches: { upcoming: 1, live: 0, finished: 1, today: 0 },
      teams: { total: 2 },
      players: { total: 1 },
      competitions: { total: 1 },
      seasons: { total: 1 },
      venues: { total: 1 },
      adminUsers: { total: 2, active: 1, disabled: 1 },
    });
    expect(res.body.data.activeWindow).toMatchObject({ id: 'w-active' });
  });

  it('lists: live/upcoming matches, recent articles/transfers', async () => {
    const res = await request(app).get(BASE).set(AUTHED);
    expect(res.body.data.liveMatches).toEqual([]);
    expect(res.body.data.upcomingMatches).toHaveLength(1);
    expect(res.body.data.upcomingMatches[0]).toHaveProperty('slug');
    expect(res.body.data.recentArticles).toHaveLength(3);
    expect(res.body.data.recentTransfers).toHaveLength(2);
    // Cards carry the expected fields (the in-memory fake returns full
    // stored rows regardless of SELECT columns, so exact key equality
    // is only meaningful against real PostgREST).
    const slugs = (res.body.data.recentArticles as Array<Record<string, unknown>>).map((a) => a.slug).sort();
    expect(slugs).toEqual(['big-win', 'draft-piece', 'transfer-news']);
    expect(res.body.data.recentTransfers[0]).toHaveProperty('status');
  });

  it('recent activity exposes safe audit fields only', async () => {
    const res = await request(app).get(BASE).set(AUTHED);
    const activity = res.body.data.recentActivity as Array<Record<string, unknown>>;
    expect(activity).toHaveLength(2);
    expect(activity[0]).toMatchObject({ action: 'articles.create' });
    for (const row of activity) {
      expect(row).not.toHaveProperty('ip_address');
      expect(row).not.toHaveProperty('user_agent');
    }
    expect(JSON.stringify(res.body)).not.toMatch(/service_role|sb_secret/i);
  });

  it('empty sections return zeros and empty arrays', async () => {
    fake.store.articles = [];
    fake.store.transfers = [];
    fake.store.matches = [];
    fake.store.teams = [];
    fake.store.audit_logs = [];
    fake.store.transfer_windows = [];
    const res = await request(app).get(BASE).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data.articles.total).toBe(0);
    expect(res.body.data.liveMatches).toEqual([]);
    expect(res.body.data.recentActivity).toEqual([]);
    expect(res.body.data.activeWindow).toBeNull();
  });

  it('extended counts: matches total, review/scheduled articles, rumours', async () => {
    const res = await request(app).get(BASE).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data.matches.total).toBeGreaterThanOrEqual(res.body.data.matches.finished);
    expect(res.body.data.articles).toMatchObject({ review: 0, scheduled: 0, scheduledOverdue: 0 });
    expect(typeof res.body.data.transfers.rumour).toBe('number');
    expect(res.body.data.matches).toHaveProperty('attention');
  });

  it('match cards carry enriched team and competition names', async () => {
    const res = await request(app).get(BASE).set(AUTHED);
    expect(res.status).toBe(200);
    for (const m of res.body.data.upcomingMatches as Array<Record<string, unknown>>) {
      expect(m).toHaveProperty('homeTeam');
      expect(m).toHaveProperty('awayTeam');
      expect(m).toHaveProperty('competition');
      expect(m).toHaveProperty('latestMinute');
      expect(m).toHaveProperty('home_team_id');
    }
    expect(res.body.data.recentMatches).toHaveLength(1);
  });

  it('sync health degrades honestly when no sync ever ran', async () => {
    const res = await request(app).get(BASE).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data.sync).toMatchObject({ queued: 0, running: 0, failed: 0, lastSuccessAt: null });
    expect(res.body.data.sync.byDomain.find((d: { domain: string }) => d.domain === 'matches')).toMatchObject({
      status: 'never',
    });
    expect(res.body.data.freshness).toHaveProperty('matchesAt');
  });

  it('sync health reflects seeded jobs, sources and errors', async () => {
    fake.store.data_sources = [{ id: 'ds1', name: 'Seed', provider: 'seed', is_active: true, priority: 100 }];
    fake.store.sync_jobs = [
      { id: 'j1', data_source_id: 'ds1', job_type: 'sync', entity_type: 'matches', status: 'failed', started_at: '2026-01-03T00:00:00.000Z', completed_at: '2026-01-03T01:00:00.000Z', records_processed: 10, records_failed: 2, error_message: 'timeout', created_at: '2026-01-03T00:00:00.000Z' },
      { id: 'j2', data_source_id: 'ds1', job_type: 'sync', entity_type: 'matches', status: 'completed', started_at: '2026-01-02T00:00:00.000Z', completed_at: '2026-01-02T01:00:00.000Z', records_processed: 10, records_failed: 0, error_message: null, created_at: '2026-01-02T00:00:00.000Z' },
    ];
    fake.store.sync_errors = [
      { id: 'e1', sync_job_id: 'j1', entity_type: 'matches', external_id: 'ext-9', error_code: 'TIMEOUT', error_message: 'upstream timeout', created_at: '2026-01-03T01:00:00.000Z' },
    ];
    const res = await request(app).get(BASE).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data.sync).toMatchObject({ failed: 1, completed: 1, lastFailureMessage: 'timeout' });
    expect(res.body.data.sync.sources).toMatchObject([{ name: 'Seed', isActive: true }]);
    expect(res.body.data.sync.byDomain.find((d: { domain: string }) => d.domain === 'matches')).toMatchObject({
      status: 'failed',
    });
    expect(res.body.data.sync.recentErrors[0]).toMatchObject({ errorCode: 'TIMEOUT' });
    expect(res.body.data.sync.recentErrors[0]).not.toHaveProperty('payload');
  });

  it('query failure -> sanitized 503 envelope', async () => {
    fake.failTables.add('articles');
    const res = await request(app).get(BASE).set(AUTHED);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('UPSTREAM_ERROR');
    expect(typeof res.body.requestId).toBe('string');
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|FROM/i);
  });
});

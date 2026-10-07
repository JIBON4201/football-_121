import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { assertTransferIntegrity } from '../src/providers/persist';
import { app, installTestEnv } from './helpers';
import type { FakeClient } from './fake';

const COMPLETED_ID = '11111111-1111-4111-8111-111111111111';
const RUMOUR_ID = '33333333-3333-4333-8333-333333333333';
const SEASON_ID = '22222222-2222-4222-8222-222222222222';

function addWindow(fake: FakeClient, overrides: Record<string, unknown> = {}): void {
  fake.store.transfer_windows = fake.store.transfer_windows ?? [];
  fake.store.transfer_windows.push({
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Summer 2026',
    season_id: SEASON_ID,
    start_date: '2026-06-01',
    end_date: '2026-09-01',
    ...overrides,
  });
}

describe('transfer integrity rules', () => {
  const base = {
    externalId: 'ext-1',
    playerExternalId: 'p-ext',
    fromTeamExternalId: 'a-ext',
    toTeamExternalId: 'b-ext',
    transferType: 'permanent' as const,
    status: 'announced' as const,
    seasonExternalId: 's-ext',
  };
  const ids = { fromId: 'team-a', toId: 'team-b' };

  it('accepts a well-formed transfer', () => {
    expect(() =>
      assertTransferIntegrity(
        { ...base, fee: 1000, currency: 'EUR', announcementDate: '2026-06-20', effectiveDate: '2026-07-01' },
        ids,
      ),
    ).not.toThrow();
  });

  it('accepts a transfer with no fee, currency or dates', () => {
    expect(() => assertTransferIntegrity({ ...base }, ids)).not.toThrow();
  });

  it('accepts an ISO timestamp as well as a calendar date', () => {
    expect(() =>
      assertTransferIntegrity(
        { ...base, announcementDate: '2026-06-20T10:00:00.000Z', effectiveDate: '2026-07-01T00:00:00.000Z' },
        ids,
      ),
    ).not.toThrow();
  });

  it('rejects a self-transfer', () => {
    expect(() => assertTransferIntegrity({ ...base }, { fromId: 'team-a', toId: 'team-a' })).toThrow(
      /same source and destination/i,
    );
  });

  it('rejects a negative or non-numeric fee', () => {
    expect(() => assertTransferIntegrity({ ...base, fee: -1, currency: 'EUR' }, ids)).toThrow(/non-negative/i);
    expect(() => assertTransferIntegrity({ ...base, fee: Number.NaN }, ids)).toThrow(/non-negative/i);
  });

  it('requires a valid currency when a fee is present', () => {
    expect(() => assertTransferIntegrity({ ...base, fee: 1000 }, ids)).toThrow(/currency/i);
    expect(() => assertTransferIntegrity({ ...base, fee: 1000, currency: 'eur' }, ids)).toThrow(/currency/i);
    // A zero fee needs no currency: nothing is being paid.
    expect(() => assertTransferIntegrity({ ...base, fee: 0 }, ids)).not.toThrow();
  });

  it('rejects malformed dates and an impossible ordering', () => {
    expect(() => assertTransferIntegrity({ ...base, announcementDate: 'summer 2026' }, ids)).toThrow(/ISO-8601/i);
    expect(() => assertTransferIntegrity({ ...base, effectiveDate: '01/07/2026' }, ids)).toThrow(/ISO-8601/i);
    expect(() =>
      assertTransferIntegrity({ ...base, announcementDate: '2026-07-01', effectiveDate: '2026-06-01' }, ids),
    ).toThrow(/cannot precede/i);
  });

  it('tolerates a one-sided move with no source team', () => {
    expect(() => assertTransferIntegrity({ ...base }, { fromId: null, toId: 'team-b' })).not.toThrow();
  });
});

describe('transfers API', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('lists confirmed transfers by default and hides rumours', async () => {
    const res = await request(app).get('/api/v1/transfers');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(COMPLETED_ID);
    expect(res.body.data[0].status).toBe('completed');
    expect(res.body.pagination.total).toBe(1);
  });

  it('serves a rumour only when it is explicitly acknowledged', async () => {
    const rejected = await request(app).get('/api/v1/transfers?status=rumour');
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('VALIDATION_ERROR');

    const allowed = await request(app).get('/api/v1/transfers?status=rumour&includeUnconfirmed=true');
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toHaveLength(1);
    expect(allowed.body.data[0].status).toBe('rumour');
  });

  it('rejects an unknown status and an unknown sort field', async () => {
    expect((await request(app).get('/api/v1/transfers?status=maybe')).status).toBe(400);
    expect((await request(app).get('/api/v1/transfers?sortField=fee')).status).toBe(400);
  });

  it('filters by type, team, player, season and window', async () => {
    expect((await request(app).get('/api/v1/transfers?type=loan')).body.data).toHaveLength(0);
    const permanent = await request(app).get('/api/v1/transfers?type=permanent');
    expect(permanent.body.data).toHaveLength(1);

    const byPlayer = await request(app).get('/api/v1/transfers?player=john-doe');
    expect(byPlayer.body.data).toHaveLength(1);
    const unknownPlayer = await request(app).get('/api/v1/transfers?player=no-such-player');
    expect(unknownPlayer.body.data).toHaveLength(0);

    const outgoing = await request(app).get('/api/v1/transfers?fromTeam=fc-example');
    expect(outgoing.body.data).toHaveLength(1);
    const wrongSide = await request(app).get('/api/v1/transfers?fromTeam=real-sample');
    expect(wrongSide.body.data).toHaveLength(0);
    const incoming = await request(app).get('/api/v1/transfers?toTeam=real-sample');
    expect(incoming.body.data).toHaveLength(1);
    const eitherSide = await request(app).get('/api/v1/transfers?team=real-sample');
    expect(eitherSide.body.data).toHaveLength(1);

    expect((await request(app).get(`/api/v1/transfers?season=${SEASON_ID}`)).body.data).toHaveLength(1);
    expect((await request(app).get('/api/v1/transfers?window=44444444-4444-4444-8444-444444444444')).body.data).toHaveLength(0);
  });

  it('filters by announcement and effective date ranges', async () => {
    const hit = await request(app).get('/api/v1/transfers?effectiveFrom=2026-01-01&effectiveTo=2026-12-31');
    expect(hit.body.data).toHaveLength(1);
    const miss = await request(app).get('/api/v1/transfers?effectiveFrom=2027-01-01');
    expect(miss.body.data).toHaveLength(0);
  });

  it('sorts by the requested date field and direction', async () => {
    const desc = await request(app).get('/api/v1/transfers?sort=desc&sortField=announcement_date');
    expect(desc.status).toBe(200);
    const asc = await request(app).get('/api/v1/transfers?sort=asc&sortField=announcement_date');
    expect(asc.status).toBe(200);
  });

  it('returns a stable, non-overlapping page', async () => {
    const first = await request(app).get('/api/v1/transfers?page=1&limit=1&sort=desc');
    const second = await request(app).get('/api/v1/transfers?page=2&limit=1&sort=desc');
    expect(first.body.data).toHaveLength(1);
    expect(second.body.data).toHaveLength(0);
    expect(first.body.data[0].id).not.toBe(second.body.data[0]?.id);
  });

  it('rejects an invalid id and returns a transfer by id', async () => {
    const found = await request(app).get(`/api/v1/transfers/${COMPLETED_ID}`);
    expect(found.status).toBe(200);
    expect(found.body.data.id).toBe(COMPLETED_ID);

    const bad = await request(app).get('/api/v1/transfers/not-a-uuid');
    expect(bad.status).toBe(400);
  });

  it('resolves a transfer detail without per-row queries', async () => {
    const { fake } = installTestEnv();
    // The seeded transfer points at a season the fixture store does not hold,
    // so it is added here to exercise the resolved path.
    fake.store.seasons.push({
      id: SEASON_ID,
      competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      name: '2026/27',
      is_current: true,
    });
    const before = fake.queries.length;
    const res = await request(app).get(`/api/v1/transfers/${COMPLETED_ID}/details`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.player.slug).toBe('john-doe');
    expect(data.fromTeam.slug).toBe('fc-example');
    expect(data.toTeam.slug).toBe('real-sample');
    expect(data.season).not.toBeNull();
    expect(data.season.name).toBe('2026/27');
    // Constant query count: no lookup per relation.
    expect(fake.queries.length - before).toBeLessThanOrEqual(8);
  });

  it('leaves a dangling season reference unresolved rather than inventing one', async () => {
    const res = await request(app).get(`/api/v1/transfers/${COMPLETED_ID}/details`);
    expect(res.status).toBe(200);
    expect(res.body.data.season).toBeNull();
    expect(res.body.data.competition).toBeNull();
  });

  it('404s a rumour detail rather than presenting it as a confirmed move', async () => {
    const res = await request(app).get(`/api/v1/transfers/${RUMOUR_ID}/details`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('resolves the competition through the transfer season', async () => {
    const { fake } = installTestEnv();
    // The seeded transfer's season belongs to the Premier League.
    fake.store.seasons.push({
      id: SEASON_ID,
      competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      name: '2026/27',
      is_current: true,
    });
    fake.store.transfers[0].season_id = SEASON_ID;
    const res = await request(app).get(`/api/v1/transfers/${COMPLETED_ID}/details`);
    expect(res.body.data.competition).not.toBeNull();
    expect(res.body.data.competition.slug).toBe('premier-league');
  });

  it('lists transfer windows and does not assume a window per season', async () => {
    const { fake } = installTestEnv();
    addWindow(fake);
    const res = await request(app).get('/api/v1/transfers/windows');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ name: 'Summer 2026', start_date: '2026-06-01', end_date: '2026-09-01' });

    const scoped = await request(app).get(`/api/v1/transfers/windows?season=${SEASON_ID}`);
    expect(scoped.body.data).toHaveLength(1);
    const otherSeason = await request(app).get('/api/v1/transfers/windows?season=99999999-9999-4999-8999-999999999999');
    // A season with no window returns nothing rather than an error.
    expect(otherSeason.status).toBe(200);
    expect(otherSeason.body.data).toHaveLength(0);
  });

  it('resolves a transfer detail window when one is linked', async () => {
    const { fake } = installTestEnv();
    addWindow(fake);
    fake.store.transfers[0].window_id = '44444444-4444-4444-8444-444444444444';
    const res = await request(app).get(`/api/v1/transfers/${COMPLETED_ID}/details`);
    expect(res.body.data.window).toMatchObject({ name: 'Summer 2026' });
  });

  it('surfaces a data failure instead of an empty list', async () => {
    const { fake } = installTestEnv();
    fake.failTables.add('transfers');
    const res = await request(app).get('/api/v1/transfers');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.data).toBeUndefined();
  });
});

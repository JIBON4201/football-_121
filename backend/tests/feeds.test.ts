import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';

describe('curated feeds and extended filters', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('breaking news returns flagged articles only', async () => {
    const res = await request(app).get('/api/v1/news/breaking?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('transfer-news');
  });

  it('latest news orders newest first', async () => {
    const res = await request(app).get('/api/v1/news/latest?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('transfer-news');
  });

  it('live feed is empty without live fixtures', async () => {
    const res = await request(app).get('/api/v1/matches/live');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('live feed keeps a suspended match, which has not finished', async () => {
    const { fake } = installTestEnv();
    const match = fake.store.matches.find((row) => row.status === 'scheduled');
    (match as { status: string }).status = 'suspended';

    const res = await request(app).get('/api/v1/matches/live');
    expect(res.status).toBe(200);
    // A halted match must stay on the live feed: excluding it would hide the
    // fixture exactly when a reader wants to know it is suspended.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('suspended');
  });

  it('live feed reports a server-time anchor and no provider internals', async () => {
    const res = await request(app).get('/api/v1/matches/live');
    expect(res.status).toBe(200);
    expect(typeof res.body.meta.server_time).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.meta.server_time))).toBe(false);
    // Only an anchor: no upstream host, key or sync metadata may leak out.
    const serialized = JSON.stringify(res.body.meta);
    expect(serialized).not.toMatch(/api_?key|provider|feed_?url|secret/i);
  });

  it('upcoming feed filters by team and competition', async () => {
    const all = await request(app).get('/api/v1/matches/upcoming');
    expect(all.body.data).toHaveLength(1);

    const byTeam = await request(app).get('/api/v1/matches/upcoming?team=real-sample');
    expect(byTeam.body.data).toHaveLength(1);

    const byComp = await request(app).get('/api/v1/matches/upcoming?competition=premier-league');
    expect(byComp.body.data).toHaveLength(1);
  });

  it('today and finished feeds behave', async () => {
    const today = await request(app).get('/api/v1/matches/today');
    expect(today.status).toBe(200);
    expect(today.body.data).toHaveLength(0);

    const finished = await request(app).get('/api/v1/matches/finished?limit=5');
    expect(finished.body.data).toHaveLength(1);
  });

  it('matches support season filtering', async () => {
    const seasonId = '44444444-4444-4444-8444-444444444444';
    const res = await request(app).get(`/api/v1/matches?season=${seasonId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    const bad = await request(app).get('/api/v1/matches?season=not-a-uuid');
    expect(bad.status).toBe(400);
  });

  it('transfers support from/to team and date filters', async () => {
    const from = await request(app).get('/api/v1/transfers?fromTeam=fc-example');
    expect(from.body.data).toHaveLength(1);

    const to = await request(app).get('/api/v1/transfers?toTeam=real-sample');
    expect(to.body.data).toHaveLength(1);

    const dated = await request(app).get('/api/v1/transfers?effectiveFrom=2026-01-01&effectiveTo=2026-12-31');
    expect(dated.body.data).toHaveLength(1);

    const empty = await request(app).get('/api/v1/transfers?effectiveFrom=2030-01-01');
    expect(empty.body.data).toHaveLength(0);

    const bad = await request(app).get('/api/v1/transfers?window=not-a-uuid');
    expect(bad.status).toBe(400);
  });
});

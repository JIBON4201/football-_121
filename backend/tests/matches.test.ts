import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';

describe('matches API', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('lists matches with pagination', async () => {
    const res = await request(app).get('/api/v1/matches');
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.headers['cache-control']).toContain('public');
  });

  it('supports phase filters', async () => {
    const upcoming = await request(app).get('/api/v1/matches?phase=upcoming');
    expect(upcoming.body.data).toHaveLength(1);
    expect(upcoming.body.data[0].slug).toBe('fc-example-vs-real-sample');

    const finished = await request(app).get('/api/v1/matches?phase=finished');
    expect(finished.body.data).toHaveLength(1);
    expect(finished.body.data[0].slug).toBe('real-sample-vs-fc-example');
  });

  it('supports exact status and date filters', async () => {
    const res = await request(app).get('/api/v1/matches?status=finished&from=2019-01-01&to=2021-01-01');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('rejects invalid status and dates', async () => {
    const badStatus = await request(app).get('/api/v1/matches?status=playing');
    expect(badStatus.status).toBe(400);
    const badDate = await request(app).get('/api/v1/matches?from=not-a-date');
    expect(badDate.status).toBe(400);
  });

  it('filters by team on either side of the fixture', async () => {
    const res = await request(app).get('/api/v1/matches?team=fc-example');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns empty list for unknown team filter', async () => {
    const res = await request(app).get('/api/v1/matches?team=no-such-team');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns match detail and 404s cleanly', async () => {
    const found = await request(app).get('/api/v1/matches/fc-example-vs-real-sample');
    expect(found.status).toBe(200);
    expect(found.body.data.slug).toBe('fc-example-vs-real-sample');

    const missing = await request(app).get('/api/v1/matches/no-such-match');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});

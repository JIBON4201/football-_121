import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';

/**
 * Public country reference endpoint.
 *
 * Added because countries had no read route at all: the team/player/competition
 * repositories joined the table internally, but nothing exposed the set, so the
 * Control Center could not populate a country picker without hardcoding options.
 * Read through the anon client, matching `countries_select_public`.
 */
describe('countries', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('lists countries with a standard envelope', async () => {
    const res = await request(app).get('/api/v1/countries');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ name: 'England', slug: 'england', code: 'ENG' });
    expect(res.body.pagination).toMatchObject({ page: 1 });
    expect(res.body.requestId).toBeTruthy();
  });

  it('returns a single country by slug', async () => {
    const res = await request(app).get('/api/v1/countries/england');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('England');
  });

  it('404s an unknown slug rather than leaking an empty row', async () => {
    const res = await request(app).get('/api/v1/countries/atlantis');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed slug before touching the database', async () => {
    // slugSchema is the same one the other reference routes use.
    const res = await request(app).get('/api/v1/countries/not a slug');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is publicly cacheable like the other reference reads', async () => {
    const res = await request(app).get('/api/v1/countries');
    expect(res.headers['cache-control']).toContain('public');
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
  });

  it('requires no authentication', async () => {
    // No Authorization header: the route must still serve the reader.
    const res = await request(app).get('/api/v1/countries');
    expect(res.status).toBe(200);
  });

  it('clamps an oversized page size instead of allowing an unbounded scan', async () => {
    // `paginateInput` caps every list route at `config.pagination.maxLimit`, so an
    // oversized limit is reduced rather than rejected. Assert the clamp: the
    // response must never echo back a limit large enough to be a denial-of-service.
    const res = await request(app).get('/api/v1/countries?limit=100000');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBeLessThanOrEqual(100);
  });

  it('rejects a non-numeric page size', async () => {
    const res = await request(app).get('/api/v1/countries?limit=abc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryCacheStore, setCacheStore } from '../src/lib/cache';
import { matchesService } from '../src/services/matches.service';
import { newsService } from '../src/services/news.service';
import { teamsService } from '../src/services/teams.service';
import { app, installTestEnv } from './helpers';
import type { FakeClient } from './fake';

describe('service caching', () => {
  let fake: FakeClient;
  let store: MemoryCacheStore;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    store = new MemoryCacheStore();
    setCacheStore(store);
  });

  it('serves repeated public reads from cache', async () => {
    await request(app).get('/api/v1/teams/fc-example');
    const afterFirst = fake.queries.length;
    expect(afterFirst).toBeGreaterThan(0);

    await request(app).get('/api/v1/teams/fc-example');
    expect(fake.queries.length).toBe(afterFirst);
    expect(store.size()).toBeGreaterThan(0);
  });

  it('keys include filters and pagination', async () => {
    await request(app).get('/api/v1/news?limit=5');
    const afterFirst = fake.queries.length;
    await request(app).get('/api/v1/news?limit=5');
    expect(fake.queries.length).toBe(afterFirst);

    await request(app).get('/api/v1/news?limit=6');
    expect(fake.queries.length).toBeGreaterThan(afterFirst);
  });

  it('invalidation hooks force a refresh', async () => {
    await request(app).get('/api/v1/matches/fc-example-vs-real-sample/details');
    const afterFirst = fake.queries.length;

    await request(app).get('/api/v1/matches/fc-example-vs-real-sample/details');
    expect(fake.queries.length).toBe(afterFirst);

    await matchesService.invalidate();
    await request(app).get('/api/v1/matches/fc-example-vs-real-sample/details');
    expect(fake.queries.length).toBeGreaterThan(afterFirst);
  });

  it('invalidation hooks exist for every service namespace', async () => {
    await newsService.invalidate();
    await teamsService.invalidate();
    expect(store.size()).toBe(0);
  });

  it('private responses are never cached', async () => {
    await request(app).get('/api/v1/me').set('Authorization', 'Bearer valid-token');
    await request(app).get('/api/v1/me').set('Authorization', 'Bearer valid-token');
    expect(store.size()).toBe(0);
  });
});

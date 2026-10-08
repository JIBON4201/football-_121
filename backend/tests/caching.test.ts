import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { cached, MemoryCacheStore, resetCacheStore, setCacheStore } from '../src/lib/cache';
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

  it('admin responses are never cached', async () => {
    fake.store.roles = [{ id: 2, name: 'admin' }];
    fake.store.admin_permissions = [{ id: 'p-1', key: 'articles.read', resource: 'articles', action: 'read' }];
    fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
    fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
    fake.store.admin_role_permissions = [{ role_id: 2, permission_id: 'p-1' }];
    const first = await request(app).get('/api/v1/admin/ping').set('Authorization', 'Bearer valid-token');
    expect(first.status).toBe(200);
    const second = await request(app).get('/api/v1/admin/ping').set('Authorization', 'Bearer valid-token');
    expect(second.status).toBe(200);
    expect(store.size()).toBe(0);
  });
});

describe('MemoryCacheStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves a value until its TTL expires, then misses', async () => {
    const store = new MemoryCacheStore();
    await store.set('k', 'v', 30);
    vi.advanceTimersByTime(29_000);
    expect(await store.get('k')).toBe('v');
    vi.advanceTimersByTime(2_000);
    expect(await store.get('k')).toBeNull();
  });

  it('expires entries cached through cached() after the TTL', async () => {
    setCacheStore(new MemoryCacheStore());
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return { loads };
    };
    await cached('ttl-test', { a: 1 }, 30, loader);
    vi.advanceTimersByTime(31_000);
    const value = await cached('ttl-test', { a: 1 }, 30, loader);
    expect(loads).toBe(2);
    expect(value.loads).toBe(2);
    resetCacheStore();
  });

  it('evicts the oldest entry once maxEntries is reached', async () => {
    const store = new MemoryCacheStore(2);
    await store.set('a', '1', 60);
    await store.set('b', '2', 60);
    await store.set('c', '3', 60);
    expect(store.size()).toBe(2);
    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBe('2');
    expect(await store.get('c')).toBe('3');
  });
});

describe('cache bootstrap', () => {
  afterEach(() => {
    resetCacheStore();
  });

  it('createApp installs a working store: first call loads, second hits cache', async () => {
    resetCacheStore();
    createApp();
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return { ok: true };
    };
    await cached('bootstrap-test', { q: 1 }, 60, loader);
    const hit = await cached('bootstrap-test', { q: 1 }, 60, loader);
    expect(loads).toBe(1);
    expect(hit).toEqual({ ok: true });
  });
});

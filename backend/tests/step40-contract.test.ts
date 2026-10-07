/**
 * Step 40 — end-to-end integration verification against the API surface.
 *
 * These lock in the Step 40 contract as a permanent regression suite using the
 * in-memory database fake, so contract drift fails CI rather than being
 * discovered during a production verification pass.
 *
 * Covers: public access without login, response schema stability, pagination,
 * validation and error format, cache headers, live-cache safety, graceful
 * degradation when the database fails, and sitemap/robots delivery.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { MemoryCacheStore, setCacheStore } from '../src/lib/cache';
import { app, installTestEnv } from './helpers';
import type { FakeClient } from './fake';
import {
  LIST_ENDPOINTS,
  validateCacheHeaders,
  validateEnvelope,
  validateErrorEnvelope,
  validatePagination,
  validateRobotsTxt,
  validateSecurityHeaders,
  validateXml,
} from '../src/verify/httpChecks';

const API = '/api/v1';

/** Paths for list endpoints on the running app (httpChecks uses a base URL). */
const LIST_PATHS = LIST_ENDPOINTS.map((endpoint) => endpoint.path.replace('/api/v1', API));

const OBJECT_PATHS = [`${API}/health`, `${API}/health/database`, `${API}/docs.json`];

describe('step 40: public access requires no login', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  it('serves every public list endpoint anonymously with 200', async () => {
    for (const path of LIST_PATHS) {
      const res = await request(app).get(path);
      expect(res.status, `${path} should be public`).toBe(200);
      expect(res.body.requestId, `${path} should return a request id`).toBeDefined();
    }
  });

  it('serves every public object endpoint anonymously with 200', async () => {
    for (const path of OBJECT_PATHS) {
      const res = await request(app).get(path);
      expect(res.status, `${path} should be public`).toBe(200);
    }
  });

  it('returns the same public payload with and without a bearer token', async () => {
    const anonymous = await request(app).get(`${API}/news`);
    const withToken = await request(app).get(`${API}/news`).set('Authorization', 'Bearer valid-token');
    expect(withToken.status).toBe(200);
    expect(withToken.body.data).toEqual(anonymous.body.data);
  });
});

describe('step 40: response schema stability', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('every list endpoint returns the validated envelope and pagination', async () => {
    for (const path of LIST_PATHS) {
      const res = await request(app).get(path);
      const envelope = validateEnvelope(res.body, path);
      expect(envelope.problems, `${path}: ${envelope.problems.join('; ')}`).toEqual([]);

      const pagination = validatePagination(res.body, {}, path);
      expect(pagination.problems, `${path}: ${pagination.problems.join('; ')}`).toEqual([]);
    }
  });

  it('honours page and limit and clamps limit to the server maximum', async () => {
    const res = await request(app).get(`${API}/matches?page=2&limit=2`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.limit).toBe(2);

    const clamped = await request(app).get(`${API}/matches?limit=100000`);
    expect(clamped.status).toBe(200);
    expect(clamped.body.pagination.limit).toBe(config.pagination.maxLimit);
  });

  it('never echoes provider-internal fields to clients', async () => {
    for (const path of [...LIST_PATHS, ...OBJECT_PATHS]) {
      const res = await request(app).get(path);
      const serialized = JSON.stringify(res.body);
      expect(serialized, `${path} must not expose service role keys`).not.toContain('service_role');
      expect(serialized, `${path} must not expose raw provider payloads`).not.toContain('rawResponse');
    }
  });
});

describe('step 40: validation and error format', () => {
  beforeEach(() => {
    installTestEnv();
  });

  const invalidRequests: { name: string; path: string; status: number }[] = [
    { name: 'invalid match status', path: `${API}/matches?status=playing`, status: 400 },
    { name: 'invalid date', path: `${API}/matches?from=not-a-date`, status: 400 },
    { name: 'unknown transfer status', path: `${API}/transfers?status=nonsense`, status: 400 },
    { name: 'non-uuid transfer id', path: `${API}/transfers/not-a-uuid`, status: 400 },
    { name: 'unknown route', path: `${API}/no-such-route`, status: 404 },
    { name: 'unknown team', path: `${API}/teams/no-such-team`, status: 404 },
  ];

  it('rejects invalid input with a stable error envelope', async () => {
    for (const invalid of invalidRequests) {
      const res = await request(app).get(invalid.path);
      expect(res.status, `${invalid.name} status`).toBe(invalid.status);
      const shape = validateErrorEnvelope(res.body, invalid.name);
      expect(shape.problems, `${invalid.name}: ${shape.problems.join('; ')}`).toEqual([]);
      expect(res.body.requestId).toBeDefined();
    }
  });

  it('never leaks stack traces or driver errors in error bodies', async () => {
    const res = await request(app).get(`${API}/no-such-route`);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/at\s+\w+\s+\(/);
    expect(serialized).not.toMatch(/"stack"/);
  });
});

describe('step 40: caching behaviour', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  it('public list endpoints are explicitly cacheable', async () => {
    for (const path of [`${API}/news`, `${API}/matches`, `${API}/teams`, `${API}/competitions`]) {
      const res = await request(app).get(path);
      const check = validateCacheHeaders(res.headers as Record<string, string>, path, {
        mustBeCacheable: true,
      });
      expect(check.problems, `${path}: ${check.problems.join('; ')}`).toEqual([]);
    }
  });

  it('live data is never served with a stale cache TTL', async () => {
    const res = await request(app).get(`${API}/matches/live`);
    expect(res.status).toBe(200);
    const check = validateCacheHeaders(res.headers as Record<string, string>, 'matches/live', {
      mustNotBeStale: true,
    });
    expect(check.problems, check.problems.join('; ')).toEqual([]);
  });

  it('serves repeated reads from cache rather than re-querying', async () => {
    // The default store is a no-op; install a real one to exercise the cache path.
    setCacheStore(new MemoryCacheStore());
    await request(app).get(`${API}/teams/fc-example`);
    const afterFirst = fake.queries.length;
    expect(afterFirst).toBeGreaterThan(0);
    await request(app).get(`${API}/teams/fc-example`);
    expect(fake.queries.length).toBe(afterFirst);
  });

  it('emits HTTP Cache-Control so a CDN can cache public reads', async () => {
    const res = await request(app).get(`${API}/news`);
    expect(res.headers['cache-control']).toMatch(/public/);
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
    expect(res.headers.vary).toContain('Authorization');
  });
});

describe('step 40: security posture', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('sets the required security headers and hides the framework', async () => {
    const res = await request(app).get(`${API}/news`);
    const headers = res.headers as Record<string, string>;
    const check = validateSecurityHeaders(headers, 'GET /news');
    expect(check.problems, check.problems.join('; ')).toEqual([]);
    expect(headers['x-powered-by']).toBeUndefined();
  });

  it('legacy admin endpoints stay protected (401 unauth)', async () => {
    const adminPaths = [
      `${API}/admin/sync-jobs`,
      `${API}/admin/schedules`,
      `${API}/admin/providers/health`,
      `${API}/admin/workers/health`,
      `${API}/admin/sync-freshness`,
    ];
    for (const path of adminPaths) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });
});

describe('step 40: graceful degradation', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  it('degrades to 503 without leaking internals when the database fails', async () => {
    fake.failTables.add('countries');
    const res = await request(app).get(`${API}/health/database`);
    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('degraded');
    expect(JSON.stringify(res.body)).not.toContain('fake');
  });

  it('still serves other endpoints when one table is failing', async () => {
    fake.failTables.add('countries');
    const health = await request(app).get(`${API}/health`);
    expect(health.status).toBe(200);
    expect(health.body.data.status).toBe('ok');
  });

  it('returns empty lists rather than errors for unknown filters', async () => {
    const res = await request(app).get(`${API}/matches?team=no-such-team`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });
});

describe('step 40: SEO artifacts', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('serves a valid robots.txt that does not block assets', async () => {
    const res = await request(app).get(`${API}/robots.txt`);
    expect(res.status).toBe(200);
    const check = validateRobotsTxt(res.text, 'robots.txt');
    expect(check.problems, check.problems.join('; ')).toEqual([]);
  });

  it('serves well-formed sitemap XML', async () => {
    const index = await request(app).get(`${API}/sitemap.xml`);
    expect(index.status).toBe(200);
    expect(validateXml(index.text, 'sitemap.xml').ok).toBe(true);

    const news = await request(app).get(`${API}/news-sitemap.xml`);
    expect(news.status).toBe(200);
    expect(validateXml(news.text, 'news-sitemap.xml').ok).toBe(true);
  });

  it('rejects an unknown sitemap partition with a validation error', async () => {
    const res = await request(app).get(`${API}/sitemaps/not-a-partition.xml`);
    expect([400, 404]).toContain(res.status);
  });
});
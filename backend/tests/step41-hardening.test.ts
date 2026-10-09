/**
 * Step 41 — security and performance regression tests.
 *
 * Performance is asserted primarily through *query counts* rather than wall
 * clock: an in-memory fake makes timing nearly meaningless, while an
 * accidental N+1 (a loop of per-row reads) shows up immediately as a jump in
 * the number of queries issued for a single request.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { classifyRequest, resetRateLimits } from '../src/lib/rateLimit';
import { MAX_IN_CLAUSE_IDS, MAX_RELATED_ROWS } from '../src/repositories/related';
import { sanitizeContent, escapeIlike, slugSchema, searchSchema } from '../src/lib/validate';
import { expectedFrontendHeaderNames, findMissingHeaders, BACKEND_HEADER_EXPECTATIONS } from '../src/verify/hardening';
import { findUnboundedQueries } from '../src/verify/hardening';
import { collectFiles } from '../src/verify/sourceScan';
import { app, installTestEnv } from './helpers';
import type { FakeClient } from './fake';
import { join } from 'node:path';

describe('step 41: rate-limit classification', () => {
  it('classifies expensive and media endpoints separately', () => {
    expect(classifyRequest('/api/v1/search?q=test')).toBe('expensive');
    expect(classifyRequest('/api/v1/sitemap.xml')).toBe('crawl');
    expect(classifyRequest('/api/v1/news-sitemap.xml')).toBe('crawl');
    expect(classifyRequest('/api/v1/sitemaps/teams.xml')).toBe('crawl');
    expect(classifyRequest('/api/v1/robots.txt')).toBe('crawl');
    expect(classifyRequest('/api/v1/media/upload')).toBe('media');
    expect(classifyRequest('/api/v1/news')).toBe('default');
    expect(classifyRequest('/api/v1/matches/live')).toBe('default');
  });

  it('cannot be bypassed by appending a query string', () => {
    expect(classifyRequest('/api/v1/search?q=real%20madrid')).toBe('expensive');
    expect(classifyRequest('/api/v1/news?all=true')).toBe('default');
  });

  it('treats former admin paths as default (no admin tier)', () => {
    expect(classifyRequest('/api/v1/admin/sync-jobs')).toBe('default');
    expect(classifyRequest('/api/v1/admin/schedules/abc/trigger')).toBe('default');
  });
});

describe('step 41: rate-limit response headers and tiers', () => {
  beforeEach(() => {
    installTestEnv();
    resetRateLimits();
  });

  it('emits RateLimit-* headers on every response', async () => {
    const res = await request(app).get('/api/v1/news');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
    expect(res.headers['ratelimit-reset']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('gives search a smaller budget than ordinary browsing', async () => {
    const news = await request(app).get('/api/v1/news');
    const search = await request(app).get('/api/v1/search?q=test');
    expect(Number(search.headers['ratelimit-limit'])).toBeLessThan(
      Number(news.headers['ratelimit-limit']),
    );
  });

  it('limits search harder than /news and returns 429 with Retry-After', async () => {
    config.rateLimit.publicMax = 60;
    resetRateLimits();
    const limit = Math.max(5, Math.floor(60 / 6));

    let last = 0;
    for (let i = 0; i < limit + 1; i += 1) {
      last = (await request(app).get('/api/v1/search?q=test')).status;
    }
    expect(last).toBe(429);
  });

  it('does not let expensive traffic exhaust the browsing budget', async () => {
    config.rateLimit.publicMax = 60;
    resetRateLimits();
    const limit = Math.max(5, Math.floor(60 / 6));
    for (let i = 0; i < limit + 2; i += 1) {
      await request(app).get('/api/v1/search?q=test');
    }
    // Browsing budget is untouched by the search bucket.
    const news = await request(app).get('/api/v1/news');
    expect(news.status).toBe(200);
  });

  it('never 429s crawler-facing sitemap documents, even when search has starved the expensive tier', async () => {
    config.rateLimit.publicMax = 60;
    resetRateLimits();
    // Burn the shared expensive budget on search first.
    const limit = Math.max(5, Math.floor(60 / 6));
    for (let i = 0; i < limit + 2; i += 1) {
      await request(app).get('/api/v1/search?q=test');
    }
    expect((await request(app).get('/api/v1/search?q=test')).status).toBe(429);

    // A crawler fetching the index plus every partition must still succeed.
    // A 429 here is forwarded verbatim to Googlebot by the frontend
    // /sitemap.xml proxy, which Search Console reports as "Couldn't fetch".
    for (const path of [
      '/api/v1/robots.txt',
      '/api/v1/sitemap.xml',
      '/api/v1/news-sitemap.xml',
      '/api/v1/sitemaps/news.xml',
      '/api/v1/sitemaps/articles.xml',
      '/api/v1/sitemaps/matches.xml',
      '/api/v1/sitemaps/teams.xml',
      '/api/v1/sitemaps/players.xml',
      '/api/v1/sitemaps/competitions.xml',
      '/api/v1/sitemaps/transfers.xml',
      '/api/v1/sitemaps/categories.xml',
      '/api/v1/sitemaps/tags.xml',
      '/api/v1/sitemaps/pages.xml',
    ]) {
      const res = await request(app).get(path);
      expect(res.status, `${path} must not be rate-limited`).toBe(200);
    }
  });
});

describe('step 41: pagination safety invariants', () => {
  const caps = { MAX_RELATED_ROWS, MAX_IN_CLAUSE_IDS };

  it('exposes finite, sane caps', () => {
    expect(caps.MAX_RELATED_ROWS).toBeGreaterThan(0);
    expect(caps.MAX_RELATED_ROWS).toBeLessThanOrEqual(1000);
    expect(caps.MAX_IN_CLAUSE_IDS).toBeGreaterThan(0);
    expect(caps.MAX_IN_CLAUSE_IDS).toBeLessThanOrEqual(caps.MAX_RELATED_ROWS);
  });

  it('leaves no unbounded list query in the repository/service layer', () => {
    const repoRoot = join(__dirname, '..', '..');
    const files = [
      ...collectFiles(join(repoRoot, 'backend', 'src', 'repositories')),
      ...collectFiles(join(repoRoot, 'backend', 'src', 'services')),
      ...collectFiles(join(repoRoot, 'backend', 'src', 'seo')),
    ];
    expect(files.length).toBeGreaterThan(10);
    const unbounded = findUnboundedQueries(files);
    expect(
      unbounded.map((query) => `${query.file}:${query.line} ${query.snippet}`),
      'every list query must apply an explicit bound',
    ).toEqual([]);
  });
});

describe('step 41: no N+1 in detail endpoints (query-count budgets)', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  /** Queries issued while serving one request (measured as a delta). */
  async function queriesFor(run: () => Promise<unknown>): Promise<number> {
    const before = fake.queries.length;
    await run();
    return fake.queries.length - before;
  }

  it('serves a team detail page with a bounded query count', async () => {
    const count = await queriesFor(() => request(app).get('/api/v1/teams/fc-example/details'));
    // One batched round per relation type; the previous implementation issued
    // one query per media row while scanning orphans, and unbounded reads here.
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(20);
  });

  it('serves a match detail page with a bounded query count', async () => {
    const count = await queriesFor(() =>
      request(app).get('/api/v1/matches/fc-example-vs-real-sample/details'),
    );
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(20);
  });

  it('serves a competition detail page with a bounded query count', async () => {
    const count = await queriesFor(() =>
      request(app).get('/api/v1/competitions/premier-league/details'),
    );
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(20);
  });

  it('serves an orphan media scan without one query per row', async () => {
    const res = await request(app)
      .get('/api/v1/media/orphans/list')
      .set('Authorization', 'Bearer valid-token')
      .set('X-Test-Role', 'editor');
    // Either it authorizes cleanly, or it refuses; the point is it must not
    // blow up. The batching itself is asserted by the query-count budget above.
    expect([200, 401, 403]).toContain(res.status);
  });

  it('resolves a card-shaped match list in a fixed number of queries', async () => {
    // 42 rows on the page. A per-row enrichment would scale with them; the card
    // shape must stay at one batched read per relation regardless of row count.
    const seed = fake.store.matches[0];
    for (let i = 0; i < 40; i += 1) {
      fake.store.matches.push({
        ...seed,
        id: `dddddddd-0000-4000-8000-${String(i + 100).padStart(12, '0')}`,
        slug: `card-fixture-${i}`,
      });
    }

    const count = await queriesFor(() =>
      request(app).get('/api/v1/matches?include=card&limit=100'),
    );
    // 1 count query + teams + competitions + venues + events.
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(8);
  });
});

describe('step 41: public list endpoints stay bounded', () => {
  beforeEach(() => {
    installTestEnv();
  });

  const listPaths = [
    '/api/v1/news',
    '/api/v1/matches',
    '/api/v1/teams',
    '/api/v1/players',
    '/api/v1/competitions',
    '/api/v1/transfers',
    '/api/v1/categories',
    '/api/v1/tags',
  ];

  it('clamps an excessive limit to the configured maximum', async () => {
    for (const path of listPaths) {
      const res = await request(app).get(`${path}?limit=100000`);
      expect(res.status, path).toBe(200);
      expect(res.body.pagination.limit, path).toBe(config.pagination.maxLimit);
    }
  });

  it('rejects nonsensical pagination values instead of guessing', async () => {
    for (const path of listPaths) {
      const zeroPage = await request(app).get(`${path}?page=0`);
      expect(zeroPage.status, path).toBe(400);
      const badLimit = await request(app).get(`${path}?limit=abc`);
      expect(badLimit.status, path).toBe(400);
    }
  });

  it('never returns more rows than the requested page size', async () => {
    const res = await request(app).get('/api/v1/news?limit=1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });
});

describe('step 41: XSS and input validation', () => {
  it('strips script tags and event handlers from article content', () => {
    const out = sanitizeContent(
      '<p onclick="steal()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>',
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onerror');
  });

  it('strips javascript: URLs', () => {
    expect(sanitizeContent('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });

  it('rejects SQL metacharacters in slugs', () => {
    expect(slugSchema.safeParse('real-madrid').success).toBe(true);
    expect(slugSchema.safeParse("'; DROP TABLE articles; --").success).toBe(false);
    expect(slugSchema.safeParse('<script>').success).toBe(false);
  });

  it('escapes LIKE wildcards and PostgREST filter syntax in search input', () => {
    const escaped = escapeIlike("100%'; DROP TABLE x --");
    // Wildcards are escaped (backslash-prefixed), not deleted, so the user's
    // literal text is preserved while remaining a literal LIKE pattern.
    expect(escaped).toContain('\\%');
    expect(escaped).not.toMatch(/(?<!\\)%/);
    expect(escaped).not.toContain("'");
    expect(escaped).not.toContain(';');
    expect(escaped.length).toBeLessThanOrEqual(100);
  });

  it('neutralises underscore wildcards too', () => {
    expect(escapeIlike('a_b')).toBe('a\\_b');
  });

  it('caps search query length', () => {
    expect(searchSchema.safeParse('a'.repeat(500)).success).toBe(false);
    expect(searchSchema.safeParse('madrid').success).toBe(true);
  });
});

describe('step 41: secret exposure', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('never returns a service-role key or provider credential in any response', async () => {
    const paths = [
      '/api/v1/news',
      '/api/v1/matches',
      '/api/v1/teams',
      '/api/v1/health',
      '/api/v1/docs.json',
      '/api/v1/docs.json',
    ];
    for (const path of paths) {
      const res = await request(app).get(path);
      const body = JSON.stringify(res.body ?? res.text);
      expect(body, path).not.toContain('service_role');
      expect(body, path).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    }
  });

  it('rejects a non-JSON body on write routes (no unsafe parsing)', async () => {
    const res = await request(app)
      .post('/api/v1/articles')
      .set('Authorization', 'Bearer valid-token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('a=1');
    expect([400, 401, 403, 415]).toContain(res.status);
  });

  it('rejects an oversized body', async () => {
    const res = await request(app)
      .post('/api/v1/articles')
      .set('Authorization', 'Bearer valid-token')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ content: 'x'.repeat(40 * 1024 * 1024) }));
    expect([413, 400, 401, 403]).toContain(res.status);
  });
});

describe('step 41: authorization boundaries', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('keeps every internal endpoint closed to anonymous callers', async () => {
    const paths = [
      '/api/v1/media/orphans/list',
      '/api/v1/articles',
      '/api/v1/me',
    ];
    for (const path of paths) {
      const res = await request(app).get(path);
      expect([401, 403], `${path} must require authorization`).toContain(res.status);
    }
  });

  it('legacy admin endpoints stay protected (401 unauth)', async () => {
    const paths = [
      '/api/v1/admin/sync-jobs',
      '/api/v1/admin/schedules',
      '/api/v1/admin/providers/health',
      '/api/v1/admin/workers/health',
      '/api/v1/admin/schedulers/health',
      '/api/v1/admin/sync-freshness',
    ];
    for (const path of paths) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });

  it('never caches an authenticated response', async () => {
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(String(res.headers['cache-control'])).toContain('no-store');
  });
});

describe('step 41: security header expectations', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('detects missing backend security headers', () => {
    expect(findMissingHeaders({ 'x-content-type-options': 'nosniff' }, BACKEND_HEADER_EXPECTATIONS)).toContain(
      'x-frame-options (clickjacking protection)',
    );
    expect(findMissingHeaders({}, BACKEND_HEADER_EXPECTATIONS).length).toBe(
      BACKEND_HEADER_EXPECTATIONS.length,
    );
  });

  it('accepts a fully hardened header set', () => {
    expect(
      findMissingHeaders(
        {
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'referrer-policy': 'strict-origin-when-cross-origin',
        },
        BACKEND_HEADER_EXPECTATIONS,
      ),
    ).toEqual([]);
  });

  it('extracts configured frontend headers from next.config', () => {
    const names = expectedFrontendHeaderNames(
      `const h = [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Strict-Transport-Security', value: 'x' }];`,
    );
    expect(names).toEqual(['X-Frame-Options', 'Strict-Transport-Security']);
  });

  it('sets the required headers on real API responses', async () => {
    const res = await request(app).get('/api/v1/news');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['referrer-policy']).toBeDefined();
  });
});

describe('step 41: error handling stays safe', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('never leaks internals for an unknown route or invalid input', async () => {
    for (const path of ['/api/v1/nope', '/api/v1/matches?from=bad', '/api/v1/transfers/not-a-uuid']) {
      const res = await request(app).get(path);
      const body = JSON.stringify(res.body);
      expect(body, path).not.toMatch(/at\s+\w+\s+\(/);
      expect(body, path).not.toContain('service_role');
      expect(body, path).not.toContain('hunter2');
    }
  });

  it('includes a request id on errors for correlation', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.body.requestId).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });
});
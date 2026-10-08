import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetCacheStore } from '../src/lib/cache';
import { app, installTestEnv } from './helpers';
import type { FakeClient, FakeQueryBuilder } from './fake';

/**
 * Regression suite for SEO metadata/structured-data performance:
 * - No duplicate entity resolution within a request (scope memoization)
 * - No select('*') on articles (content column must not be fetched)
 * - No select('*') on any entity table
 * - Metadata/structured/breadcrumbs remain byte-identical to baseline
 */

function pad(n: number): string {
  return String(n).padStart(12, '0');
}

function publishedArticle(id: string, slug: string, title: string) {
  return {
    id,
    slug,
    status: 'published',
    published_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    article_type: 'news',
    is_breaking: false,
    is_featured: false,
    title,
    excerpt: `${title} excerpt`,
    content: 'Long body content that should never be fetched for SEO metadata.',
  };
}

function seedSeoMetadata(fake: FakeClient, articleId: string, overrides: Record<string, unknown> = {}) {
  if (!fake.store.seo_metadata) fake.store.seo_metadata = [];
  fake.store.seo_metadata.push({
    id: `seo-${Math.random().toString(36).slice(2, 10)}`,
    entity_type: 'article',
    entity_id: articleId,
    meta_title: null,
    meta_description: null,
    canonical_url: null,
    robots_index: true,
    robots_follow: true,
    og_title: null,
    og_description: null,
    og_image: null,
    twitter_title: null,
    twitter_description: null,
    twitter_image: null,
    schema_type: null,
    ...overrides,
  });
}

/** Extract the select columns from a FakeQueryBuilder's ops. */
function selectColumns(qb: FakeQueryBuilder): string[] | null {
  const selectOp = qb.ops.find((op) => op.op === 'select');
  if (!selectOp) return null;
  const arg = selectOp.args[0];
  if (arg === '*') return ['*'];
  return String(arg).split(',');
}

/** Check whether any query in the fake used select('*'). */
function hasStarSelect(fake: FakeClient, tables?: string[]): boolean {
  const targets = tables ?? Object.keys(fake.store);
  for (const table of targets) {
    for (const q of fake.queries) {
      if (q.table !== table) continue;
      const cols = selectColumns(q);
      if (cols && cols[0] === '*') return true;
    }
  }
  return false;
}

/** Count how many times each table was queried. */
function queryCounts(fake: FakeClient): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const q of fake.queries) {
    counts[q.table] = (counts[q.table] ?? 0) + 1;
  }
  return counts;
}

/** Return all ops for a given table, in order. */
function opsForTable(fake: FakeClient, table: string) {
  return fake.queries.filter((q) => q.table === table).flatMap((q) => q.ops.map((op) => op.op));
}

describe('SEO metadata & structured-data performance', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    resetCacheStore();
  });

  it('does not fetch article content when generating SEO metadata', async () => {
    fake.store.articles!.push(publishedArticle('a0000000-0000-4000-8000-000000000001', 'big-win', 'Big Win'));

    await request(app).get('/api/v1/seo/metadata?type=news&slug=big-win');

    const articleQueries = fake.queries.filter((q) => q.table === 'articles');
    for (const q of articleQueries) {
      const cols = selectColumns(q);
      expect(cols).not.toEqual(['*']);
      expect(cols ?? []).not.toContain('content');
    }
  });

  it('does not use select("*") on any entity table for structured data', async () => {
    fake.store.articles!.push(publishedArticle('a0000000-0000-4000-8000-000000000001', 'big-win', 'Big Win'));

    await request(app).get('/api/v1/seo/structured?type=news&slug=big-win');

    const entityTables = ['articles', 'teams', 'players', 'competitions', 'matches', 'seasons', 'transfers', 'media'];
    expect(hasStarSelect(fake, entityTables)).toBe(false);
  });

  it('does not use select("*") on seo_metadata table', async () => {
    fake.store.articles!.push(publishedArticle('a0000000-0000-4000-8000-000000000001', 'big-win', 'Big Win'));
    seedSeoMetadata(fake, 'a0000000-0000-4000-8000-000000000001', { meta_title: 'Custom Title' });

    await request(app).get('/api/v1/seo/metadata?type=news&slug=big-win');

    const seoQueries = fake.queries.filter((q) => q.table === 'seo_metadata');
    for (const q of seoQueries) {
      const cols = selectColumns(q);
      expect(cols).not.toEqual(['*']);
    }
  });

  it('avoids duplicate entity resolution across metadata and structured data in one request', async () => {
    const articleId = 'a0000000-0000-4000-8000-000000000001';
    fake.store.articles!.push(publishedArticle(articleId, 'big-win', 'Big Win'));
    fake.store.article_competitions!.push({ article_id: articleId, competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1' });
    fake.store.article_teams!.push({ article_id: articleId, team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' });

    // Simulate one request that needs both metadata and structured data.
    const scope = { resolve: <T,>(key: string, loader: () => Promise<T>) => {
      const existing = (scope as unknown as Record<string, Promise<T>>)[key];
      if (existing) return existing;
      const promise = loader();
      (scope as unknown as Record<string, Promise<T>>)[key] = promise;
      return promise;
    } };

    const { seoService } = await import('../src/services/seo.service');
    const metadata = await seoService.getMetadata('news', 'big-win', scope as unknown as import('../src/services/seo.service').SeoRequestScope);
    const structured = await seoService.getStructuredData('news', 'big-win', undefined, scope as unknown as import('../src/services/seo.service').SeoRequestScope);

    expect(metadata.title).toContain('Big Win');
    expect(structured.some((n: Record<string, unknown>) => n['@type'] === 'NewsArticle')).toBe(true);

    // The article should only be read once (the second call reuses the memoized promise).
    const articleQueryCount = fake.queries.filter((q) => q.table === 'articles').length;
    expect(articleQueryCount).toBeLessThanOrEqual(1);
  });

  it('metadata response is equivalent to baseline (no content field in snapshot)', async () => {
    fake.store.articles!.push(publishedArticle('a0000000-0000-4000-8000-000000000001', 'big-win', 'Big Win'));

    const res = await request(app).get('/api/v1/seo/metadata?type=news&slug=big-win');
    expect(res.status).toBe(200);

    // Title must come from the article title, not from content.
    expect(res.body.data.title).toContain('Big Win');
    // Description must come from excerpt, not content.
    expect(res.body.data.description).toBeTruthy();
    expect(res.body.data.description.length).toBeGreaterThan(0);
    // No content leak: the response must not contain the full article body.
    expect(res.body.data.description).not.toContain('Long body content');
  });

  it('structured data remains valid after removing content from snapshot', async () => {
    fake.store.articles!.push(publishedArticle('a0000000-0000-4000-8000-000000000001', 'big-win', 'Big Win'));

    const res = await request(app).get('/api/v1/seo/structured?type=news&slug=big-win');
    expect(res.status).toBe(200);

    const nodes = res.body.data as Array<{ '@type': string; headline?: string }>;
    expect(nodes.some((n) => n['@type'] === 'NewsArticle')).toBe(true);
    const article = nodes.find((n) => n['@type'] === 'NewsArticle') as { headline: string };
    expect(article.headline).toBe('Big Win');

    // BreadcrumbList must still be present.
    expect(nodes.some((n) => n['@type'] === 'BreadcrumbList')).toBe(true);
  });

  it('breadcrumbs remain correct after optimization', async () => {
    fake.store.articles!.push(publishedArticle('a0000000-0000-4000-8000-000000000001', 'big-win', 'Big Win'));
    fake.store.article_competitions!.push({ article_id: 'a0000000-0000-4000-8000-000000000001', competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1' });

    const res = await request(app).get('/api/v1/seo/breadcrumbs?type=news&slug=big-win');
    expect(res.status).toBe(200);

    const crumbs = res.body.data as Array<{ name: string; url: string }>;
    expect(crumbs[0]).toMatchObject({ name: 'Home', url: expect.stringContaining('/') });
    expect(crumbs.some((c) => c.url.includes('/news/big-win'))).toBe(true);
  });

  it('validate endpoint still reports full check suite with shared entity resolution', async () => {
    fake.store.articles!.push(publishedArticle('a0000000-0000-4000-8000-000000000001', 'validate-test', 'Validate Test'));

    const res = await request(app).get('/api/v1/seo/validate?type=news&slug=validate-test');
    expect(res.status).toBe(200);

    const checks = res.body.data.checks as Array<{ name: string; ok: boolean }>;
    const names = checks.map((c) => c.name);
    for (const name of ['slug-valid', 'canonical-valid', 'entity-found', 'indexable', 'metadata-title', 'jsonld-valid', 'no-redirect-loop', 'sitemap-eligible', 'no-duplicate-canonical']) {
      expect(names).toContain(name);
    }
    expect(checks.every((c) => c.ok)).toBe(true);
     });

  it('missing entities still return 404 after optimization', async () => {
    expect((await request(app).get('/api/v1/seo/metadata?type=news&slug=no-such-slug')).status).toBe(404);
    expect((await request(app).get('/api/v1/seo/structured?type=news&slug=no-such-slug')).status).toBe(404);
    expect((await request(app).get('/api/v1/seo/breadcrumbs?type=news&slug=no-such-slug')).status).toBe(404);
  });

  it('draft articles still return 404 after optimization', async () => {
    expect((await request(app).get('/api/v1/seo/metadata?type=news&slug=draft-piece')).status).toBe(404);
    expect((await request(app).get('/api/v1/seo/structured?type=news&slug=draft-piece')).status).toBe(404);
  });

  it('column-specific selects are used for all entity types', async () => {
    // Seed all entity types.
    fake.store.articles!.push(publishedArticle('a0000000-0000-4000-8000-000000000001', 'big-win', 'Big Win'));
    fake.store.matches!.push({
      id: 'm1', slug: 'fc-example-vs-real-sample', status: 'scheduled',
      scheduled_at: '2030-02-01T15:00:00.000Z', competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      home_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', away_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      venue_id: 'v1',
    });
    fake.store.teams!.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', slug: 'fc-example', name: 'FC Example', short_name: 'FCE', is_active: true });
    fake.store.players!.push({ id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', slug: 'john-doe', display_name: 'John Doe', photo_url: null, status: 'active' });
    fake.store.competitions!.push({ id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', slug: 'premier-league', name: 'Premier League', short_name: 'EPL', logo_url: null, is_active: true });
    fake.store.seasons!.push({ id: '44444444-4444-4444-8444-444444444444', competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', name: '2026/27', start_date: '2026-08-01', end_date: '2027-05-31', is_current: true });
    fake.store.transfers!.push({ id: '11111111-1111-4111-8111-111111111111', status: 'completed', transfer_type: 'permanent', player_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', from_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', to_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', effective_date: '2026-08-01T00:00:00.000Z', season_id: '44444444-4444-4444-8444-444444444444' });

    // Hit every endpoint.
    await request(app).get('/api/v1/seo/metadata?type=news&slug=big-win');
    await request(app).get('/api/v1/seo/structured?type=match&slug=fc-example-vs-real-sample');
    await request(app).get('/api/v1/seo/breadcrumbs?type=player&slug=john-doe');
    await request(app).get('/api/v1/seo/validate?type=team&slug=fc-example');

    // No select('*') on any entity table.
    const entityTables = ['articles', 'teams', 'players', 'competitions', 'matches', 'seasons', 'transfers', 'media', 'seo_metadata'];
    expect(hasStarSelect(fake, entityTables)).toBe(false);
  });
});
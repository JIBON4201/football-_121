import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { canonicalUrl as legacyCanonicalUrl } from '../src/lib/urls';
import { MemoryCacheStore, setCacheStore } from '../src/lib/cache';
import { absoluteCanonicalUrl, canonicalPath, findDuplicateCanonicals, isValidSlug, parseCanonicalPath } from '../src/seo/canonical';
import { robotsFor } from '../src/seo/metadata';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const authed = { Authorization: 'Bearer valid-token' };
const asRole = (...roles: string[]) => setTestRoles(roles);

function pushArticle(fake: FakeClient, overrides: Record<string, unknown> = {}) {
  const row = {
    id: `seo-${Math.random().toString(36).slice(2, 10)}`,
    slug: 'seo-test-article',
    status: 'published',
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    article_type: 'news',
    title: 'SEO Test Article',
    excerpt: 'SEO excerpt here',
    content: 'Long enough body content for the SEO test article fixture.',
    is_breaking: false,
    is_featured: false,
    ...overrides,
  };
  (fake.store.articles as Array<Record<string, unknown>>).push(row);
  return row;
}

describe('Step 28 — SEO & content discovery', () => {
  let fake: FakeClient;
  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  it('canonical URLs are deterministic, stable and slash-normalized', () => {
    expect(canonicalPath('news', 'big-win')).toBe('/news/big-win');
    expect(canonicalPath('match', 'a-b')).toBe('/matches/a-b');
    expect(absoluteCanonicalUrl('team', 'fc-example')).toBe(`${config.site.baseUrl}/teams/fc-example`);
    expect(absoluteCanonicalUrl('news', 'big-win').endsWith('/')).toBe(false);
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug("'; DROP")).toBe(false);
    expect(parseCanonicalPath('/teams/fc-example')).toMatchObject({ entityType: 'team', slug: 'fc-example' });
    expect(parseCanonicalPath('/news/big-win?x=1')).toMatchObject({ entityType: 'news', slug: 'big-win' });
    expect(parseCanonicalPath('/nope/x')).toBeNull();
  });

  it('canonical resolver matches the search URL scheme for shared types', () => {
    expect(absoluteCanonicalUrl('news', 's')).toBe(`${config.site.baseUrl}${legacyCanonicalUrl('news', 's')}`);
    expect(absoluteCanonicalUrl('match', 's')).toBe(`${config.site.baseUrl}${legacyCanonicalUrl('match', 's')}`);
    expect(absoluteCanonicalUrl('team', 's')).toBe(`${config.site.baseUrl}${legacyCanonicalUrl('team', 's')}`);
    expect(absoluteCanonicalUrl('player', 's')).toBe(`${config.site.baseUrl}${legacyCanonicalUrl('player', 's')}`);
    expect(absoluteCanonicalUrl('competition', 's')).toBe(`${config.site.baseUrl}${legacyCanonicalUrl('competition', 's')}`);
  });

  it('metadata falls back custom → entity → global without fabrication', async () => {
    const base = await request(app).get('/api/v1/seo/metadata?type=news&slug=big-win');
    expect(base.status).toBe(200);
    expect(base.body.data.title).toContain('Big Win');
    expect(base.body.data.canonical).toBe(`${config.site.baseUrl}/news/big-win`);
    expect(base.body.data.robots).toBe('index,follow');

    // Custom SEO overrides.
    (fake.store.seo_metadata as Array<Record<string, unknown>>).push({
      id: 'seo1',
      entity_type: 'article',
      entity_id: 'a1',
      meta_title: 'Custom Title Here',
      meta_description: 'Custom desc',
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
    });
    const custom = await request(app).get('/api/v1/seo/metadata?type=news&slug=big-win');
    expect(custom.body.data.title).toBe('Custom Title Here');

    // Missing content never fabricates: unknown slug is 404, not defaults.
    expect((await request(app).get('/api/v1/seo/metadata?type=news&slug=no-such-slug')).status).toBe(404);
    expect((await request(app).get('/api/v1/seo/metadata?type=news&slug=draft-piece')).status).toBe(404);
  });

  it('robots rules keep non-indexable content out of the index', () => {
    expect(robotsFor('news', { status: 'published', publishedAt: '2026-09-01T10:00:00.000Z' })).toMatchObject({ index: true, follow: true });
    expect(robotsFor('news', { status: 'draft' })).toMatchObject({ index: false, follow: false });
    expect(robotsFor('news', { status: 'review' })).toMatchObject({ index: false, follow: false });
    expect(robotsFor('news', { status: 'scheduled' })).toMatchObject({ index: false, follow: false });
    expect(robotsFor('news', { status: 'archived' })).toMatchObject({ index: false, follow: false });
    expect(robotsFor('match', { status: 'cancelled' })).toMatchObject({ index: false, follow: true });
    expect(robotsFor('search', {})).toMatchObject({ index: false, follow: true });
    expect(robotsFor('admin', {})).toMatchObject({ index: false, follow: false });
    expect(robotsFor('team', { isActive: false })).toMatchObject({ index: false });
    expect(robotsFor('news', { status: 'published', publishedAt: '2999-01-01T00:00:00.000Z' })).toMatchObject({ index: false });
  });

  it('robots.txt allows canonical content and blocks private endpoints', async () => {
    const res = await request(app).get('/api/v1/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).not.toContain('Disallow: /api/v1/admin');
    expect(res.text).toContain('Disallow: /api/v1/me');
    expect(res.text).toContain('Disallow: /api/v1/articles');
    expect(res.text).toContain('Disallow: /api/v1/search');
    // Step 42: the sitemap must be advertised on the public site origin, not
    // as an API path under the site domain (that shape 404s for crawlers).
    expect(res.text).toContain(`Sitemap: ${config.site.baseUrl}/sitemap.xml`);
    expect(res.text).not.toContain('/api/v1/sitemap.xml');
    expect(res.text).not.toContain('/api/v1/news-sitemap.xml');
  });

  it('sitemap index and partitions expose canonical URLs with stable ordering', async () => {
    const index = await request(app).get('/api/v1/sitemap.xml');
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toContain('xml');
    expect(index.text).toContain('<sitemapindex');
    expect(index.text).toContain('articles.xml');
    expect(index.text).toContain('matches.xml');

    const articles = await request(app).get('/api/v1/sitemaps/articles.xml');
    expect(articles.status).toBe(200);
    expect(articles.text).toContain(`${config.site.baseUrl}/news/big-win`);
    expect(articles.text).not.toContain('draft-piece');

    // Deterministic slug ordering.
    const locs = [...articles.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([...locs].sort());

    const teams = await request(app).get('/api/v1/sitemaps/teams.xml');
    expect(teams.text).toContain('/teams/fc-example');
    const matches = await request(app).get('/api/v1/sitemaps/matches.xml');
    expect(matches.text).toContain('fc-example-vs-real-sample');
  });

  it('news sitemap contains only eligible recent news', async () => {
    pushArticle(fake, { slug: 'fresh-news', title: 'Fresh News', published_at: new Date().toISOString() });
    pushArticle(fake, { slug: 'stale-news', title: 'Stale News', published_at: '2020-01-01T00:00:00.000Z' });
    const res = await request(app).get('/api/v1/news-sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('fresh-news');
    expect(res.text).toContain('<news:title>Fresh News</news:title>');
    expect(res.text).not.toContain('stale-news');
    expect(res.text).not.toContain('draft-piece');
    // Seed article from 2026-09-02 is outside the 48h news window.
    expect(res.text).not.toContain('transfer-news');
  });

  it('sitemap escapes special characters', async () => {
    pushArticle(fake, { slug: 'amp-news', title: 'Fish & Chips <b>', published_at: new Date().toISOString() });
    const res = await request(app).get('/api/v1/news-sitemap.xml');
    expect(res.text).toContain('Fish &amp; Chips');
    expect(res.text).not.toContain('Fish & Chips <b>');
  });

  it('JSON-LD uses canonical entities without fabrication', async () => {
    const news = await request(app).get('/api/v1/seo/structured?type=news&slug=big-win');
    expect(news.status).toBe(200);
    const nodes = news.body.data as Array<{ '@type': string }>;
    expect(nodes.some((n) => n['@type'] === 'NewsArticle')).toBe(true);
    expect(nodes.some((n) => n['@type'] === 'BreadcrumbList')).toBe(true);
    const article = nodes.find((n) => n['@type'] === 'NewsArticle') as unknown as Record<string, unknown>;
    expect(article.headline).toBe('Big Win');

    const match = await request(app).get('/api/v1/seo/structured?type=match&slug=fc-example-vs-real-sample');
    const matchNodes = match.body.data as Array<Record<string, unknown>>;
    const event = matchNodes.find((n) => n['@type'] === 'SportsEvent') as unknown as Record<string, unknown>;
    expect(event).toBeDefined();
    expect((event.homeTeam as Record<string, unknown>).name).toBeTruthy();
    expect(event.startDate).toBe('2030-02-01T15:00:00.000Z');

    const team = await request(app).get('/api/v1/seo/structured?type=team&slug=fc-example');
    expect((team.body.data as Array<{ '@type': string }>).some((n) => n['@type'] === 'SportsTeam')).toBe(true);

    // Drafts never produce structured data.
    expect((await request(app).get('/api/v1/seo/structured?type=news&slug=draft-piece')).status).toBe(404);
  });

  it('breadcrumbs use canonical routes', async () => {
    const res = await request(app).get('/api/v1/seo/breadcrumbs?type=match&slug=fc-example-vs-real-sample');
    expect(res.status).toBe(200);
    const crumbs = res.body.data as Array<{ name: string; url: string }>;
    expect(crumbs[0]).toMatchObject({ name: 'Home', url: `${config.site.baseUrl}/` });
    expect(crumbs.some((c) => c.url === `${config.site.baseUrl}/competitions/premier-league`)).toBe(true);
    expect(crumbs[crumbs.length - 1].url).toBe(`${config.site.baseUrl}/matches/fc-example-vs-real-sample`);

    const news = await request(app).get('/api/v1/seo/breadcrumbs?type=news&slug=big-win');
    expect((news.body.data as Array<{ url: string }>).at(-1)?.url).toBe(`${config.site.baseUrl}/news/big-win`);
  });

  it('related content is canonical, deduplicated and self-free', async () => {
    const res = await request(app).get('/api/v1/seo/related?type=news&slug=big-win&limit=5');
    expect(res.status).toBe(200);
    const urls = [
      ...(res.body.data.related as Array<{ url: string }>).map((r) => r.url),
      ...(res.body.data.entities as Array<{ url: string }>).map((r) => r.url),
    ];
    expect(urls).not.toContain(`${config.site.baseUrl}/news/big-win`);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(url.startsWith(config.site.baseUrl)).toBe(true);
  });

  it('slug changes preserve redirects and stay canonical', async () => {
    asRole('author');
    const created = await request(app).post('/api/v1/articles').set(authed).send({
      title: 'Redirect Preservation Title Here',
      content: 'Long enough body for the redirect preservation article case.',
    });
    const id = created.body.data.id as string;
    const oldSlug = created.body.data.slug as string;
    asRole('author');
    await request(app).post(`/api/v1/articles/${id}/submit`).set(authed).send({});
    asRole('editor');
    await request(app).post(`/api/v1/articles/${id}/publish`).set(authed).send({});
    await request(app).patch(`/api/v1/articles/${id}`).set(authed).send({ slug: 'redirect-target-slug' });

    expect(fake.store.redirects.some((r) => r.source_path === `/news/${oldSlug}` && r.destination_path === '/news/redirect-target-slug')).toBe(true);
    const meta = await request(app).get('/api/v1/seo/metadata?type=news&slug=redirect-target-slug');
    expect(meta.body.data.canonical).toBe(`${config.site.baseUrl}/news/redirect-target-slug`);
    const sitemap = await request(app).get('/api/v1/sitemaps/articles.xml');
    expect(sitemap.text).toContain('/news/redirect-target-slug');
    const validation = await request(app).get('/api/v1/seo/validate?type=news&slug=redirect-target-slug');
    expect(validation.body.data.checks.find((c: { name: string }) => c.name === 'no-redirect-loop')).toMatchObject({ ok: true });
  });

  it('publishing invalidates SEO caches', async () => {
    setCacheStore(new MemoryCacheStore());
    asRole('author');
    const created = await request(app).post('/api/v1/articles').set(authed).send({
      title: 'Cache Invalidation Title Here',
      content: 'Long enough body for the cache invalidation article case.',
    });
    const id = created.body.data.id as string;
    const slug = created.body.data.slug as string;
    asRole('author');
    await request(app).post(`/api/v1/articles/${id}/submit`).set(authed).send({});
    asRole('editor');
    await request(app).post(`/api/v1/articles/${id}/publish`).set(authed).send({});
    const first = await request(app).get(`/api/v1/seo/metadata?type=news&slug=${slug}`);
    expect(first.body.data.title).toContain('Cache Invalidation Title Here');
    await request(app).patch(`/api/v1/articles/${id}`).set(authed).send({ title: 'Updated Cache Title Here Now' });
    const second = await request(app).get(`/api/v1/seo/metadata?type=news&slug=${slug}`);
    expect(second.body.data.title).toContain('Updated Cache Title Here Now');
  });

  it('private content is excluded everywhere', async () => {
    for (const slug of ['draft-piece']) {
      expect((await request(app).get(`/api/v1/seo/metadata?type=news&slug=${slug}`)).status).toBe(404);
    }
    for (const part of ['articles', 'news', 'matches', 'teams', 'players', 'competitions']) {
      const res = await request(app).get(`/api/v1/sitemaps/${part}.xml`);
      expect(res.text).not.toContain('draft-piece');
    }
    const search = await request(app).get('/api/v1/search?q=draft&type=news');
    expect((search.body.data?.results ?? search.body.data ?? []) as unknown[]).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ slug: 'draft-piece' })]),
    );
  });

  it('duplicate canonical detection works', () => {
    expect(findDuplicateCanonicals(['https://x/news/a', 'https://x/teams/b'])).toEqual([]);
    expect(findDuplicateCanonicals(['https://x/news/A', 'https://x/news/a'])).toHaveLength(2);
  });

  it('validate endpoint reports full check suite', async () => {
    const res = await request(app).get('/api/v1/seo/validate?type=team&slug=fc-example');
    expect(res.status).toBe(200);
    const names = (res.body.data.checks as Array<{ name: string }>).map((c) => c.name);
    for (const name of ['slug-valid', 'canonical-valid', 'entity-found', 'indexable', 'metadata-title', 'jsonld-valid', 'no-redirect-loop', 'sitemap-eligible', 'no-duplicate-canonical']) {
      expect(names).toContain(name);
    }
    expect(res.body.data.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });
});

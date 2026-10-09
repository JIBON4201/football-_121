/**
 * Sitemap indexing guarantees.
 *
 * Three properties Google actually depends on, each of which failed here at
 * some point:
 *
 *  1. Every URL appears exactly once across the whole sitemap collection. The
 *     `news` and `articles` partitions read the same table, so they used to
 *     both list every recently published article.
 *  2. A sitemap only advertises indexable pages. Deactivated teams and
 *     competitions are served `noindex` by robotsFor() but were still listed.
 *  3. A database outage must not be served as a valid-but-empty sitemap index,
 *     because a crawler reads that as "this site has no URLs".
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { evaluateCanonicalOrigin, isSameOriginHost } from '../src/lib/envRules';
import { MemoryCacheStore, resetCacheStore, setCacheStore } from '../src/lib/cache';
import { sitemapService, urlsetXml } from '../src/services/sitemap.service';
import { app, installTestEnv } from './helpers';
import type { FakeClient, FakeStore } from './fake';

const SITE = config.site.baseUrl;

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

let fake: FakeClient;
let store: FakeStore;

beforeEach(() => {
  ({ fake } = installTestEnv());
  store = fake.store;
  resetCacheStore();
});

function pushArticle(row: Record<string, unknown>): void {
  store.articles.push({ id: `art-${store.articles.length}`, title: 'T', article_type: 'news', ...row } as never);
}

describe('sitemap: news and articles partitions never overlap', () => {
  it('lists a freshly published article only in news, and only it there', async () => {
    pushArticle({ slug: 'fresh-one', status: 'published', published_at: new Date().toISOString() });
    pushArticle({ slug: 'old-one', status: 'published', published_at: '2020-01-01T00:00:00.000Z' });

    const news = await request(app).get('/api/v1/sitemaps/news.xml');
    const articles = await request(app).get('/api/v1/sitemaps/articles.xml');
    expect(news.status).toBe(200);
    expect(articles.status).toBe(200);

    const newsLocs = locs(news.text);
    const articleLocs = locs(articles.text);

    expect(newsLocs).toContain(`${SITE}/news/fresh-one`);
    expect(articleLocs).not.toContain(`${SITE}/news/fresh-one`);
    expect(articleLocs).toContain(`${SITE}/news/old-one`);
    expect(newsLocs).not.toContain(`${SITE}/news/old-one`);
  });

  it('produces zero intersection between news and articles across the whole collection', async () => {
    // Two articles inside the window, three well outside it.
    const now = Date.now();
    for (const [slug, ageHours] of [
      ['inside-a', 1],
      ['inside-b', 47],
      ['outside-a', 49],
      ['outside-b', 500],
      ['outside-c', 5000],
    ] as const) {
      pushArticle({
        slug,
        status: 'published',
        published_at: new Date(now - ageHours * 3600 * 1000).toISOString(),
      });
    }

    const newsLocs = new Set(locs((await request(app).get('/api/v1/sitemaps/news.xml')).text));
    const articleLocs = new Set(locs((await request(app).get('/api/v1/sitemaps/articles.xml')).text));

    expect([...newsLocs].filter((loc) => articleLocs.has(loc))).toEqual([]);
    // No article is dropped on the floor between the two partitions.
    const union = new Set([...newsLocs, ...articleLocs]);
    for (const slug of ['inside-a', 'inside-b', 'outside-a', 'outside-b', 'outside-c']) {
      expect(union.has(`${SITE}/news/${slug}`), `${slug} missing from both partitions`).toBe(true);
    }
  });

  it('counts each article once when sizing the sitemap index', async () => {
    for (const ageHours of [1, 12, 200, 4000]) {
      pushArticle({
        slug: `a-${ageHours}`,
        status: 'published',
        published_at: new Date(Date.now() - ageHours * 3600 * 1000).toISOString(),
      });
    }
    const index = await request(app).get('/api/v1/sitemap.xml');
    expect(index.status).toBe(200);
    expect(index.text).toContain('/sitemaps/news.xml');
    expect(index.text).toContain('/sitemaps/articles.xml');
    // The counts drive how many child files exist; both partitions stay present.
    const newsLocs = locs((await request(app).get('/api/v1/sitemaps/news.xml')).text);
    expect(newsLocs).toHaveLength(2);
  });
});

describe('sitemap: noindex pages are never advertised', () => {
  it('omits deactivated teams and competitions', async () => {
    store.teams.push({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbf',
      slug: 'defunct-club',
      name: 'Defunct Club',
      is_active: false,
    } as never);
    store.competitions.push({
      id: 'ffffffff-ffff-4fff-8fff-fffffffffffe',
      slug: 'dead-league',
      name: 'Dead League',
      is_active: false,
    } as never);

    const teams = await request(app).get('/api/v1/sitemaps/teams.xml');
    expect(teams.status).toBe(200);
    expect(teams.text).toContain('/teams/fc-example');
    expect(teams.text).not.toContain('defunct-club');

    const competitions = await request(app).get('/api/v1/sitemaps/competitions.xml');
    expect(competitions.status).toBe(200);
    expect(competitions.text).toContain('/competitions/premier-league');
    expect(competitions.text).not.toContain('dead-league');
  });

  it('stays consistent with robotsFor() for a deactivated entity', async () => {
    const { robotsFor } = await import('../src/seo/metadata');
    store.teams.push({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbf',
      slug: 'defunct-club',
      name: 'Defunct Club',
      is_active: false,
    } as never);

    const robots = robotsFor('team', { slug: 'defunct-club', isActive: false });
    expect(robots.index).toBe(false);

    const teams = await request(app).get('/api/v1/sitemaps/teams.xml');
    // Served noindex => must not be advertised as indexable.
    expect(teams.text).not.toContain('defunct-club');
  });

  it('keeps excluding drafts, unpublished and inactive taxonomy as before', async () => {
    const articles = await request(app).get('/api/v1/sitemaps/articles.xml');
    expect(articles.text).not.toContain('draft-piece');

    const categories = await request(app).get('/api/v1/sitemaps/categories.xml');
    expect(categories.text).toContain('pl-news');
    expect(categories.text).not.toContain('old-news');

    const transfers = await request(app).get('/api/v1/sitemaps/transfers.xml');
    expect(transfers.text).toContain('11111111-1111-4111-8111-111111111111');
    expect(transfers.text).not.toContain('33333333-3333-4333-8333-333333333333');
  });
});

describe('sitemap: database failure is reported, not disguised as emptiness', () => {
  it('returns 5xx for the index instead of a valid index of empty partitions', async () => {
    fake.failTables.add('articles');
    resetCacheStore();

    const res = await request(app).get('/api/v1/sitemap.xml');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.text).not.toContain('<sitemapindex');
  });

  it('returns 5xx for a partition instead of an empty urlset', async () => {
    fake.failTables.add('teams');
    resetCacheStore();

    const res = await request(app).get('/api/v1/sitemaps/teams.xml');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.text).not.toContain('<urlset');
  });

  it('never leaks database internals in the failure body', async () => {
    fake.failTables.add('articles');
    resetCacheStore();

    const res = await request(app).get('/api/v1/sitemap.xml');
    const body = JSON.stringify(res.body ?? {});
    for (const needle of ['supabase', 'postgrest', 'SUPABASE_SERVICE', 'select', 'from(']) {
      expect(body.toLowerCase()).not.toContain(needle.toLowerCase());
    }
  });
});

describe('sitemap: URL uniqueness and lastmod behaviour', () => {
  it('lists each URL at most once inside a partition', async () => {
    for (const ageHours of [200, 400, 800]) {
      pushArticle({
        slug: `dup-${ageHours}`,
        status: 'published',
        published_at: new Date(Date.now() - ageHours * 3600 * 1000).toISOString(),
      });
    }
    const articles = await request(app).get('/api/v1/sitemaps/articles.xml');
    const seen = locs(articles.text);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('emits lastmod only when a real timestamp exists', async () => {
    store.articles.push({
      id: 'art-stamped',
      slug: 'stamped-piece',
      status: 'published',
      title: 'Stamped',
      article_type: 'news',
      published_at: '2020-05-01T00:00:00.000Z',
      updated_at: '2020-06-02T03:04:05.000Z',
    } as never);

    const articles = await request(app).get('/api/v1/sitemaps/articles.xml');
    expect(articles.text).toContain('<lastmod>2020-06-02T03:04:05.000Z</lastmod>');

    // An unparseable updated_at must not become a fabricated value; it falls
    // back to the real publication timestamp rather than inventing one.
    store.articles.push({
      id: 'art-fallback',
      slug: 'fallback-piece',
      status: 'published',
      title: 'Fallback',
      article_type: 'news',
      published_at: '2019-01-01T00:00:00.000Z',
      updated_at: 'not-a-date',
    } as never);
    resetCacheStore();

    const refreshed = await request(app).get('/api/v1/sitemaps/articles.xml');
    const block = refreshed.text.split(/<url>/).find((chunk) => chunk.includes('fallback-piece')) ?? '';
    expect(block).toContain('<lastmod>2019-01-01T00:00:00.000Z</lastmod>');
    expect(block).not.toContain('not-a-date');
  });

  it('omits the lastmod element entirely when no timestamp is trustworthy', () => {
    const withLastmod = urlsetXml([{ loc: `${SITE}/news/a`, lastmod: '2020-01-01T00:00:00.000Z' }]);
    expect(withLastmod).toContain('<lastmod>2020-01-01T00:00:00.000Z</lastmod>');

    for (const entry of [{ loc: `${SITE}/news/b` }, { loc: `${SITE}/news/c`, lastmod: null }]) {
      expect(urlsetXml([entry])).not.toContain('<lastmod>');
    }
  });

  it('never places a bare homepage canonical on a detail page', async () => {
    const articles = await request(app).get('/api/v1/sitemaps/articles.xml');
    const detailLocs = locs(articles.text).filter((loc) => loc.includes('/news/'));
    expect(detailLocs.length).toBeGreaterThan(0);
    expect(detailLocs.every((loc) => loc !== `${SITE}/`)).toBe(true);
  });
});

describe('sitemap: new content becomes eligible automatically', () => {
  // installTestEnv() leaves the default NoopCacheStore in place, which would
  // make every read hit the database and prove nothing about invalidation.
  // Swap in the real store so caching and its invalidation are both exercised.
  beforeEach(() => {
    setCacheStore(new MemoryCacheStore());
  });

  it('picks up an article published after the first request, once the cache is invalidated', async () => {
    const before = await request(app).get('/api/v1/sitemaps/news.xml');
    expect(before.status).toBe(200);
    expect(before.text).not.toContain('brand-new-story');

    pushArticle({
      slug: 'brand-new-story',
      status: 'published',
      title: 'Brand New Story',
      published_at: new Date().toISOString(),
    });
    // Stale cache is the pre-invalidation read.
    const cached = await request(app).get('/api/v1/sitemaps/news.xml');
    expect(cached.text).not.toContain('brand-new-story');

    // The publishing workflow invalidates the sitemap namespace.
    await sitemapService.invalidateSitemapCaches();

    const after = await request(app).get('/api/v1/sitemaps/news.xml');
    expect(after.text).toContain('brand-new-story');
  });

  it('drops an unpublished article on the next read after invalidation', async () => {
    pushArticle({
      slug: 'about-to-be-draft',
      status: 'published',
      title: 'About To Be Draft',
      published_at: '2020-03-03T00:00:00.000Z',
    });
    await sitemapService.invalidateSitemapCaches();
    expect((await request(app).get('/api/v1/sitemaps/articles.xml')).text).toContain('about-to-be-draft');

    const row = store.articles.find((a) => a.slug === 'about-to-be-draft');
    if (row) row.status = 'draft';
    await sitemapService.invalidateSitemapCaches();

    expect((await request(app).get('/api/v1/sitemaps/articles.xml')).text).not.toContain('about-to-be-draft');
  });
});

describe('sitemap: partitioning at the configured limit', () => {
  it('splits a partition into multiple files once the per-file limit is exceeded', async () => {
    const original = config.seo.sitemapMaxUrls;
    config.seo.sitemapMaxUrls = 2;
    try {
      for (const slug of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
        store.teams.push({
          id: `team-${slug}`,
          slug,
          name: `Team ${slug}`,
          is_active: true,
        } as never);
      }
      resetCacheStore();

      const index = await request(app).get('/api/v1/sitemap.xml');
      expect(index.status).toBe(200);
      // 2 seeded + 6 pushed = 8 teams at 2 per file => 4 child files.
      expect(index.text).toContain('/sitemaps/teams.xml');
      expect(index.text).toContain('/sitemaps/teams.xml?page=2');
      expect(index.text).toContain('/sitemaps/teams.xml?page=4');
      expect(index.text).not.toContain('/sitemaps/teams.xml?page=5');

      const page1 = await request(app).get('/api/v1/sitemaps/teams.xml');
      const page4 = await request(app).get('/api/v1/sitemaps/teams.xml?page=4');
      expect(locs(page1.text)).toHaveLength(2);
      expect(locs(page4.text).length).toBeGreaterThan(0);

      // Pages must not repeat URLs.
      const p1 = new Set(locs(page1.text));
      const p4 = new Set(locs(page4.text));
      expect([...p4].filter((loc) => p1.has(loc))).toEqual([]);
    } finally {
      config.seo.sitemapMaxUrls = original;
      resetCacheStore();
    }
  });

  it('clamps the per-file limit to Google\'s 50,000 ceiling', async () => {
    const original = config.seo.sitemapMaxUrls;
    try {
      config.seo.sitemapMaxUrls = 10_000_000;
      const { sitemapService } = await import('../src/services/sitemap.service');
      expect(sitemapService.maxPerSitemap()).toBe(50000);

      config.seo.sitemapMaxUrls = 0;
      expect(sitemapService.maxPerSitemap()).toBe(1);
    } finally {
      config.seo.sitemapMaxUrls = original;
    }
  });
});

describe('canonical origin must be the production domain', () => {
  it('flags an origin pinned to a different host than the production domain', () => {
    const violations = evaluateCanonicalOrigin({
      VERCEL_PROJECT_PRODUCTION_URL: 'omincalc.xyz',
      SITE_BASE_URL: 'https://football-121.vercel.app',
      NEXT_PUBLIC_SITE_URL: 'https://football-121.vercel.app',
    });
    expect(violations.map((v) => v.variable).sort()).toEqual(['NEXT_PUBLIC_SITE_URL', 'SITE_BASE_URL']);
    for (const violation of violations) {
      expect(violation.rule).toBe('canonical-origin');
      // The message must name the variable, never echo a credential-bearing value.
      expect(violation.message).not.toMatch(/https?:\/\//);
    }
  });

  it('passes when the configured origin matches the production domain', () => {
    expect(
      evaluateCanonicalOrigin({
        VERCEL_PROJECT_PRODUCTION_URL: 'omincalc.xyz',
        SITE_BASE_URL: 'https://omincalc.xyz',
        NEXT_PUBLIC_SITE_URL: 'https://omincalc.xyz',
      }),
    ).toEqual([]);
  });

  it('stays silent when the platform does not report a production host', () => {
    expect(
      evaluateCanonicalOrigin({
        SITE_BASE_URL: 'https://football-121.vercel.app',
        NEXT_PUBLIC_SITE_URL: 'https://football-121.vercel.app',
      }),
    ).toEqual([]);
  });

  it('compares hosts, ignoring scheme, port and trailing slash', () => {
    expect(isSameOriginHost('https://omincalc.xyz', 'omincalc.xyz')).toBe(true);
    expect(isSameOriginHost('https://omincalc.xyz/', 'https://omincalc.xyz')).toBe(true);
    expect(isSameOriginHost('https://OMINcalc.xyz', 'omincalc.xyz')).toBe(true);
    expect(isSameOriginHost('https://omincalc.xyz', 'football-121.vercel.app')).toBe(false);
  });
});
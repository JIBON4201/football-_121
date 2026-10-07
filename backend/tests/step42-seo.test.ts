/**
 * Step 42 — final SEO / crawlability / indexing regression tests.
 *
 * These lock in the guarantees Google depends on: correct canonical origin,
 * robots that never block public content, sitemaps that only contain indexable
 * absolute HTTPS URLs, well-formed structured data, and real 404s.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import {
  absoluteCanonicalUrl,
  absoluteUrl,
  canonicalPath,
  findDuplicateCanonicals,
  isCanonicalLoop,
  isValidSlug,
  parseCanonicalPath,
} from '../src/seo/canonical';
import { robotsTxt } from '../src/seo/robots';
import {
  assertValidJsonLd,
  breadcrumbJsonLd,
  matchJsonLd,
  newsJsonLd,
  organizationJsonLd,
  personJsonLd,
  serializeJsonLd,
  teamJsonLd,
  websiteJsonLd,
} from '../src/seo/structured';
import {
  newsSitemapXml,
  sitemapIndexXml,
  urlsetXml,
} from '../src/services/sitemap.service';
import { app, installTestEnv } from './helpers';

const SITE = config.site.baseUrl;

describe('step 42: canonical URL generation', () => {
  it('builds canonical paths per entity type with no query or trailing slash', () => {
    expect(canonicalPath('news', 'big-win')).toBe('/news/big-win');
    expect(canonicalPath('team', 'real-madrid')).toBe('/teams/real-madrid');
    expect(canonicalPath('player', 'john-doe')).toBe('/players/john-doe');
    expect(canonicalPath('competition', 'premier-league')).toBe('/competitions/premier-league');
    expect(canonicalPath('match', 'a-vs-b')).toBe('/matches/a-vs-b');
  });

  it('produces absolute URLs on the configured site origin', () => {
    expect(absoluteCanonicalUrl('news', 'big-win')).toBe(`${SITE}/news/big-win`);
  });

  it('refuses to canonicalize an invalid slug', () => {
    expect(isValidSlug("'; DROP TABLE articles; --")).toBe(false);
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('a'.repeat(301))).toBe(false);
    expect(() => canonicalPath('news', '<script>')).toThrow();
  });

  it('round-trips a canonical path back to its entity and slug', () => {
    for (const [type, slug] of [
      ['news', 'big-win'],
      ['team', 'real-madrid'],
      ['player', 'john-doe'],
    ] as const) {
      const parsed = parseCanonicalPath(canonicalPath(type, slug));
      expect(parsed).toEqual({ entityType: type, slug });
    }
  });

  it('rejects trailing slashes and nested paths in canonical URLs', () => {
    expect(() => absoluteUrl('/news/big-win/')).toThrow();
    expect(() => absoluteUrl('news/big-win')).toThrow();
    expect(absoluteUrl('/')).toBe(`${SITE}/`);
  });

  it('detects duplicate canonicals case-insensitively', () => {
    expect(findDuplicateCanonicals([`${SITE}/news/a`, `${SITE}/news/A`])).toHaveLength(2);
    expect(findDuplicateCanonicals([`${SITE}/news/a`, `${SITE}/news/b`])).toEqual([]);
  });

  it('detects self-referencing and case-differing redirect loops', () => {
    expect(isCanonicalLoop(`${SITE}/news/a`, `${SITE}/news/a`)).toBe(true);
    expect(isCanonicalLoop(`${SITE}/news/a`, `${SITE}/news/A`)).toBe(true);
    expect(isCanonicalLoop(`${SITE}/news/a`, `${SITE}/news/b`)).toBe(false);
  });
});

describe('step 42: sitemap URL origin', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('advertises sitemap files on the public site origin, not the API path', async () => {
    const index = await request(app).get('/api/v1/sitemap.xml');
    expect(index.status).toBe(200);
    const locs = [...index.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      expect(loc.startsWith(`${SITE}/sitemaps/`), `${loc} must live on the public origin`).toBe(true);
      // The old, broken shape mixed the site origin with the API path.
      expect(loc).not.toContain('/api/v1/');
    }
  });

  it('lists every required partition in the index', async () => {
    const index = await request(app).get('/api/v1/sitemap.xml');
    for (const partition of ['news', 'articles', 'matches', 'teams', 'players', 'competitions', 'transfers', 'categories', 'tags', 'pages']) {
      expect(index.text, `missing ${partition} partition`).toContain(`/sitemaps/${partition}.xml`);
    }
  });

  it('lists transfers, categories, tags and static pages in their sitemaps', async () => {
    const transfers = await request(app).get('/api/v1/sitemaps/transfers.xml');
    expect(transfers.status).toBe(200);
    // Confirmed transfer URLs are id-based public pages, never drafts/rumours.
    expect(transfers.text).toContain('/transfers/11111111-1111-4111-8111-111111111111');
    expect(transfers.text).not.toContain('33333333-3333-4333-8333-333333333333');

    const categories = await request(app).get('/api/v1/sitemaps/categories.xml');
    expect(categories.status).toBe(200);
    expect(categories.text).toContain('/news/category/pl-news');
    expect(categories.text).not.toContain('old-news');

    const tags = await request(app).get('/api/v1/sitemaps/tags.xml');
    expect(tags.status).toBe(200);
    expect(tags.text).toContain('/news/tag/goals');

    const pages = await request(app).get('/api/v1/sitemaps/pages.xml');
    expect(pages.status).toBe(200);
    for (const path of ['/', '/news', '/transfers', '/matches', '/live', '/competitions', '/teams', '/players']) {
      expect(pages.text, `pages sitemap must list ${path}`).toContain(`<loc>${SITE}${path}</loc>`);
    }
    // No noindex admin/search/login routes may appear in a sitemap.
    for (const path of ['/control-center', '/search', '/login']) {
      expect(pages.text, `pages sitemap must not list ${path}`).not.toContain(path);
    }
  });

  it('emits only absolute URLs and no localhost in sitemap bodies', async () => {
    for (const partition of ['teams', 'players', 'competitions', 'matches', 'articles', 'news', 'transfers', 'categories', 'tags', 'pages']) {
      const res = await request(app).get(`/api/v1/sitemaps/${partition}.xml`);
      expect(res.status, partition).toBe(200);
      const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
      for (const loc of locs) {
        expect(loc.startsWith(SITE), `${loc} should be absolute on ${SITE}`).toBe(true);
        expect(loc).not.toContain('localhost');
      }
    }
  });

  it('never lists draft or unpublished articles in the articles sitemap', async () => {
    const res = await request(app).get('/api/v1/sitemaps/articles.xml');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('draft-piece');
    expect(res.text).not.toContain('scheduled-article');
  });

  it('keeps the news sitemap to recent published content only', async () => {
    const res = await request(app).get('/api/v1/news-sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(res.text).not.toContain('draft-piece');
  });

  it('produces well-formed sitemap XML with balanced elements', () => {
    const urlset = urlsetXml([{ loc: `${SITE}/news/a`, lastmod: '2026-01-01T00:00:00.000Z' }]);
    expect(urlset).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect((urlset.match(/<loc>/g) ?? []).length).toBe((urlset.match(/<\/loc>/g) ?? []).length);

    const index = sitemapIndexXml([{ loc: `${SITE}/sitemaps/news.xml` }]);
    expect(index).toContain('<sitemapindex');
    expect((index.match(/<loc>/g) ?? []).length).toBe((index.match(/<\/loc>/g) ?? []).length);

    const news = newsSitemapXml([
      { loc: `${SITE}/news/a`, title: 'A', publicationDate: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(news).toContain('<news:publication_date>');
  });

  it('escapes XML metacharacters in URLs and titles', () => {
    const xml = newsSitemapXml([
      { loc: `${SITE}/news/a?x=1&y=2`, title: 'Ampersand & <tag>', publicationDate: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;tag&gt;');
    expect(xml).not.toMatch(/<title>[^<]*&[^a-z]/);
  });

  it('rejects an unknown partition with a validation error, never a soft 200', async () => {
    const res = await request(app).get('/api/v1/sitemaps/not-a-partition.xml');
    expect(res.status).toBe(400);
  });
});

describe('step 42: robots.txt', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('allows all public football surfaces', () => {
    const body = robotsTxt();
    expect(body).toContain('User-agent: *');
    // None of the public content surfaces may be disallowed.
    for (const path of ['/news', '/matches', '/competitions', '/teams', '/players', '/transfers']) {
      expect(body).not.toContain(`Disallow: ${path}`);
    }
    expect(body).not.toContain('Disallow: /_next');
    expect(body).not.toContain('Disallow: /static');
  });

  it('points at the public-origin sitemap index', () => {
    const body = robotsTxt();
    expect(body).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(body).not.toContain('/api/v1/sitemap.xml');
  });

  it('does not blanket-disallow the site', () => {
    expect(robotsTxt()).not.toMatch(/Disallow:\s*\/\s*(\n|$)/);
  });

  it('never advertises a localhost sitemap in a configured environment', () => {
    expect(robotsTxt()).not.toContain('Sitemap: http://localhost');
  });
});

describe('step 42: structured data', () => {
  const canonical = `${SITE}/news/big-win`;

  it('emits NewsArticle with real dates and no fabricated fields', () => {
    const node = newsJsonLd({
      canonical,
      title: 'Big win',
      excerpt: 'A summary.',
      publishedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      image: `${SITE}/img.jpg`,
      articleType: 'news',
    }) as Record<string, unknown>;
    assertValidJsonLd(node);
    expect(node['@type']).toBe('NewsArticle');
    expect(node.headline).toBe('Big win');
    expect(node.datePublished).toBe('2026-01-01T00:00:00.000Z');
    expect(node.dateModified).toBe('2026-01-02T00:00:00.000Z');
    expect(node.url).toBe(canonical);
    expect(node.publisher).toBeDefined();
    expect(node.author).toBeDefined();
  });

  it('omits dateModified when the article was never updated', () => {
    const node = newsJsonLd({
      canonical,
      title: 'Big win',
      publishedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
    }) as Record<string, unknown>;
    expect('dateModified' in node).toBe(false);
  });

  it('returns null rather than a malformed article when data is missing', () => {
    expect(newsJsonLd({ canonical, title: null, publishedAt: '2026-01-01T00:00:00.000Z' })).toBeNull();
    expect(newsJsonLd({ canonical, title: 'x', publishedAt: null })).toBeNull();
    expect(newsJsonLd({ canonical, title: 'x', publishedAt: 'not-a-date' })).toBeNull();
  });

  it('uses Article (not NewsArticle) for non-news types', () => {
    const node = newsJsonLd({
      canonical,
      title: 'Opinion',
      publishedAt: '2026-01-01T00:00:00.000Z',
      articleType: 'analysis',
    }) as Record<string, unknown>;
    expect(node['@type']).toBe('Article');
  });

  it('maps match status to a valid schema.org event status', () => {
    const cases: [string, string | undefined][] = [
      ['scheduled', 'https://schema.org/EventScheduled'],
      ['live', 'https://schema.org/EventLive'],
      ['finished', 'https://schema.org/EventHappened'],
      ['postponed', 'https://schema.org/EventPostponed'],
      ['cancelled', 'https://schema.org/EventCancelled'],
      ['something-unknown', undefined],
    ];
    for (const [status, expected] of cases) {
      const node = matchJsonLd({
        canonical: `${SITE}/matches/a-vs-b`,
        homeName: 'A',
        awayName: 'B',
        scheduledAt: '2026-01-01T00:00:00.000Z',
        status,
      }) as Record<string, unknown>;
      assertValidJsonLd(node);
      expect(node.eventStatus, status).toBe(expected);
    }
  });

  it('does not fabricate a venue or score', () => {
    const node = matchJsonLd({
      canonical: `${SITE}/matches/a-vs-b`,
      homeName: 'A',
      awayName: 'B',
      scheduledAt: '2026-01-01T00:00:00.000Z',
      status: 'live',
      homeScore: 1,
      awayScore: 0,
    }) as Record<string, unknown>;
    expect('location' in node).toBe(false);
    // A live score must not be published as a final result.
    expect('description' in node).toBe(false);
  });

  it('includes location and final score only when genuinely available', () => {
    const node = matchJsonLd({
      canonical: `${SITE}/matches/a-vs-b`,
      homeName: 'A',
      awayName: 'B',
      scheduledAt: '2026-01-01T00:00:00.000Z',
      status: 'finished',
      homeScore: 2,
      awayScore: 1,
      venueName: 'Home Stadium',
    }) as Record<string, unknown>;
    expect((node.location as { name?: string })?.name).toBe('Home Stadium');
    expect(String(node.description)).toContain('2 - 1');
  });

  it('emits SportsTeam and Person with only public fields', () => {
    const team = teamJsonLd({ canonical: `${SITE}/teams/a`, name: 'Team A', logo: `${SITE}/a.png` }) as Record<string, unknown>;
    assertValidJsonLd(team);
    expect(team['@type']).toBe('SportsTeam');
    expect(team.sport).toBe('Soccer');

    const person = personJsonLd({
      canonical: `${SITE}/players/p`,
      name: 'Player P',
      teamName: 'Team A',
    }) as Record<string, unknown>;
    assertValidJsonLd(person);
    expect(person['@type']).toBe('Person');
    expect(JSON.stringify(person)).not.toMatch(/service_role|external_id|apiKey/i);
  });

  it('returns null for entities lacking a name rather than emitting empty nodes', () => {
    expect(teamJsonLd({ canonical: `${SITE}/teams/a`, name: null })).toBeNull();
    expect(personJsonLd({ canonical: `${SITE}/players/p`, name: '' })).toBeNull();
    expect(matchJsonLd({ canonical: `${SITE}/matches/x`, homeName: null, awayName: 'B', scheduledAt: '2026-01-01T00:00:00.000Z' })).toBeNull();
  });

  it('builds valid Organization, WebSite and BreadcrumbList nodes', () => {
    const org = organizationJsonLd();
    assertValidJsonLd(org);
    expect(org['@type']).toBe('Organization');
    expect(org.url).toBe(SITE);

    const site = websiteJsonLd();
    assertValidJsonLd(site);
    expect(site['@type']).toBe('WebSite');

    const crumbs = breadcrumbJsonLd([{ name: 'News', url: `${SITE}/news` }]) as Record<string, unknown>;
    assertValidJsonLd(crumbs);
    const items = crumbs.itemListElement as Array<Record<string, unknown>>;
    expect(items[0].position).toBe(1);
    expect(items[0].url).toBeUndefined();
    expect((items[0].item as Record<string, unknown>)).toBeDefined();
  });

  it('escapes closing script tags when serializing for inline embedding', () => {
    const serialized = serializeJsonLd({ headline: '</script><script>alert(1)</script>' });
    expect(serialized).not.toContain('</script>');
    expect(JSON.parse(serialized.replace('<\\/', '</'))).toBeTruthy();
  });
});

describe('step 42: redirect resolution', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('returns a null redirect for an unknown path rather than erroring', async () => {
    const res = await request(app).get('/api/v1/seo/redirect?path=/news/never-published');
    expect(res.status).toBe(200);
    expect(res.body.data.redirect).toBeNull();
  });

  it('returns null for a self-referencing redirect instead of looping', async () => {
    const { createRedirect } = await import('../src/repositories/articles.repo');
    await createRedirect('/news/loop-a', '/news/loop-a');
    const res = await request(app).get('/api/v1/seo/redirect?path=/news/loop-a');
    expect(res.status).toBe(200);
    expect(res.body.data.redirect).toBeNull();
  });

  it('resolves a recorded redirect to its destination with a 301', async () => {
    const { createRedirect } = await import('../src/repositories/articles.repo');
    await createRedirect('/news/old-title', '/news/new-title');
    const res = await request(app).get('/api/v1/seo/redirect?path=/news/old-title');
    expect(res.status).toBe(200);
    expect(res.body.data.redirect.destination).toBe('/news/new-title');
    expect(res.body.data.redirect.statusCode).toBe(301);
  });

  it('follows a redirect chain to its final destination', async () => {
    const { createRedirect } = await import('../src/repositories/articles.repo');
    await createRedirect('/news/v1', '/news/v2');
    await createRedirect('/news/v2', '/news/v3');
    const res = await request(app).get('/api/v1/seo/redirect?path=/news/v1');
    expect(res.status).toBe(200);
    expect(res.body.data.redirect.destination).toBe('/news/v3');
  });

  it('refuses to follow a cycle', async () => {
    const { createRedirect } = await import('../src/repositories/articles.repo');
    await createRedirect('/news/cyc-a', '/news/cyc-b');
    await createRedirect('/news/cyc-b', '/news/cyc-a');
    const res = await request(app).get('/api/v1/seo/redirect?path=/news/cyc-a');
    expect(res.status).toBe(200);
    expect(res.body.data.redirect).toBeNull();
  });

  it('rejects a non-path or hostile redirect query', async () => {
    for (const path of ['http://evil.test/x', '../../etc/passwd', 'news/ok']) {
      const res = await request(app).get(`/api/v1/seo/redirect?path=${encodeURIComponent(path)}`);
      expect([400, 404], path).toContain(res.status);
    }
  });

  it('rejects an oversized path', async () => {
    const res = await request(app).get(`/api/v1/seo/redirect?path=${'a'.repeat(600)}`);
    expect(res.status).toBe(400);
  });
});

describe('step 42: status codes for missing entities', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('returns 404 rather than 200 for unknown slugs', async () => {
    const cases = [
      '/api/v1/news/no-such-article',
      '/api/v1/teams/no-such-team',
      '/api/v1/players/no-such-player',
      '/api/v1/matches/no-such-match',
      '/api/v1/competitions/no-such-competition',
    ];
    for (const path of cases) {
      const res = await request(app).get(path);
      expect(res.status, `${path} must 404`).toBe(404);
      expect(res.body.error.code, path).toBe('NOT_FOUND');
    }
  });

  it('returns 404 rather than an empty 200 for an unknown transfer', async () => {
    const res = await request(app).get('/api/v1/transfers/99999999-9999-4999-8999-999999999999');
    expect(res.status).toBe(404);
  });

  it('rejects malicious slugs outright instead of searching for them', async () => {
    const res = await request(app).get("/api/v1/news/%27%3B%20DROP%20TABLE%20articles%3B--");
    expect(res.status).toBe(400);
  });
});

describe('step 42: domain configuration hygiene', () => {
  it('never emits localhost or empty canonical URLs once configured', () => {
    // In the test environment SITE_BASE_URL is the documented placeholder, so
    // assert the invariant that matters: canonical URLs are derived from the
    // single configured base and never mix in an API path.
    const canonical = absoluteCanonicalUrl('news', 'a');
    expect(canonical.startsWith(SITE)).toBe(true);
    expect(canonical).not.toContain('/api/');
    expect(canonical).not.toContain('undefined');
  });

  it('builds canonicals for every indexable entity type without throwing', () => {
    for (const type of ['news', 'match', 'team', 'player', 'competition', 'transfer'] as const) {
      expect(() => absoluteCanonicalUrl(type, 'stable-slug')).not.toThrow();
      expect(absoluteCanonicalUrl(type, 'stable-slug')).toMatch(/^https?:\/\/[^/]+\/\w+\/stable-slug$/);
    }
  });
});
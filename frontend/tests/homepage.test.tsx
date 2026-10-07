import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteConfig } from '@/config/site';
import { metadata as homeMetadata } from '@/app/(site)/page';
import { HeroView } from '@/components/home/HeroSection';
import { LiveMatchesView, UpcomingMatchesView } from '@/components/home/MatchSections';
import { BreakingNewsView, LatestNewsView, TransferNewsView } from '@/components/home/ArticleSections';
import { PopularPlayersView, PopularTeamsView } from '@/components/home/PopularSections';
import { SectionShell } from '@/components/home/SectionShell';
import { trackAttributes, trackEvent } from '@/lib/analytics';
import {
  attachMatchDetails,
  HOMEPAGE_LIMITS,
  HOMEPAGE_REVALIDATE,
  loadHomepage,
  loadUpcomingMatches,
  MAX_MATCH_DETAILS_FANOUT,
  selectHeroArticle,
  withoutId,
  type EnrichedMatch,
} from '@/lib/homepage';
import type { Article, Match, Player, Team } from '@/types/api';

const team = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'FC Example',
  short_name: 'FCE',
  slug: 'fc-example',
  logo_url: 'https://cdn.test/fce.png',
  ...overrides,
});

const match = (overrides: Partial<Match> = {}): Match => ({
  id: 'match-1',
  slug: 'fc-example-vs-real-sample',
  status: 'scheduled',
  scheduled_at: '2030-02-01T15:00:00.000Z',
  home_score: null,
  away_score: null,
  home_team_id: 'team-1',
  away_team_id: 'team-2',
  competition_id: 'comp-1',
  ...overrides,
});

const article = (overrides: Partial<Article> = {}): Article => ({
  id: 'article-1',
  title: 'Big Win',
  slug: 'big-win',
  excerpt: 'A great match under the lights.',
  article_type: 'news',
  published_at: '2026-09-01T10:00:00.000Z',
  is_featured: false,
  is_breaking: false,
  view_count: 10,
  ...overrides,
});

const enriched = (overrides: Partial<EnrichedMatch> = {}): EnrichedMatch => ({
  match: match(),
  homeTeam: team(),
  awayTeam: team({ id: 'team-2', name: 'Real Sample', short_name: 'RSM', slug: 'real-sample', logo_url: 'https://cdn.test/rsm.png' }),
  competition: { id: 'comp-1', name: 'Premier League', short_name: 'EPL', slug: 'premier-league', logo_url: null },
  venueName: 'Arena',
  ...overrides,
});

function mockApi(respond: (pathname: string) => { status: number; body: unknown } | null, seen?: Array<{ url: string; init?: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      seen?.push({ url, init });
      const pathname = new URL(url).pathname.replace(/^\/api\/v1/, '') || '/';
      const hit = respond(pathname);
      if (!hit) {
        return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND', message: 'No fixture' } }) };
      }
      return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, json: async () => hit.body };
    }) as unknown as typeof fetch,
  );
}

const listBody = (rows: unknown[]) => ({ data: rows, requestId: 'test' });

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { window?: unknown }).window;
});

describe('homepage data layer', () => {
  it('selects breaking hero first, then latest, then nothing', () => {
    const breaking = article({ id: 'b1', is_breaking: true });
    const latest = article({ id: 'l1' });
    expect(selectHeroArticle([breaking], [latest])?.id).toBe('b1');
    expect(selectHeroArticle([], [latest])?.id).toBe('l1');
    expect(selectHeroArticle([], [])).toBeNull();
  });

  it('drops the hero from its list without touching others', () => {
    const items = [article({ id: 'a1' }), article({ id: 'a2' })];
    expect(withoutId(items, 'a1').map((item) => item.id)).toEqual(['a2']);
    expect(withoutId(items, undefined)).toHaveLength(2);
  });

  it('keeps only matches with both teams resolved', () => {
    const matches = [match({ slug: 'm1' }), match({ slug: 'm2' })];
    const bySlug = new Map([
      ['m1', { homeTeam: team(), awayTeam: team({ id: 't2', name: 'B', slug: 'b' }), competition: null, venue: { name: 'Arena' } }],
      ['m2', { homeTeam: team(), awayTeam: null, competition: null, venue: null }],
    ]);
    const result = attachMatchDetails(matches, bySlug);
    expect(result).toHaveLength(1);
    expect(result[0].venueName).toBe('Arena');
    expect(attachMatchDetails(matches, new Map())).toHaveLength(0);
  });

  it('fetches sections in parallel with per-section freshness tiers', async () => {
    const seen: Array<{ url: string; init?: unknown }> = [];
    mockApi((pathname) => {
      if (pathname === '/matches/live') return { status: 200, body: listBody([]) };
      if (pathname === '/matches/upcoming') return { status: 200, body: listBody([match()]) };
      if (pathname === '/news/breaking') return { status: 200, body: listBody([]) };
      if (pathname === '/news/latest') return { status: 200, body: listBody([article()]) };
      if (pathname === '/news') return { status: 200, body: listBody([]) };
      if (pathname === '/competitions') return { status: 200, body: listBody([]) };
      if (pathname === '/teams') return { status: 200, body: listBody([]) };
      if (pathname === '/players') return { status: 200, body: listBody([]) };
      if (pathname.endsWith('/details')) {
        return {
          status: 200,
          body: { data: { homeTeam: team(), awayTeam: team({ id: 't2', name: 'B', slug: 'b' }), competition: null, venue: null }, requestId: 't' },
        };
      }
      return null;
    }, seen);
    const data = await loadHomepage();
    const paths = seen.map((call) => new URL(call.url).pathname);
    for (const expected of ['/api/v1/matches/live', '/api/v1/matches/upcoming', '/api/v1/news/breaking', '/api/v1/news/latest', '/api/v1/competitions', '/api/v1/teams', '/api/v1/players']) {
      expect(paths, expected).toContain(expected);
    }
    const revalidates = new Map(
      seen.map((call) => [new URL(call.url).pathname, (call.init as { next?: { revalidate?: number } } | undefined)?.next?.revalidate]),
    );
    expect(revalidates.get('/api/v1/matches/live')).toBe(HOMEPAGE_REVALIDATE.live);
    expect(revalidates.get('/api/v1/news/latest')).toBe(HOMEPAGE_REVALIDATE.latest);
    expect(revalidates.get('/api/v1/teams')).toBe(HOMEPAGE_REVALIDATE.entities);
    expect(data.upcoming.status).toBe('ready');
    expect(data.hero?.slug).toBe('big-win');
    expect(HOMEPAGE_LIMITS.upcoming).toBeLessThanOrEqual(10);
  });

  it('isolates partial failures and never fabricates missing teams', async () => {
    mockApi((pathname) => {
      if (pathname === '/matches/live') return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'down' } } };
      if (pathname === '/matches/upcoming') return { status: 200, body: listBody([match()]) };
      if (pathname === '/news/breaking' || pathname === '/news/latest') return { status: 200, body: listBody([article()]) };
      if (pathname === '/news') return { status: 200, body: listBody([]) };
      if (pathname === '/competitions' || pathname === '/teams' || pathname === '/players') return { status: 200, body: listBody([]) };
      if (pathname.endsWith('/details')) return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'gone' } } };
      return null;
    });
    const data = await loadHomepage();
    expect(data.live).toEqual({ status: 'error', items: [] });
    expect(data.upcoming.status).toBe('error');
    expect(data.upcoming.items).toHaveLength(0);
    expect(data.hero?.slug).toBe('big-win');
    expect(data.breaking.status).toBe('ready');
  });

  it('caps the details fan-out for large match lists', async () => {
    const many = Array.from({ length: MAX_MATCH_DETAILS_FANOUT + 5 }, (_, index) =>
      match({ id: `m${index}`, slug: `match-${index}` }),
    );
    mockApi(() => ({ status: 200, body: listBody(many) }));
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(new URL(url).pathname);
        return originalFetch(url, init);
      }),
    );
    const section = await loadUpcomingMatches();
    const detailsCalls = calls.filter((path) => path.endsWith('/details'));
    expect(detailsCalls.length).toBeLessThanOrEqual(MAX_MATCH_DETAILS_FANOUT);
    expect(section.items.length).toBeLessThanOrEqual(MAX_MATCH_DETAILS_FANOUT);
  });
});

describe('homepage sections', () => {
  it('hero links canonically with breaking badge and no fabricated image', () => {
    const html = renderToString(createElement(HeroView, { article: article({ is_breaking: true }) }));
    expect(html).toContain('<h2');
    expect(html).toContain('href="/news/big-win"');
    expect(html).toContain('Breaking');
    expect(html).toContain('data-track="article-click"');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('?');
  });

  it('live section announces politely with logos, score, venue and eager art', () => {
    const html = renderToString(createElement(LiveMatchesView, { matches: [enriched()] }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Premier League');
    expect(html).toContain('https://cdn.test/fce.png');
    expect(html).toContain('href="/matches/fc-example-vs-real-sample"');
    expect(html).toContain('Arena');
    expect(html).toContain('loading="eager"');
    const upcoming = renderToString(createElement(UpcomingMatchesView, { matches: [enriched({ venueName: null })] }));
    expect(upcoming).not.toContain('aria-live');
    expect(upcoming).not.toContain('Arena');
    expect(upcoming).toContain('loading="lazy"');
  });

  it('article sections use canonical links and type badges', () => {
    const transfer = article({ id: 't1', slug: 'big-deal', article_type: 'transfer', title: 'Big Deal' });
    const breakingHtml = renderToString(createElement(BreakingNewsView, { articles: [article({ is_breaking: true })] }));
    expect(breakingHtml).not.toMatch(/href="[^"]*\?/);
    const latestHtml = renderToString(createElement(LatestNewsView, { articles: [article()] }));
    expect(latestHtml).not.toMatch(/href="[^"]*\?/);
    const transferHtml = renderToString(createElement(TransferNewsView, { articles: [transfer] }));
    expect(transferHtml).not.toMatch(/href="[^"]*\?/);
    expect(transferHtml).toContain('href="/news/big-deal"');
    expect(transferHtml).toContain('aria-label="Transfer news"');
  });

  it('popular entities link canonically with tracking and fallbacks', () => {
    const teamsHtml = renderToString(
      createElement(PopularTeamsView, {
        teams: [team(), team({ id: 't2', name: 'No Logo', slug: 'no-logo', logo_url: null })],
      }),
    );
    expect(teamsHtml).toContain('href="/teams/fc-example"');
    expect(teamsHtml).toContain('data-track="team-click"');
    expect(teamsHtml).toContain('role="img"');
    const playersHtml = renderToString(
      createElement(PopularPlayersView, {
        players: [{ id: 'p1', display_name: 'John Doe', slug: 'john-doe', photo_url: null, position: 'Forward' } as Player],
      }),
    );
    expect(playersHtml).toContain('href="/players/john-doe"');
    expect(playersHtml).toContain('Forward');
    expect(playersHtml).toContain('data-track="player-click"');
  });

  it('shell renders ready, empty and honest error states', () => {
    const ready = renderToString(
      createElement(SectionShell, {
        id: 's', title: 'Latest News', href: '/news', status: 'ready', emptyTitle: 'Empty',
        children: 'content',
      }),
    );
    expect(ready).toContain('aria-labelledby="s"');
    expect(ready).toContain('href="/news"');
    expect(ready).toContain('content');
    const empty = renderToString(
      createElement(SectionShell, { id: 's', title: 'T', status: 'empty', emptyTitle: 'Nothing here', children: null }),
    );
    expect(empty).toContain('Nothing here');
    expect(empty).not.toContain('lorem');
    const failed = renderToString(
      createElement(SectionShell, { id: 's', title: 'T', status: 'error', emptyTitle: 'E', children: null }),
    );
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('500');
    expect(failed).not.toContain('stack');
  });
});

describe('homepage metadata, analytics and responsive foundation', () => {
  it('exposes correct static SEO metadata', () => {
    // The home route uses an absolute title so the layout's `%s | <site>` template
    // does not append the site name a second time.
    const title =
      typeof homeMetadata.title === 'string'
        ? homeMetadata.title
        : (homeMetadata.title as { absolute?: string } | null | undefined)?.absolute;
    expect(title).toContain('Football');
    expect(String(homeMetadata.description)).toMatch(/live scores/i);
    expect(homeMetadata.alternates?.canonical).toBe(siteConfig.siteUrl);
    expect(homeMetadata.robots).toBe('index,follow');
    const serialized = JSON.stringify(homeMetadata);
    expect(serialized).toContain('"type":"website"');
    expect(serialized).toContain('"card":"summary_large_image"');
  });

  it('buffers analytics events safely with a cap', () => {
    trackEvent('article-click', 'x');
    const win = { __FOOTBALL_ANALYTICS__: [] as Array<unknown> };
    (globalThis as { window?: unknown }).window = win;
    trackEvent('match-click', 'm1');
    trackEvent('team-click', 't1');
    expect(win.__FOOTBALL_ANALYTICS__).toHaveLength(2);
    for (let index = 0; index < 150; index += 1) trackEvent('player-click', `p${index}`);
    expect(win.__FOOTBALL_ANALYTICS__.length).toBeLessThanOrEqual(100);
    expect(trackAttributes('competition', 'c1')).toEqual({ 'data-track': 'competition-click', 'data-track-id': 'c1' });
  });

  it('ships responsive homepage styles across breakpoints', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles', 'globals.css'), 'utf8');
    for (const selector of ['.home-page', '.home-hero', '.home-section', '.home-match-list', '.match-card__teams']) {
      expect(css, selector).toContain(selector);
    }
    for (const breakpoint of ['640px', '1024px', '1280px']) {
      expect(css, breakpoint).toContain(breakpoint);
    }
    expect(css).not.toContain('overflow-x: scroll');
  });
});

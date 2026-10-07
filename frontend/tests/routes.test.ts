import { describe, expect, it } from 'vitest';
import { ROUTES, enabledRoutes, entityUrl, routeUrl, type RouteName } from '@/config/routes';

const REQUIRED: RouteName[] = [
  'home', 'news', 'newsDetail', 'newsCategory', 'newsTag', 'breakingNews', 'transfers',
  'matches', 'matchDetail', 'live', 'competitions', 'competitionDetail',
  'teams', 'teamDetail', 'players', 'playerDetail', 'search',
];

describe('route table', () => {
  it('implements every canonical Phase 1 route', () => {
    for (const name of REQUIRED) {
      expect(ROUTES[name].enabled, name).toBe(true);
    }
    expect(enabledRoutes()).toEqual(expect.arrayContaining(REQUIRED));
  });

  it('keeps future route structures disabled (not linked)', () => {
    for (const name of ['matchLineups', 'matchStats', 'teamSquad', 'competitionTable', 'playerStats'] as RouteName[]) {
      expect(ROUTES[name].enabled, name).toBe(false);
    }
  });

  it('matches backend SEO canonical paths', () => {
    // Backend SEO system: /news, /matches, /teams, /players, /competitions.
    expect(entityUrl('news', 'big-win')).toBe('/news/big-win');
    expect(entityUrl('match', 'a-vs-b')).toBe('/matches/a-vs-b');
    expect(entityUrl('team', 'fc-example')).toBe('/teams/fc-example');
    expect(entityUrl('player', 'john-doe')).toBe('/players/john-doe');
    expect(entityUrl('competition', 'premier-league')).toBe('/competitions/premier-league');
  });

  it('builds detail URLs without trailing slashes or query strings', () => {
    expect(routeUrl('newsDetail', { slug: 'big-win' })).toBe('/news/big-win');
    expect(routeUrl('newsCategory', { slug: 'premier-league' })).toBe('/news/category/premier-league');
    expect(routeUrl('newsTag', { slug: 'derby' })).toBe('/news/tag/derby');
    expect(routeUrl('matchDetail', { slug: 'a' })).toBe('/matches/a');
    for (const name of REQUIRED) {
      const url = routeUrl(name, { slug: 'x' });
      expect(url.endsWith('/') && url !== '/').toBe(false);
      expect(url).not.toContain('?');
    }
  });

  it('has no duplicate patterns for the same canonical entity', () => {
    const patterns = Object.values(ROUTES).map((route) => route.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});

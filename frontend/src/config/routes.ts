/**
 * Canonical frontend route table — the single source of truth for paths.
 * Mirrors the backend SEO canonical system (paths must stay in sync;
 * enforced by tests). Query strings never form part of a canonical URL.
 *
 * `future` marks Phase 2/3 route structures that are planned but not
 * implemented yet. Disabled routes must not be linked or rendered.
 */

export interface RouteDefinition {
  /** Route pattern, e.g. '/news/[slug]'. */
  pattern: string;
  /** Whether the route is implemented in this phase. */
  enabled: boolean;
  /** Backend SEO entity type used for canonical + metadata resolution. */
  entityType?: 'news' | 'match' | 'team' | 'player' | 'competition';
}

export const ROUTES = {
  home: { pattern: '/', enabled: true },
  news: { pattern: '/news', enabled: true, entityType: 'news' },
  newsDetail: { pattern: '/news/[slug]', enabled: true, entityType: 'news' },
  newsCategory: { pattern: '/news/category/[slug]', enabled: true, entityType: 'news' },
  newsTag: { pattern: '/news/tag/[slug]', enabled: true, entityType: 'news' },
  breakingNews: { pattern: '/breaking-news', enabled: true, entityType: 'news' },
  transfers: { pattern: '/transfers', enabled: true },
  matches: { pattern: '/matches', enabled: true, entityType: 'match' },
  matchDetail: { pattern: '/matches/[slug]', enabled: true, entityType: 'match' },
  live: { pattern: '/live', enabled: true, entityType: 'match' },
  competitions: { pattern: '/competitions', enabled: true, entityType: 'competition' },
  competitionDetail: { pattern: '/competitions/[slug]', enabled: true, entityType: 'competition' },
  teams: { pattern: '/teams', enabled: true, entityType: 'team' },
  teamDetail: { pattern: '/teams/[slug]', enabled: true, entityType: 'team' },
  players: { pattern: '/players', enabled: true, entityType: 'player' },
  playerDetail: { pattern: '/players/[slug]', enabled: true, entityType: 'player' },
  search: { pattern: '/search', enabled: true },
  // Phase 2/3 route structures (not implemented yet — do not link).
  matchLineups: { pattern: '/matches/[slug]/lineups', enabled: false, entityType: 'match' },
  matchStats: { pattern: '/matches/[slug]/stats', enabled: false, entityType: 'match' },
  teamSquad: { pattern: '/teams/[slug]/squad', enabled: false, entityType: 'team' },
  competitionTable: { pattern: '/competitions/[slug]/table', enabled: false, entityType: 'competition' },
  playerStats: { pattern: '/players/[slug]/stats', enabled: false, entityType: 'player' },
} satisfies Record<string, RouteDefinition>;

export type RouteName = keyof typeof ROUTES;

const ENTITY_BASE_PATH: Record<string, string> = {
  news: '/news',
  match: '/matches',
  team: '/teams',
  player: '/players',
  competition: '/competitions',
};

/** Build a canonical entity URL from a slug. Never includes query params. */
export function entityUrl(entityType: keyof typeof ENTITY_BASE_PATH, slug: string): string {
  return `${ENTITY_BASE_PATH[entityType]}/${slug}`;
}

/** Canonical URL for a route pattern + params (drops query, no trailing slash). */
export function routeUrl(route: RouteName, params: Record<string, string> = {}): string {
  let path: string = ROUTES[route].pattern;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`[${key}]`, value);
  }
  return path;
}

/** All enabled (implemented) route patterns. */
export function enabledRoutes(): RouteName[] {
  return (Object.keys(ROUTES) as RouteName[]).filter((name) => ROUTES[name].enabled);
}

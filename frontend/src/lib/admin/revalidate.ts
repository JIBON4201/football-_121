/**
 * Admin → public cache invalidation.
 *
 * The public site caches through Next's data cache, keyed by the `tags` the
 * read layer already attaches (see `lib/touchline/homepage-api.ts`,
 * `lib/news.ts`, `lib/teams.ts`, ...). Before this module existed those tags
 * were write-only: nothing ever called `revalidateTag`, so an edit made in the
 * Control Center stayed invisible to readers until the longest `revalidate`
 * window expired (up to 3600s for directory data).
 *
 * Two mechanisms, because the public site uses both:
 *
 *  - `revalidateTag` for every tagged list/feed fetch.
 *  - `revalidatePath` for routes whose data is NOT tagged (SEO metadata,
 *    breadcrumbs, JSON-LD and the sitemap proxies all read untagged), so a
 *    rename or a new row still reaches canonicals and sitemaps.
 *
 * Tag names are duplicated from the read layer deliberately: they are a string
 * contract, not a module import, and `revalidateTag` needs literal strings.
 * `tests/admin-revalidate.test.ts` asserts both sides agree.
 */
import { revalidatePath, revalidateTag } from 'next/cache';

export type AdminEntity =
  | 'articles'
  | 'matches'
  | 'teams'
  | 'players'
  | 'competitions'
  | 'seasons'
  | 'venues'
  | 'transfers'
  | 'media';

/**
 * Cache tags the public read layer attaches, grouped by what an edit can change.
 *
 * Over-invalidation is deliberate and cheap here (it only forces a refetch of a
 * tagged read); under-invalidation serves stale editorial content to readers.
 */
const ENTITY_TAGS: Record<AdminEntity, readonly string[]> = {
  articles: [
    'news-list',
    'transfer-records',
    'homepage:latest',
    // An article row can reference teams/players/competitions, and the public
    // team/player/competition pages render related articles.
    'teams-list',
    'players-list',
    'competitions-list',
  ],
  matches: [
    'matches-list',
    'homepage:matches',
    'homepage:live',
    'homepage:upcoming',
    'homepage:results',
    'matches:live',
    'matches:upcoming',
    'matches:results',
  ],
  teams: ['teams-list', 'homepage:teams'],
  players: ['players-list', 'homepage:players'],
  competitions: ['competitions-list', 'homepage:competitions'],
  // Seasons and Venues have no tag of their own on the public site — they reach
  // the reader through the competition/team pages below, which are revalidated
  // by path.
  seasons: [],
  venues: [],
  transfers: ['transfers-list', 'transfer-news', 'transfer-windows', 'homepage:transfers-feed'],
  // Media rows back the responsive image component; public pages read media by
  // id through the untagged media endpoint, so only paths are revalidated.
  media: [],
};

/** Public routes whose rendered output depends on the entity. */
const ENTITY_PATHS: Record<AdminEntity, readonly string[]> = {
  articles: [
    '/',
    '/news',
    '/breaking-news',
    '/transfers',
    '/competitions',
    '/teams',
    '/players',
    '/search',
    '/live',
    '/matches',
    '/sitemap.xml',
  ],
  matches: ['/', '/matches', '/live', '/matches/live', '/news', '/search', '/competitions', '/teams', '/players', '/transfers', '/sitemap.xml'],
  teams: ['/', '/teams', '/matches', '/live', '/news', '/search', '/transfers', '/competitions', '/sitemap.xml'],
  players: ['/', '/players', '/news', '/search', '/transfers', '/teams', '/sitemap.xml'],
  competitions: ['/', '/competitions', '/matches', '/live', '/news', '/search', '/teams', '/sitemap.xml'],
  seasons: ['/competitions', '/matches', '/teams', '/', '/search', '/sitemap.xml'],
  venues: ['/teams', '/matches', '/', '/search', '/sitemap.xml'],
  transfers: ['/', '/transfers', '/news', '/search', '/teams', '/players', '/sitemap.xml'],
  media: ['/', '/news', '/matches', '/teams', '/players', '/competitions', '/transfers', '/search', '/sitemap.xml'],
};

/**
 * A change to one entity can invalidate many, and vice-versa: publishing an
 * article touches match and team pages because articles are linked to them.
 * These are the fan-out edges, kept explicit rather than blanket-invalidated.
 */
const FANOUT: Partial<Record<AdminEntity, readonly AdminEntity[]>> = {
  articles: ['matches', 'teams', 'players', 'competitions'],
  matches: ['teams', 'competitions'],
  teams: ['matches', 'players', 'competitions'],
  players: ['teams', 'matches'],
  competitions: ['matches', 'teams', 'seasons'],
  transfers: ['players', 'teams'],
};

export interface RevalidateOptions {
  /**
   * Slug of the affected match. The public match feed tags each detail fetch
   * `match-details:<slug>`, so a score/status change can be purged precisely
   * instead of dropping every cached match page.
   */
  matchSlug?: string | null;
  /**
   * Extra concrete public paths to purge, e.g. `/teams/<slug>` for a single
   * record edit. Include the slug-bearing detail route whenever it is known —
   * detail routes read SEO metadata untagged, so no tag covers them.
   */
  paths?: readonly string[];
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

/**
 * Purge every public cache entry an admin write to `entity` can have
 * invalidated. Call from a server action immediately after the backend
 * confirms the write — never before, or a failed write still costs a refetch.
 */
export function revalidatePublic(entity: AdminEntity, options: RevalidateOptions = {}): void {
  const affected = unique([entity, ...(FANOUT[entity] ?? [])]);

  for (const key of affected) {
    for (const tag of ENTITY_TAGS[key]) {
      revalidateTag(tag);
    }
    for (const path of ENTITY_PATHS[key]) {
      revalidatePath(path);
    }
  }

  if (options.matchSlug) {
    revalidateTag(`match-details:${options.matchSlug}`);
    revalidatePath(`/matches/${options.matchSlug}`);
  }

  for (const path of options.paths ?? []) {
    revalidatePath(path);
  }
}

/** Test seam: the tag map is asserted against the read layer in tests. */
export function publicTagsFor(entity: AdminEntity): string[] {
  return unique([...(FANOUT[entity] ?? []).flatMap((key) => ENTITY_TAGS[key]), ...ENTITY_TAGS[entity]]);
}
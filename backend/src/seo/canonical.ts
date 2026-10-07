import { config } from '../config';

export const CANONICAL_ENTITY_TYPES = [
  'news',
  'match',
  'team',
  'player',
  'competition',
  'season',
  'transfer',
] as const;

export type CanonicalEntityType = (typeof CANONICAL_ENTITY_TYPES)[number];

/** Canonical frontend paths. Mirrors lib/urls for shared types (tested). */
const CANONICAL_PATHS: Record<CanonicalEntityType, string> = {
  news: '/news',
  match: '/matches',
  team: '/teams',
  player: '/players',
  competition: '/competitions',
  season: '/seasons',
  transfer: '/transfers',
};

const SLUG_PATTERN = /^[A-Za-z0-9_.-]+$/;
const MAX_SLUG_LENGTH = 300;

export function isValidSlug(slug: string): boolean {
  return (
    typeof slug === 'string' &&
    slug.length >= 1 &&
    slug.length <= MAX_SLUG_LENGTH &&
    SLUG_PATTERN.test(slug)
  );
}

/**
 * Deterministic canonical path: stable slug, no query params, no trailing
 * slash. Throws on invalid slugs so bad data never becomes a canonical URL.
 */
export function canonicalPath(entityType: CanonicalEntityType, slug: string): string {
  if (!isValidSlug(slug)) throw new Error(`Invalid slug for canonical URL: ${slug}`);
  return `${CANONICAL_PATHS[entityType]}/${slug}`;
}

/** Absolute canonical URL (site base + path, single trailing-slash rule). */
export function absoluteCanonicalUrl(entityType: CanonicalEntityType, slug: string): string {
  return `${config.site.baseUrl}${canonicalPath(entityType, slug)}`;
}

/** Absolute URL for an already-validated canonical path. */
export function absoluteUrl(path: string): string {
  if (!path.startsWith('/')) throw new Error(`Canonical path must start with /: ${path}`);
  if (path !== '/' && path.endsWith('/')) throw new Error(`Canonical path must not end with /: ${path}`);
  return `${config.site.baseUrl}${path}`;
}

/** Reverse-parse a canonical path into entity + slug (null when unknown). */
export function parseCanonicalPath(path: string): { entityType: CanonicalEntityType; slug: string } | null {
  const clean = path.split('?')[0].split('#')[0];
  for (const [type, base] of Object.entries(CANONICAL_PATHS) as Array<[CanonicalEntityType, string]>) {
    if (clean.startsWith(`${base}/`)) {
      const slug = clean.slice(base.length + 1).replace(/\/$/, '');
      if (slug && !slug.includes('/') && isValidSlug(slug)) return { entityType: type, slug };
      return null;
    }
  }
  return null;
}

/** Case-insensitive duplicate detection across a URL set. */
export function findDuplicateCanonicals(urls: string[]): string[] {
  const seen = new Map<string, string>();
  const dupes = new Set<string>();
  for (const url of urls) {
    const key = url.toLowerCase();
    if (seen.has(key)) {
      dupes.add(seen.get(key) as string);
      dupes.add(url);
    } else {
      seen.set(key, url);
    }
  }
  return [...dupes];
}

/** A canonical that points at itself (or A↔B pair) is a loop. */
export function isCanonicalLoop(source: string, destination: string): boolean {
  return source === destination || source.toLowerCase() === destination.toLowerCase();
}

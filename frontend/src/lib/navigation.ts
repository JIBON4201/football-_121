import type { RouteName } from '@/config/routes';

/**
 * Canonical navigation sections. Nested routes inherit their parent section
 * (e.g. /news/anything → news). Utility routes (search) belong to no section.
 */
export type NavSection =
  | 'home'
  | 'live'
  | 'matches'
  | 'news'
  | 'transfers'
  | 'competitions'
  | 'teams'
  | 'players';

const SECTION_PREFIXES: ReadonlyArray<{ section: NavSection; prefixes: ReadonlyArray<string> }> = [
  { section: 'news', prefixes: ['/news', '/breaking-news'] },
  { section: 'matches', prefixes: ['/matches'] },
  { section: 'live', prefixes: ['/live'] },
  { section: 'transfers', prefixes: ['/transfers'] },
  { section: 'competitions', prefixes: ['/competitions'] },
  { section: 'teams', prefixes: ['/teams'] },
  { section: 'players', prefixes: ['/players'] },
];

/** Strip query/hash and trailing slashes (root stays '/'). */
export function normalizePath(raw: string): string {
  const withoutQuery = raw.split('?')[0].split('#')[0];
  if (withoutQuery.length > 1) return withoutQuery.replace(/\/+$/, '') || '/';
  return withoutQuery || '/';
}

/**
 * Resolve the active navigation section for a pathname.
 * Returns null for home-adjacent utility routes (e.g. /search) and unknown paths.
 */
export function activeNavRoute(pathname: string): NavSection | null {
  const path = normalizePath(pathname);
  if (path === '/') return 'home';
  for (const { section, prefixes } of SECTION_PREFIXES) {
    if (prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return section;
    }
  }
  return null;
}

/** Map a section back to its canonical listing route (single URL per entity). */
export function sectionRoute(section: NavSection): RouteName {
  switch (section) {
    case 'home':
      return 'home';
    case 'live':
      return 'live';
    case 'matches':
      return 'matches';
    case 'news':
      return 'news';
    case 'transfers':
      return 'transfers';
    case 'competitions':
      return 'competitions';
    case 'teams':
      return 'teams';
    case 'players':
      return 'players';
  }
}

export function isSectionActive(section: NavSection, pathname: string): boolean {
  return activeNavRoute(pathname) === section;
}

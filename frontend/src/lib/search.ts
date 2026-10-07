import { isValidSlug, sanitizeText, toSafeHref } from '@/lib/validation';
import type { SearchResultItem, SearchableEntityType } from '@/types/api';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 200;
export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_PAGE_SIZE = 10;
/** Suggestions stay deliberately small; autocomplete must never load a dataset. */
export const SUGGESTION_LIMIT = 5;
export const SEARCH_MAX_PAGE = 50;

export type SearchableType = SearchableEntityType;

/**
 * Display order for result groups. Entities first, long-form news last, so the
 * most actionable answers sit at the top on every screen size.
 */
export const SEARCH_GROUP_ORDER: ReadonlyArray<SearchableType> = [
  'team',
  'player',
  'competition',
  'match',
  'news',
];

export const SEARCH_GROUP_LABELS: Record<SearchableType, string> = {
  team: 'Teams',
  player: 'Players',
  competition: 'Competitions',
  match: 'Matches',
  news: 'News',
};

/** Singular label for one result, used in cards and announcements. */
export const SEARCH_TYPE_LABELS: Record<SearchableType, string> = {
  team: 'Team',
  player: 'Player',
  competition: 'Competition',
  match: 'Match',
  news: 'News',
};

/** Canonical frontend base path per searchable entity (mirrors backend SEO paths). */
const SEARCH_ENTITY_BASE_PATH: Record<SearchableType, string> = {
  news: '/news',
  match: '/matches',
  team: '/teams',
  player: '/players',
  competition: '/competitions',
};

export const SEARCHABLE_TYPES: ReadonlyArray<SearchableType> = [
  'team',
  'player',
  'competition',
  'match',
  'news',
];

export function isSearchableType(value: string): value is SearchableType {
  return (SEARCHABLE_TYPES as readonly string[]).includes(value);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Query is worth sending once trimmed to [MIN, MAX] characters. */
export function isSearchableQuery(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const query = raw.trim();
  return query.length >= SEARCH_MIN_LENGTH && query.length <= SEARCH_MAX_LENGTH;
}

/** Normalize raw input for requests and URL state (never trusts raw input). */
export function normalizeQuery(raw: string | null | undefined): string {
  if (!raw) return '';
  return sanitizeText(raw).trim().slice(0, SEARCH_MAX_LENGTH);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface SearchFilters {
  query: string;
  /** null means "all types". */
  type: SearchableType | null;
  competition: string | null;
  team: string | null;
  from: string | null;
  to: string | null;
  page: number;
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  query: '',
  type: null,
  competition: null,
  team: null,
  from: null,
  to: null,
  page: 1,
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Optional ISO date, rejected unless it is a real calendar date. */
function optionalDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) return null;
  const parsed = Date.parse(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(parsed) ? null : trimmed;
}

function optionalSlug(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && isValidSlug(trimmed) ? trimmed : null;
}

/**
 * Parse filters from a query string.
 *
 * Every value is validated against a closed set or a strict pattern, so a
 * hand-edited URL can never widen the request or inject anything downstream.
 * Invalid values are dropped rather than passed through.
 */
export function parseSearchFilters(params: Record<string, string | string[] | undefined>): SearchFilters {
  const rawType = firstValue(params.type);
  const page = Number(firstValue(params.page) ?? '1');
  return {
    query: normalizeQuery(firstValue(params.q)),
    type: rawType && isSearchableType(rawType) ? rawType : null,
    competition: optionalSlug(firstValue(params.competition)),
    team: optionalSlug(firstValue(params.team)),
    from: optionalDate(firstValue(params.from)),
    to: optionalDate(firstValue(params.to)),
    page: Number.isInteger(page) && page >= 1 && page <= SEARCH_MAX_PAGE ? page : 1,
  };
}

/**
 * Serialize filters to a canonical query string.
 *
 * `undefined` and `null` entries are omitted, so the default state produces
 * `/search?q=…` with no noise. Only validated values ever reach the URL.
 */
export function toSearchQueryString(filters: Partial<SearchFilters>): string {
  const parts: string[] = [];
  const query = filters.query !== undefined ? normalizeQuery(filters.query) : '';
  if (query) parts.push(`q=${encodeURIComponent(query)}`);
  if (filters.type && isSearchableType(filters.type)) parts.push(`type=${filters.type}`);
  if (filters.competition && isValidSlug(filters.competition)) {
    parts.push(`competition=${encodeURIComponent(filters.competition)}`);
  }
  if (filters.team && isValidSlug(filters.team)) parts.push(`team=${encodeURIComponent(filters.team)}`);
  if (filters.from && ISO_DATE.test(filters.from)) parts.push(`from=${filters.from}`);
  if (filters.to && ISO_DATE.test(filters.to)) parts.push(`to=${filters.to}`);
  if (filters.page && filters.page > 1) parts.push(`page=${filters.page}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** Canonical shareable search URL. An unusable query collapses to plain /search. */
export function buildSearchUrl(query: string, filters: Partial<SearchFilters> = {}): string {
  return `/search${toSearchQueryString({ ...filters, query })}`;
}

/** Recover query state from a location.search string (shareable URLs). */
export function parseSearchQuery(search: string): string {
  return parseSearchFilters(queryParamsFrom(search)).query;
}

function queryParamsFrom(search: string): Record<string, string | undefined> {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const out: Record<string, string | undefined> = {};
    for (const [key, value] of Array.from(params.entries())) {
      // First value wins, so a repeated parameter cannot be used to smuggle one in.
      if (!(key in out)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** True when any filter narrows the result set. */
export function hasActiveFilters(filters: SearchFilters): boolean {
  return (
    filters.type !== null ||
    filters.competition !== null ||
    filters.team !== null ||
    filters.from !== null ||
    filters.to !== null
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface SearchResultGroup {
  type: SearchableType;
  label: string;
  items: SearchResultItem[];
}

/**
 * Group results by entity type.
 *
 * Order *within* each group is untouched, so the backend's relevance ranking is
 * preserved exactly. Only the grouping order is applied, never a re-sort.
 * Empty groups are omitted entirely.
 */
export function groupResultsByType(items: SearchResultItem[]): SearchResultGroup[] {
  const buckets = new Map<SearchableType, SearchResultItem[]>();
  for (const item of items) {
    if (!isSearchableType(item.entity_type)) continue;
    const list = buckets.get(item.entity_type) ?? [];
    list.push(item);
    buckets.set(item.entity_type, list);
  }
  return SEARCH_GROUP_ORDER.filter((type) => (buckets.get(type)?.length ?? 0) > 0).map((type) => ({
    type,
    label: SEARCH_GROUP_LABELS[type],
    items: buckets.get(type) ?? [],
  }));
}

/**
 * Resolve a result's navigation target. Prefers the backend canonical URL
 * when it is safe and matches the entity base path; otherwise rebuilds the
 * canonical URL from entity type + slug; null when neither is safe.
 */
export function canonicalResultUrl(item: Pick<SearchResultItem, 'entity_type' | 'slug' | 'url'>): string | null {
  const base = SEARCH_ENTITY_BASE_PATH[item.entity_type];
  if (!base) return null;
  const candidate = toSafeHref(item.url);
  if (candidate && candidate.startsWith('/') && (candidate === base || candidate.startsWith(`${base}/`))) {
    return candidate;
  }
  if (!isValidSlug(item.slug)) return null;
  return `${base}/${item.slug}`;
}

/**
 * Compact suggestions: keep at most `limit` per entity type and drop news
 * after the entity types, so the dropdown stays scannable and small.
 */
export function compactSuggestions(
  items: SearchResultItem[],
  limit: number = SUGGESTION_LIMIT,
): SearchResultItem[] {
  const counts = new Map<SearchableType, number>();
  const kept: SearchResultItem[] = [];
  for (const type of SEARCH_GROUP_ORDER) {
    for (const item of items) {
      if (item.entity_type !== type) continue;
      const seen = counts.get(type) ?? 0;
      if (seen >= limit) break;
      counts.set(type, seen + 1);
      kept.push(item);
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * Split text into plain segments for highlighting.
 *
 * Returns *data*, never markup: the caller renders `<mark>` around matched
 * parts, so a query containing `<script>` can only ever become escaped text.
 * Matching is case-insensitive and whole-token aware.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const source = sanitizeText(text);
  const needle = normalizeQuery(query).toLowerCase();
  if (!needle) return [{ text: source, match: false }];

  const lower = source.toLowerCase();
  const parts: HighlightPart[] = [];
  let cursor = 0;
  let index = lower.indexOf(needle);
  while (index !== -1) {
    if (index > cursor) parts.push({ text: source.slice(cursor, index), match: false });
    parts.push({ text: source.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), match: false });
  return parts.length > 0 ? parts : [{ text: source, match: false }];
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

/**
 * Flat-list keyboard navigation for ArrowUp/Down/Home/End with wrapping.
 * `current` is the active option index, -1 means focus is on the input.
 */
export function nextActiveIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowDown':
      return current >= count - 1 ? 0 : current + 1;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return current;
  }
}

/** Cancelable debounce for keystroke-driven requests. */
export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, waitMs: number): {
  call: (...args: Args) => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call: (...args: Args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, waitMs);
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Landing / empty helpers
// ---------------------------------------------------------------------------

/** Broader alternatives offered when a query returns nothing. */
export function broadenQuery(query: string): string[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];
  const suggestions = new Set<string>();
  // Drop the last word, then any single leading token: shorter queries match more.
  const words = normalized.split(' ').filter(Boolean);
  if (words.length > 1) suggestions.add(words.slice(0, -1).join(' '));
  if (words.length > 1 && words[0].length > SEARCH_MIN_LENGTH) suggestions.add(words.slice(1).join(' '));
  if (words.length > 1) suggestions.add(words[0]);
  return Array.from(suggestions).filter((value) => value.length >= SEARCH_MIN_LENGTH && value !== normalized).slice(0, 3);
}

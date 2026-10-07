import { isSearchableQuery, normalizeQuery, SEARCH_MAX_LENGTH } from '@/lib/search';

/**
 * Recent searches — strictly local.
 *
 * The history lives only in this browser's `localStorage` and is never sent to
 * the backend: there is no request, no cookie and no sync. Entries are capped,
 * de-duplicated case-insensitively, and re-validated on read so a tampered
 * value can never be rendered or reused as a query.
 */

const STORAGE_KEY = 'football.recentSearches.v1';
export const RECENT_SEARCH_LIMIT = 8;

/**
 * Only genuine, plain-text queries are remembered.
 *
 * A value containing markup is rejected outright rather than stripped and
 * stored as a mangled term: "alert(1)" is not something a reader searched for,
 * and history should not accumulate noise from probes.
 */
function sanitizeEntry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.includes('<') || value.includes('>')) return null;
  const normalized = normalizeQuery(value);
  return isSearchableQuery(normalized) ? normalized.slice(0, SEARCH_MAX_LENGTH) : null;
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Storage can throw in private mode or when blocked by policy.
    return null;
  }
}

/**
 * Read the history. Any malformed, oversized or non-array payload yields an
 * empty list rather than propagating bad data.
 */
export function readRecentSearches(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeEntry)
      .filter((entry): entry is string => entry !== null)
      .slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

function write(entries: string[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, RECENT_SEARCH_LIMIT)));
  } catch {
    // A full or unavailable quota must never break search.
  }
}

/** Record a query as most-recent-first, de-duplicated and capped. */
export function rememberSearch(query: string): string[] {
  const entry = sanitizeEntry(query);
  if (!entry) return readRecentSearches();
  const existing = readRecentSearches().filter(
    (value) => value.toLowerCase() !== entry.toLowerCase(),
  );
  const next = [entry, ...existing].slice(0, RECENT_SEARCH_LIMIT);
  write(next);
  return next;
}

/** Forget one entry (e.g. when a user removes it individually). */
export function removeRecentSearch(query: string): string[] {
  const target = normalizeQuery(query).toLowerCase();
  const next = readRecentSearches().filter((value) => value.toLowerCase() !== target);
  write(next);
  return next;
}

/** Clear the whole history. */
export function clearRecentSearches(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: nothing actionable for the reader.
  }
}

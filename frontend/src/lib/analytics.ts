/**
 * Lightweight analytics readiness hooks. No third-party provider is wired:
 * events are buffered on window.__FOOTBALL_ANALYTICS__ for a future loader
 * to drain. Safe to call during SSR (no-op without a window).
 */

export type AnalyticsEventName =
  | 'article-click'
  | 'match-click'
  | 'team-click'
  | 'player-click'
  | 'competition-click'
  | 'search-interaction'
  // Search funnel. Only the query shape is ever recorded — never the raw text.
  | 'search-submitted'
  | 'search-suggestion-selected'
  | 'search-result-clicked'
  | 'search-no-results';

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  id: string;
  timestamp: string;
}

/** Optional, non-identifying context (result counts, entity type, filters). */
export type AnalyticsContext = Record<string, string | number | boolean>;

export interface AnalyticsRecord extends AnalyticsEvent {
  context?: AnalyticsContext;
}

const MAX_QUEUE_LENGTH = 100;

declare global {
  interface Window {
    __FOOTBALL_ANALYTICS__?: AnalyticsRecord[];
  }
}

/** Buffer an analytics event for future collection. Never throws. */
export function trackEvent(
  name: AnalyticsEventName,
  id: string,
  context?: AnalyticsContext,
): void {
  try {
    if (typeof window === 'undefined') return;
    const queue = (window.__FOOTBALL_ANALYTICS__ ??= []);
    queue.push({
      name,
      id,
      timestamp: new Date().toISOString(),
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
    });
    if (queue.length > MAX_QUEUE_LENGTH) queue.splice(0, queue.length - MAX_QUEUE_LENGTH);
  } catch {
    // Analytics must never break the page.
  }
}

/**
 * Record a search interaction without ever storing the reader's query text.
 *
 * The `id` is a shape descriptor (e.g. `query-length:12`, `type:team`) rather
 * than the query itself, so search history cannot be reconstructed from
 * analytics. `context` is restricted to counts, types and booleans.
 */
export function trackSearch(
  name: 'search-submitted' | 'search-suggestion-selected' | 'search-result-clicked' | 'search-no-results',
  details: { query: string; resultCount?: number; entityType?: string; hasFilters?: boolean; viaKeyboard?: boolean },
): void {
  const shape = `query-length:${Math.min(details.query.trim().length, SEARCH_QUERY_SHAPE_CAP)}`;
  trackEvent(name, shape, {
    ...(typeof details.resultCount === 'number' ? { resultCount: details.resultCount } : {}),
    ...(details.entityType ? { entityType: details.entityType } : {}),
    ...(typeof details.hasFilters === 'boolean' ? { hasFilters: details.hasFilters } : {}),
    ...(typeof details.viaKeyboard === 'boolean' ? { viaKeyboard: details.viaKeyboard } : {}),
  });
}

const SEARCH_QUERY_SHAPE_CAP = 50;

export type TrackableKind = 'article' | 'match' | 'team' | 'player' | 'competition' | 'search-result';

/**
 * Data attributes marking a link as trackable. A future analytics loader
 * delegates clicks on [data-track] — no per-link JavaScript needed today.
 */
export function trackAttributes(kind: TrackableKind, id: string): {
  'data-track': `${TrackableKind}-click`;
  'data-track-id': string;
} {
  return { 'data-track': `${kind}-click`, 'data-track-id': id };
}

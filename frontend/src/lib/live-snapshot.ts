import { fetchMatchList, type MatchFilters, type MatchListItem } from '@/lib/matches';

/**
 * Server-side live snapshot.
 *
 * `fetchMatchList` requests the backend's `include=card` list shape, so the
 * snapshot carries resolved teams, competition and venue without any
 * per-match details fan-out. A fixture whose teams cannot be resolved is
 * dropped upstream rather than rendered with a placeholder name.
 *
 * The page is server-rendered from this snapshot so the first paint is
 * meaningful without JavaScript; `LiveFeed` then keeps it current in the
 * browser.
 */

export const LIVE_SNAPSHOT_LIMIT = 12;

export interface LiveSnapshot {
  items: MatchListItem[];
  /** Server time at render, used to anchor the clock before the first poll. */
  serverTime: string | null;
}

export async function fetchLiveSnapshot(limit = LIVE_SNAPSHOT_LIMIT): Promise<LiveSnapshot> {
  const filters: MatchFilters = {
    page: 1,
    limit,
    phase: 'live',
    status: null,
    competition: null,
    team: null,
    from: null,
    to: null,
    sort: null,
  };
  const list = await fetchMatchList(filters);
  return {
    items: list.status === 'ready' ? list.rows : [],
    serverTime: new Date().toISOString(),
  };
}

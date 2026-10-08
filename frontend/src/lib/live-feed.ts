import type { MatchListItem } from '@/lib/matches';
import { isLiveStatus, sortLiveMatches } from '@/lib/live-state';
import type { Match } from '@/types/api';

/**
 * Live feed assembly.
 *
 * The live endpoint returns card-shaped rows (`include=card`), so every polled
 * row already carries resolved teams, competition and minimal event data. The
 * feed is still built from the enriched server snapshot and *updated* from the
 * polled rows rather than re-fetching every match on every tick:
 *
 *  - only the volatile fields (status and scores) come from each poll, so the
 *    score is always backend truth and is never computed on the client;
 *  - a match that becomes live after the page loaded arrives fully enriched in
 *    the poll payload and is added directly — no per-match details lookup.
 */

export interface LiveFeedPayload {
  items: MatchListItem[];
  /** Latest server time reported alongside the feed, if any. */
  serverTime: string | null;
}

/** Fields a poll is allowed to change on an already-enriched item. */
const VOLATILE_FIELDS = [
  'status',
  'home_score',
  'away_score',
  'home_score_ht',
  'away_score_ht',
  'scheduled_at',
] as const;

function applyVolatileFields(item: MatchListItem, row: Match): MatchListItem {
  const next = { ...item.match };
  for (const field of VOLATILE_FIELDS) {
    const value = row[field];
    if (value !== undefined) (next as Record<string, unknown>)[field] = value;
  }
  return { ...item, match: next };
}

/**
 * Merge polled card rows into the enriched snapshot.
 *
 * Rows the backend reports as no longer live are dropped, so a match that ends
 * or is postponed leaves the live page without a page reload. Rows that are
 * new to the snapshot are included directly, already fully enriched.
 */
export function mergeLiveRows(
  snapshot: MatchListItem[],
  rows: Array<{ item: MatchListItem; serverTime: string | null }>,
): LiveFeedPayload {
  const bySlug = new Map(snapshot.map((item) => [item.match.slug, item]));
  const items: MatchListItem[] = [];
  let serverTime: string | null = null;

  for (const { item, serverTime: rowServerTime } of rows) {
    if (rowServerTime) serverTime = rowServerTime;
    if (!isLiveStatus(item.match.status)) continue;
    const existing = bySlug.get(item.match.slug);
    items.push(existing ? applyVolatileFields(existing, item.match) : item);
  }

  return { items: sortLiveMatches(items, (item) => item.match), serverTime };
}

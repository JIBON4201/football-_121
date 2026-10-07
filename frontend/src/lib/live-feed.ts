import type { MatchListItem } from '@/lib/matches';
import { isLiveStatus, sortLiveMatches } from '@/lib/live-state';
import type { Match } from '@/types/api';

/**
 * Live feed assembly.
 *
 * The live endpoint returns lightweight match rows, while a card needs resolved
 * team names, logos and a competition link. Rather than re-fetching every match
 * on every tick — which would be an N+1 request storm — the feed is built from
 * an enriched server snapshot and then *updated* from the polled rows:
 *
 *  - team names, logos and competitions are stable, so they are read once;
 *  - only the volatile fields (status and scores) come from each poll, so the
 *    score is always backend truth and is never computed on the client;
 *  - a match that becomes live after the page loaded cannot be named from the
 *    snapshot, so it is reported as `unknownSlugs` for the caller to resolve
 *    through the aggregated details endpoint.
 */

export interface LiveFeedPayload {
  items: MatchListItem[];
  /** Slugs of matches present in the feed but absent from the snapshot. */
  unknownSlugs: string[];
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
 * Merge polled rows into the enriched snapshot.
 *
 * Rows the backend reports as no longer live are dropped, so a match that ends
 * or is postponed leaves the live page without a page reload. Rows that are new
 * to the snapshot are returned as `unknownSlugs` instead of being rendered with
 * an invented team name.
 */
export function mergeLiveRows(
  snapshot: MatchListItem[],
  rows: Array<{ match: Match; serverTime: string | null }>,
): LiveFeedPayload {
  const bySlug = new Map(snapshot.map((item) => [item.match.slug, item]));
  const items: MatchListItem[] = [];
  const unknownSlugs: string[] = [];
  let serverTime: string | null = null;

  for (const { match, serverTime: rowServerTime } of rows) {
    if (rowServerTime) serverTime = rowServerTime;
    if (!isLiveStatus(match.status)) continue;
    const existing = bySlug.get(match.slug);
    if (!existing) {
      unknownSlugs.push(match.slug);
      continue;
    }
    items.push(applyVolatileFields(existing, match));
  }

  return { items: sortLiveMatches(items, (item) => item.match), unknownSlugs, serverTime };
}

/** Cap on how many new matches a single tick may resolve. */
export const LIVE_RESOLVE_BATCH = 4;

/**
 * Pick which unknown slugs to resolve now, keeping the feed responsive when
 * several matches kick off at once.
 */
export function nextResolveBatch(unknownSlugs: string[], alreadyTried: Set<string>, batch = LIVE_RESOLVE_BATCH): string[] {
  return unknownSlugs.filter((slug) => !alreadyTried.has(slug)).slice(0, batch);
}

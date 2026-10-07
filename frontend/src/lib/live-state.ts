/**
 * Live-match state helpers.
 *
 * Every function here is pure and derives only from backend data. The rules
 * that matter:
 *
 *  - A live state is never inferred from a timestamp. `match.status` is the only
 *    source of truth, so a scheduled kickoff time can never make a match "live".
 *  - There is no authoritative match clock in the data model, so elapsed time is
 *    an explicitly-labelled approximation, and it is suppressed entirely for
 *    half-time, suspended, finished and void matches.
 *  - Nothing is ever mutated: scores come from the backend untouched, and events
 *    are de-duplicated by id so a provider correction cannot double up.
 */

export const LIVE_STATUSES = ['live', 'half_time', 'extra_time', 'penalty_shootout', 'suspended'] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

export const TERMINAL_STATUSES = [
  'finished',
  'postponed',
  'cancelled',
  'abandoned',
] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export const SCHEDULED_STATUSES = ['scheduled', 'pre_match'] as const;

export function isLiveStatus(status: string): status is LiveStatus {
  return (LIVE_STATUSES as readonly string[]).includes(status);
}

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isScheduledStatus(status: string): boolean {
  return (SCHEDULED_STATUSES as readonly string[]).includes(status);
}

/** Short token shown on a card: LIVE, HT, ET, PEN, SUSPENDED. */
export type LiveToken = 'LIVE' | 'HT' | 'ET' | 'PEN' | 'SUSPENDED';

const STATUS_TOKENS: Record<string, { token: LiveToken; label: string }> = {
  live: { token: 'LIVE', label: 'Live' },
  half_time: { token: 'HT', label: 'Half time' },
  extra_time: { token: 'ET', label: 'Extra time' },
  penalty_shootout: { token: 'PEN', label: 'Penalty shootout' },
  suspended: { token: 'SUSPENDED', label: 'Suspended' },
};

export function liveTokenFor(status: string): { token: LiveToken; label: string } | null {
  return STATUS_TOKENS[status] ?? null;
}

/** Grouping bucket used to order live sections. */
export type LivePhase = 'in_play' | 'break' | 'halted';

const PHASES: Record<string, LivePhase> = {
  live: 'in_play',
  extra_time: 'in_play',
  half_time: 'break',
  penalty_shootout: 'break',
  suspended: 'halted',
};

export function livePhaseFor(status: string): LivePhase | null {
  return PHASES[status] ?? null;
}

const PHASE_ORDER: Record<LivePhase, number> = { in_play: 0, break: 1, halted: 2 };

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/**
 * Minutes elapsed since kickoff, or null when it cannot be known.
 *
 * This is an approximation for display only: the data model carries no official
 * match clock, so the value is derived from `scheduled_at` and the server-time
 * anchor. It is deliberately suppressed wherever a running clock would be a
 * lie.
 */
export function elapsedMinutes(scheduledAt: string, serverNowMs: number): number | null {
  const kickoff = Date.parse(scheduledAt);
  if (Number.isNaN(kickoff)) return null;
  const elapsed = Math.floor((serverNowMs - kickoff) / 60_000);
  // Before kickoff, or implausibly long, there is nothing sensible to show.
  if (elapsed < 0) return 0;
  if (elapsed > 200) return null;
  return elapsed;
}

export interface LiveClock {
  /** Visible token, e.g. "67'". */
  label: string;
  /** Screen-reader text that states the value is approximate. */
  accessible: string;
}

/**
 * The clock for a match, or null when a running clock would be wrong.
 *
 * Half-time, penalty shootout and suspended matches have no running clock, and
 * added time is never invented because the model does not record it.
 */
export function liveClockFor(status: string, scheduledAt: string, serverNowMs: number): LiveClock | null {
  if (status !== 'live' && status !== 'extra_time') return null;
  const elapsed = elapsedMinutes(scheduledAt, serverNowMs);
  if (elapsed === null) return null;
  const period = status === 'extra_time' ? 'in extra time, approximately' : 'approximately';
  return {
    label: `${elapsed}'`,
    accessible: `${period} ${elapsed} minutes elapsed`,
  };
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/** After this long without a successful update, data is presented as delayed. */
export const LIVE_STALE_AFTER_MS = 60_000;

/** Consecutive failures before the UI reports the feed as unavailable. */
export const LIVE_FAILURE_THRESHOLD = 3;

export function isStale(lastUpdatedAtMs: number | null, nowMs: number, staleAfterMs = LIVE_STALE_AFTER_MS): boolean {
  if (lastUpdatedAtMs === null) return false;
  return nowMs - lastUpdatedAtMs > staleAfterMs;
}

/**
 * Freshness wording for a reader. Provider internals are never mentioned — the
 * only honest statement is that the data may be behind.
 */
export function freshnessLabel(lastUpdatedAtMs: number | null, nowMs: number): string {
  if (lastUpdatedAtMs === null) return 'Not updated yet';
  const seconds = Math.max(0, Math.round((nowMs - lastUpdatedAtMs) / 1000));
  if (seconds < 10) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Updated ${minutes} min ago`;
}

// ---------------------------------------------------------------------------
// Grouping and ordering
// ---------------------------------------------------------------------------

/** The minimum a grouping row needs: a resolved competition, or nothing. */
export interface LiveGroupable {
  competition: { name: string; slug: string } | null;
}

export interface LiveCompetitionGroup<T> {
  key: string;
  name: string;
  slug: string | null;
  items: T[];
}

/**
 * Order live matches: in-play first, then breaks, then halted; within a phase,
 * by kickoff time and then id so equal timestamps are deterministic.
 *
 * The optional selector lets callers that wrap a match (a listing item, for
 * example) sort without reshaping their data.
 */
interface SortableMatch {
  id: string;
  status: string;
  scheduled_at: string;
}

export function sortLiveMatches<T extends SortableMatch>(rows: T[]): T[];
export function sortLiveMatches<T>(rows: T[], select: (row: T) => SortableMatch): T[];
export function sortLiveMatches<T>(rows: T[], select?: (row: T) => SortableMatch): T[] {
  const read = select ?? ((row: T) => row as unknown as SortableMatch);
  return [...rows].sort((a, b) => {
    const rowA = read(a);
    const rowB = read(b);
    const phaseA = livePhaseFor(rowA.status);
    const phaseB = livePhaseFor(rowB.status);
    const orderA = phaseA === null ? 9 : PHASE_ORDER[phaseA];
    const orderB = phaseB === null ? 9 : PHASE_ORDER[phaseB];
    if (orderA !== orderB) return orderA - orderB;
    const timeA = Date.parse(rowA.scheduled_at);
    const timeB = Date.parse(rowB.scheduled_at);
    if (timeA !== timeB) return (Number.isNaN(timeA) ? 0 : timeA) - (Number.isNaN(timeB) ? 0 : timeB);
    return rowA.id.localeCompare(rowB.id);
  });
}

/** Group live matches under their competition, preserving the input order. */
export function groupLiveByCompetition<R extends LiveGroupable>(rows: R[]): Array<LiveCompetitionGroup<R>> {
  const groups = new Map<string, LiveCompetitionGroup<R>>();
  for (const row of rows) {
    // A match with no competition still needs a home; it is never dropped.
    const key = row.competition?.slug ?? `ungrouped:${row.competition?.name ?? 'Competition not recorded'}`;
    const existing = groups.get(key);
    if (existing) existing.items.push(row);
    else
      groups.set(key, {
        key,
        name: row.competition?.name ?? 'Competition not recorded',
        slug: row.competition?.slug ?? null,
        items: [row],
      });
  }
  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** The minimum an event row needs to be placed on a timeline. */
export interface LiveEventLike {
  id: string;
  minute: number | null;
  extra_minute: number | null;
  /** Home = 0, away = 1, unknown = null. */
  side: number | null;
}

const SIDE_ORDER: Record<number, number> = { 0: 0, 1: 1 };

/**
 * Chronological order with a deterministic tiebreak.
 *
 * De-duplication is by id: when a provider corrects an event the backend may
 * briefly return both versions, and the reader must never see the same event
 * twice. Equal minutes and added minutes fall back to the side, then the id.
 */
export function dedupeAndSortEvents<T extends LiveEventLike>(events: T[]): T[] {
  const byId = new Map<string, T>();
  for (const event of events) {
    // First occurrence wins, so a later duplicate cannot displace the original.
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const minuteA = a.minute ?? Number.MAX_SAFE_INTEGER;
    const minuteB = b.minute ?? Number.MAX_SAFE_INTEGER;
    if (minuteA !== minuteB) return minuteA - minuteB;
    const extraA = a.extra_minute ?? 0;
    const extraB = b.extra_minute ?? 0;
    if (extraA !== extraB) return extraA - extraB;
    const sideA = a.side === null ? 9 : (SIDE_ORDER[a.side] ?? 9);
    const sideB = b.side === null ? 9 : (SIDE_ORDER[b.side] ?? 9);
    if (sideA !== sideB) return sideA - sideB;
    return a.id.localeCompare(b.id);
  });
}

/** "45+2'" style stamp, or null when the minute was never recorded. */
export function eventMinuteLabel(minute: number | null, extraMinute: number | null): string | null {
  if (minute === null) return null;
  if (extraMinute !== null && extraMinute > 0) return `${minute}+${extraMinute}'`;
  return `${minute}'`;
}

const EVENT_LABELS: Record<string, string> = {
  goal: 'Goal',
  penalty_goal: 'Penalty goal',
  own_goal: 'Own goal',
  yellow_card: 'Yellow card',
  second_yellow_card: 'Second yellow card',
  red_card: 'Red card',
  substitution: 'Substitution',
  var: 'VAR decision',
  var_check: 'VAR check',
  var_overturned: 'VAR overturned',
  penalty_missed: 'Penalty missed',
  injury: 'Injury',
  injury_time: 'Injury time',
  timeout: 'Timeout',
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, ' ');
}

/** Event types that must never be shown as a goal. */
export function isScoringEvent(type: string): boolean {
  return type === 'goal' || type === 'penalty_goal' || type === 'own_goal';
}

// ---------------------------------------------------------------------------
// Polling cadence
// ---------------------------------------------------------------------------

export interface PollCadenceOptions {
  /** Interval for a match that is actively being played. */
  inPlayMs?: number;
  /** Interval while a match is on a break — slower, nothing is changing. */
  breakMs?: number;
  /** Interval when nothing is in play at all. */
  idleMs?: number;
  /** How often to check whether a hidden tab became visible again. */
  hiddenCheckMs?: number;
}

export const DEFAULT_CADENCE: Required<PollCadenceOptions> = {
  inPlayMs: 15_000,
  breakMs: 45_000,
  idleMs: 60_000,
  hiddenCheckMs: 60_000,
};

/**
 * Adaptive interval.
 *
 * Polling speeds up while a match is actually being played and eases off during
 * a break, so an idle page does not keep hammering the backend.
 */
export function pollIntervalFor(
  statuses: string[],
  options: PollCadenceOptions = {},
): number {
  const cadence = { ...DEFAULT_CADENCE, ...options };
  if (statuses.length === 0) return cadence.idleMs;
  const hasInPlay = statuses.some((status) => livePhaseFor(status) === 'in_play');
  if (hasInPlay) return cadence.inPlayMs;
  return cadence.breakMs;
}

import { fetchServer, toPaginated, type PaginatedResult } from '@/lib/data-fetch';
import { isValidSlug, parsePositiveInt } from '@/lib/validation';
import { eventLabel as liveEventLabel, eventMinuteLabel, isLiveStatus as isInPlayStatus } from '@/lib/live-state';
import type { Article, Competition, Match, Player, Team, Venue } from '@/types/api';

/**
 * Matches data layer.
 *
 * Every filter is applied by the backend — the browser never downloads bulk
 * fixtures to filter locally. Listing rows come pre-enriched with the fields a
 * card renders (teams, competition, venue, minimal events) from the list
 * endpoint's `include=card` shape, so listing surfaces never fan out to the
 * heavyweight per-match details endpoint. Optional detail datasets (events,
 * lineups, team and player statistics) degrade independently.
 */

export const MATCH_PAGE_SIZE = 12;
export const MATCH_MAX_LIMIT = 24;

/** Per-state ISR tiers (seconds). Live data refreshes fastest. */
export const MATCH_REVALIDATE = {
  live: 30,
  scheduled: 60,
  finished: 300,
} as const;

export const MATCH_PHASES = ['upcoming', 'live', 'finished'] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

/** Mirrors backend MATCH_STATUSES. */
export const MATCH_STATUSES = [
  'scheduled',
  'pre_match',
  'live',
  'half_time',
  'extra_time',
  'penalty_shootout',
  'finished',
  'postponed',
  'cancelled',
  'abandoned',
  'suspended',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

const UPCOMING_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'pre_match']);

/**
 * In-play check, shared with the live surface so a `suspended` match is never
 * live on one page and not-live on another.
 */
export function isLiveStatus(status: string): boolean {
  return isInPlayStatus(status);
}

/** A fixture is "upcoming" while it has not kicked off (backend semantics). */
export function isUpcomingStatus(status: string): boolean {
  return UPCOMING_STATUSES.has(status);
}

/** True once the result is settled. */
export function isFinishedStatus(status: string): boolean {
  return status === 'finished';
}

/** Neutral wording for abandoned/cancelled/suspended fixtures. */
export function isVoidStatus(status: string): boolean {
  return status === 'postponed' || status === 'cancelled' || status === 'abandoned' || status === 'suspended';
}

export interface Season {
  id: string;
  name: string;
  competition_id: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
}

export interface MatchEventRecord {
  id: string;
  match_id: string;
  team_id: string | null;
  player_id: string | null;
  assist_player_id: string | null;
  type: string;
  minute: number | null;
  extra_minute: number | null;
  description: string | null;
}

export interface LineupPlayerRecord {
  id: string;
  lineup_id: string;
  player_id: string;
  position: string | null;
  shirt_number: number | null;
  captain: boolean | null;
  substitute: boolean | null;
  starter: boolean | null;
  minutes_played: number | null;
  player: Player | null;
}

export interface LineupRecord {
  id: string;
  match_id: string;
  team_id: string;
  formation: string | null;
  coach_name: string | null;
  players: LineupPlayerRecord[];
}

export interface TeamStatRecord {
  id: string;
  match_id: string;
  team_id: string;
  possession: number | null;
  shots: number | null;
  shots_on_target: number | null;
  corners: number | null;
  fouls: number | null;
  offsides: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  passes: number | null;
  pass_accuracy: number | null;
}

export interface PlayerStatRecord {
  id: string;
  match_id: string;
  team_id: string;
  player_id: string;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  shots_on_target: number | null;
  passes: number | null;
  pass_accuracy: number | null;
  tackles: number | null;
  interceptions: number | null;
  clearances: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  rating: number | null;
}

export interface MatchDetails {
  match: Match;
  competition: Competition | null;
  season: Season | null;
  venue: Venue | null;
  homeTeam: Team;
  awayTeam: Team;
  events: MatchEventRecord[];
  lineups: LineupRecord[];
  teamStatistics: TeamStatRecord[];
  playerStatistics: PlayerStatRecord[];
}

/** A listing row with both teams resolved. Never carries a placeholder name. */
export interface MatchListItem {
  match: Match;
  homeTeam: Team;
  awayTeam: Team;
  competition: Competition | null;
  venue: Venue | null;
}

export type MatchSide = 'home' | 'away';

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface MatchFilters {
  page: number;
  limit: number;
  phase: MatchPhase | null;
  status: MatchStatus | null;
  competition: string | null;
  team: string | null;
  from: string | null;
  to: string | null;
  sort: 'asc' | 'desc' | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function optionalSlug(value: string | undefined): string | null {
  return value && isValidSlug(value) ? value : null;
}

function optionalDate(value: string | undefined): string | null {
  return value && ISO_DATE.test(value) ? value : null;
}

/**
 * Parse and clamp listing filters. Unknown values are dropped rather than
 * passed through, so a hand-edited query can never widen the result set.
 */
export function parseMatchFilters(searchParams: Record<string, string | string[] | undefined>): MatchFilters {
  const rawPhase = firstValue(searchParams.phase);
  const phase = MATCH_PHASES.find((value) => value === rawPhase) ?? null;
  const rawStatus = firstValue(searchParams.status);
  const status = MATCH_STATUSES.find((value) => value === rawStatus) ?? null;
  const rawSort = firstValue(searchParams.sort);
  return {
    page: parsePositiveInt(searchParams.page, 1),
    limit: Math.min(parsePositiveInt(searchParams.limit, MATCH_PAGE_SIZE), MATCH_MAX_LIMIT),
    phase,
    // The backend applies phase before status, so never send both.
    status: phase ? null : status,
    competition: optionalSlug(firstValue(searchParams.competition)),
    team: optionalSlug(firstValue(searchParams.team)),
    from: optionalDate(firstValue(searchParams.from)),
    to: optionalDate(firstValue(searchParams.to)),
    sort: rawSort === 'asc' || rawSort === 'desc' ? rawSort : null,
  };
}

/** Serialize filters into a stable, human-readable query string. */
export function toQueryString(filters: MatchFilters): string {
  const params = new URLSearchParams();
  if (filters.phase) params.set('phase', filters.phase);
  if (filters.status) params.set('status', filters.status);
  if (filters.competition) params.set('competition', filters.competition);
  if (filters.team) params.set('team', filters.team);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

function revalidateFor(filters: MatchFilters): number {
  if (filters.phase === 'live' || (filters.status !== null && isLiveStatus(filters.status))) {
    return MATCH_REVALIDATE.live;
  }
  if (filters.phase === 'finished') return MATCH_REVALIDATE.finished;
  return MATCH_REVALIDATE.scheduled;
}

function tagsFor(filters: MatchFilters): string[] {
  const tags = ['matches-list'];
  if (filters.competition) tags.push(`matches:competition:${filters.competition}`);
  if (filters.team) tags.push(`matches:team:${filters.team}`);
  return tags;
}

// ---------------------------------------------------------------------------
// Response validation — the API contract is untrusted input
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asTeam(value: unknown): Team | null {
  if (!isRecord(value)) return null;
  const name = asString(value.name);
  const slug = asString(value.slug);
  if (!name || !slug) return null;
  return {
    id: asString(value.id) ?? slug,
    name,
    short_name: asString(value.short_name),
    slug,
    logo_url: asString(value.logo_url),
  };
}

function asCompetition(value: unknown): Competition | null {
  if (!isRecord(value)) return null;
  const name = asString(value.name);
  const slug = asString(value.slug);
  if (!name || !slug) return null;
  return {
    id: asString(value.id) ?? slug,
    name,
    short_name: asString(value.short_name),
    slug,
    logo_url: asString(value.logo_url),
  };
}

function asVenue(value: unknown): Venue | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  if (!id || !name) return null;
  return { id, name, city: asString(value.city), slug: asString(value.slug), capacity: asNumber(value.capacity) };
}

function asSeason(value: unknown): Season | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    competition_id: asString(value.competition_id) ?? '',
    start_date: asString(value.start_date),
    end_date: asString(value.end_date),
    is_current: asBoolean(value.is_current) ?? false,
  };
}

function asPlayer(value: unknown): Player | null {
  if (!isRecord(value)) return null;
  const displayName = asString(value.display_name);
  const slug = asString(value.slug);
  if (!displayName || !slug) return null;
  return {
    id: asString(value.id) ?? slug,
    display_name: displayName,
    slug,
    photo_url: asString(value.photo_url),
    position: asString(value.position),
  };
}

function asMatch(value: unknown): Match | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const slug = asString(value.slug);
  const scheduledAt = asString(value.scheduled_at);
  if (!id || !slug || !scheduledAt) return null;
  return {
    id,
    slug,
    scheduled_at: scheduledAt,
    status: asString(value.status) ?? 'scheduled',
    home_score: asNumber(value.home_score),
    away_score: asNumber(value.away_score),
    home_team_id: asString(value.home_team_id) ?? '',
    away_team_id: asString(value.away_team_id) ?? '',
    competition_id: asString(value.competition_id) ?? '',
    home_score_ht: asNumber(value.home_score_ht),
    away_score_ht: asNumber(value.away_score_ht),
    season_id: asString(value.season_id),
    venue_id: asString(value.venue_id),
    round: typeof value.round === 'number' ? value.round : asString(value.round),
    matchday: asNumber(value.matchday),
    referee_name: asString(value.referee_name),
    attendance: asNumber(value.attendance),
  };
}

function asEvent(value: unknown): MatchEventRecord | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  return {
    id,
    match_id: asString(value.match_id) ?? '',
    team_id: asString(value.team_id),
    player_id: asString(value.player_id),
    assist_player_id: asString(value.assist_player_id),
    type: asString(value.type) ?? 'unknown',
    minute: asNumber(value.minute),
    extra_minute: asNumber(value.extra_minute),
    description: asString(value.description),
  };
}

function asLineupPlayer(value: unknown): LineupPlayerRecord | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  return {
    id,
    lineup_id: asString(value.lineup_id) ?? '',
    player_id: asString(value.player_id) ?? '',
    position: asString(value.position),
    shirt_number: asNumber(value.shirt_number),
    captain: asBoolean(value.captain),
    substitute: asBoolean(value.substitute),
    starter: asBoolean(value.starter),
    minutes_played: asNumber(value.minutes_played),
    player: asPlayer(value.player),
  };
}

function asLineup(value: unknown): LineupRecord | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  return {
    id,
    match_id: asString(value.match_id) ?? '',
    team_id: asString(value.team_id) ?? '',
    formation: asString(value.formation),
    coach_name: asString(value.coach_name),
    players: asArray(value.players).map(asLineupPlayer).filter((row): row is LineupPlayerRecord => row !== null),
  };
}

function asTeamStat(value: unknown): TeamStatRecord | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  return {
    id,
    match_id: asString(value.match_id) ?? '',
    team_id: asString(value.team_id) ?? '',
    possession: asNumber(value.possession),
    shots: asNumber(value.shots),
    shots_on_target: asNumber(value.shots_on_target),
    corners: asNumber(value.corners),
    fouls: asNumber(value.fouls),
    offsides: asNumber(value.offsides),
    yellow_cards: asNumber(value.yellow_cards),
    red_cards: asNumber(value.red_cards),
    passes: asNumber(value.passes),
    pass_accuracy: asNumber(value.pass_accuracy),
  };
}

function asPlayerStat(value: unknown): PlayerStatRecord | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  return {
    id,
    match_id: asString(value.match_id) ?? '',
    team_id: asString(value.team_id) ?? '',
    player_id: asString(value.player_id) ?? '',
    minutes: asNumber(value.minutes),
    goals: asNumber(value.goals),
    assists: asNumber(value.assists),
    shots: asNumber(value.shots),
    shots_on_target: asNumber(value.shots_on_target),
    passes: asNumber(value.passes),
    pass_accuracy: asNumber(value.pass_accuracy),
    tackles: asNumber(value.tackles),
    interceptions: asNumber(value.interceptions),
    clearances: asNumber(value.clearances),
    yellow_cards: asNumber(value.yellow_cards),
    red_cards: asNumber(value.red_cards),
    rating: asNumber(value.rating),
  };
}

/**
 * Narrow the aggregated details payload. Both teams must resolve — a fixture
 * without two real teams cannot be rendered honestly.
 */
export function toMatchDetails(value: unknown): MatchDetails | null {
  if (!isRecord(value)) return null;
  const match = asMatch(value.match);
  const homeTeam = asTeam(value.homeTeam);
  const awayTeam = asTeam(value.awayTeam);
  if (!match || !homeTeam || !awayTeam) return null;
  return {
    match,
    homeTeam,
    awayTeam,
    competition: asCompetition(value.competition),
    season: asSeason(value.season),
    venue: asVenue(value.venue),
    events: asArray(value.events).map(asEvent).filter((row): row is MatchEventRecord => row !== null),
    lineups: asArray(value.lineups).map(asLineup).filter((row): row is LineupRecord => row !== null),
    teamStatistics: asArray(value.teamStatistics)
      .map(asTeamStat)
      .filter((row): row is TeamStatRecord => row !== null),
    playerStatistics: asArray(value.playerStatistics)
      .map(asPlayerStat)
      .filter((row): row is PlayerStatRecord => row !== null),
  };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** Narrow a card-shaped list row into a renderable MatchListItem. */
export function toMatchListItem(value: unknown): MatchListItem | null {
  if (!isRecord(value)) return null;
  const match = asMatch(value);
  const homeTeam = asTeam(value.homeTeam);
  const awayTeam = asTeam(value.awayTeam);
  if (!match || !homeTeam || !awayTeam) return null;
  return {
    match,
    homeTeam,
    awayTeam,
    competition: asCompetition(value.competition),
    venue: asVenue(value.venue),
  };
}

export function toMatchListItems(values: unknown[]): MatchListItem[] {
  return values
    .map(toMatchListItem)
    .filter((item): item is MatchListItem => item !== null);
}

export type MatchListStatus = 'ready' | 'empty' | 'error';

export interface MatchListResult extends PaginatedResult<MatchListItem> {
  status: MatchListStatus;
  filters: MatchFilters;
}

function emptyPagination(filters: MatchFilters): PaginatedResult<MatchListItem>['pagination'] {
  return { page: filters.page, limit: filters.limit, total: 0, totalPages: 0 };
}

/** Paginated match listing with backend-side filtering. */
export async function fetchMatchList(filters: MatchFilters): Promise<MatchListResult> {
  const revalidate = revalidateFor(filters);
  let page: PaginatedResult<Match>;
  try {
    const envelope = await fetchServer<unknown>('/matches', {
      page: filters.page,
      limit: filters.limit,
      params: {
        phase: filters.phase ?? undefined,
        status: filters.status ?? undefined,
        competition: filters.competition ?? undefined,
        team: filters.team ?? undefined,
        from: filters.from ?? undefined,
        to: filters.to ?? undefined,
        sort: filters.sort ?? undefined,
        include: 'card',
      },
      revalidate,
      tags: tagsFor(filters),
    });
    page = toPaginated<Match>(envelope, filters.page, filters.limit);
  } catch {
    return { status: 'error', rows: [], pagination: emptyPagination(filters), filters };
  }

  if (page.rows.length === 0) {
    return { status: 'empty', rows: [], pagination: page.pagination, filters };
  }
  const rows = toMatchListItems(page.rows);
  return { ...page, rows, status: rows.length > 0 ? 'ready' : 'error', filters };
}

/**
 * Narrow raw card-shaped rows from any list endpoint into list items.
 *
 * Rows that fail validation are dropped and a fixture without two resolvable
 * teams is never rendered.
 */
export function enrichMatchRows(values: unknown[]): MatchListItem[] {
  return toMatchListItems(values);
}

export type MatchDetailStatus = 'ready' | 'not-found' | 'error';

export interface MatchDetailResult {
  status: MatchDetailStatus;
  details: MatchDetails | null;
}

/**
 * Canonical single-match fetch. The aggregate endpoint supplies page content.
 * Uses a conservative default revalidation; the status from the details response
 * could be used for finer-grained ISR but requires an extra request we avoid.
 */
export async function fetchMatchDetail(slug: string, revalidateSeconds?: number): Promise<MatchDetailResult> {
  if (!isValidSlug(slug)) return { status: 'not-found', details: null };
  try {
    const envelope = await fetchServer<unknown>(`/matches/${slug}/details`, {
      revalidate: revalidateSeconds ?? MATCH_REVALIDATE.scheduled,
      tags: [`match-details:${slug}`],
    });
    const details = toMatchDetails(envelope.data);
    return details ? { status: 'ready', details } : { status: 'not-found', details: null };
  } catch (error: unknown) {
    const code = (error as { status?: number })?.status;
    if (code === 404) return { status: 'not-found', details: null };
    return { status: 'error', details: null };
  }
}

/** Published articles linked to this fixture. Never throws. */
export async function fetchRelatedMatchNews(slug: string, limit = 5): Promise<Article[]> {
  if (!isValidSlug(slug)) return [];
  try {
    const envelope = await fetchServer<Article[]>('/news', {
      page: 1,
      limit,
      params: { match: slug },
      revalidate: MATCH_REVALIDATE.finished,
      tags: [`match-news:${slug}`],
    });
    return asArray(envelope.data).filter((row): row is Article => isRecord(row) && asString(row.slug) !== null);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Date grouping and navigation
// ---------------------------------------------------------------------------

export const MATCH_TIME_ZONE = 'UTC';

function dateParts(iso: string, timeZone: string): { year: string; month: string; day: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
    return { year: pick('year'), month: pick('month'), day: pick('day') };
  } catch {
    return null;
  }
}

/** YYYY-MM-DD in the display zone; null for an unparseable timestamp. */
export function matchDateKey(iso: string | null | undefined, timeZone = MATCH_TIME_ZONE): string | null {
  if (!iso) return null;
  const parts = dateParts(iso, timeZone);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

/** Human label for a date key, e.g. "Sat, 2 May 2026". */
export function dateKeyLabel(dateKey: string, locale = 'en-GB'): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return dateKey;
  }
}

/** Shift a date key by whole days; null when the key is unusable. */
export function shiftDateKey(dateKey: string, days: number): string | null {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface MatchDateGroup {
  dateKey: string;
  label: string;
  items: MatchListItem[];
}

/** Group a page of fixtures into day sections, preserving kickoff order. */
export function groupMatchesByDate(items: MatchListItem[], timeZone = MATCH_TIME_ZONE): MatchDateGroup[] {
  const buckets = new Map<string, MatchListItem[]>();
  for (const item of items) {
    const key = matchDateKey(item.match.scheduled_at, timeZone) ?? 'unknown';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return Array.from(buckets.entries()).map(([dateKey, groupItems]) => ({
    dateKey,
    label: dateKey === 'unknown' ? 'Date to be confirmed' : dateKeyLabel(dateKey),
    items: groupItems,
  }));
}

// ---------------------------------------------------------------------------
// Detail presentation helpers
// ---------------------------------------------------------------------------

/** Map a raw team id to a home/away side, or null when unrecognised. */
export function resolveSide(teamId: string | null, homeTeamId: string, awayTeamId: string): MatchSide | null {
  if (!teamId) return null;
  if (teamId === homeTeamId) return 'home';
  if (teamId === awayTeamId) return 'away';
  return null;
}

export function teamForSide(details: MatchDetails, side: MatchSide | null): Team | null {
  if (side === 'home') return details.homeTeam;
  if (side === 'away') return details.awayTeam;
  return null;
}

export function eventLabel(type: string): string {
  return liveEventLabel(type);
}

/** "45+2'" / "90'" / "" when the minute is unknown. */
export function formatEventMinute(minute: number | null, extraMinute: number | null): string {
  return eventMinuteLabel(minute, extraMinute) ?? '';
}

export interface TeamStatComparison {
  label: string;
  home: number | null;
  away: number | null;
  homeShare: number | null;
  awayShare: number | null;
  suffix: string;
}

interface StatMetric {
  key: keyof Omit<TeamStatRecord, 'id' | 'match_id' | 'team_id'>;
  label: string;
  suffix: string;
}

const TEAM_STAT_METRICS: StatMetric[] = [
  { key: 'possession', label: 'Possession', suffix: '%' },
  { key: 'shots', label: 'Shots', suffix: '' },
  { key: 'shots_on_target', label: 'Shots on target', suffix: '' },
  { key: 'corners', label: 'Corners', suffix: '' },
  { key: 'fouls', label: 'Fouls', suffix: '' },
  { key: 'offsides', label: 'Offsides', suffix: '' },
  { key: 'passes', label: 'Passes', suffix: '' },
  { key: 'pass_accuracy', label: 'Pass accuracy', suffix: '%' },
  { key: 'yellow_cards', label: 'Yellow cards', suffix: '' },
  { key: 'red_cards', label: 'Red cards', suffix: '' },
];

/** Format a stat without inventing a zero for missing data. */
export function formatStatValue(value: number | null, suffix: string): string {
  return value === null ? '—' : `${value}${suffix}`;
}

/**
 * Compare the two team rows. Only percentages get a share bar; counting stats
 * are compared as-is so a bar never implies a ratio that does not exist.
 */
export function compareTeamStats(details: MatchDetails): TeamStatComparison[] {
  const home =
    details.teamStatistics.find((row) => row.team_id === details.match.home_team_id) ?? null;
  const away =
    details.teamStatistics.find((row) => row.team_id === details.match.away_team_id) ?? null;
  if (!home && !away) return [];
  return TEAM_STAT_METRICS.map(({ key, label, suffix }) => {
    const homeValue = home ? home[key] : null;
    const awayValue = away ? away[key] : null;
    const total = homeValue !== null && awayValue !== null ? homeValue + awayValue : 0;
    const isShare = suffix === '%' && total > 0;
    return {
      label,
      home: homeValue,
      away: awayValue,
      homeShare: isShare && homeValue !== null ? Math.round((homeValue / total) * 100) : null,
      awayShare: isShare && awayValue !== null ? Math.round((awayValue / total) * 100) : null,
      suffix,
    };
  });
}

/** Player index from the lineup, used to name and link player-stat rows. */
export function buildPlayerIndex(details: MatchDetails): Map<string, Player> {
  const index = new Map<string, Player>();
  for (const lineup of details.lineups) {
    for (const row of lineup.players) {
      if (row.player) index.set(row.player_id, row.player);
    }
  }
  return index;
}

export interface EnrichedPlayerStat extends PlayerStatRecord {
  player: Player | null;
  side: MatchSide | null;
}

/** Attach resolved players and sides; unresolved players keep a null player. */
export function enrichPlayerStats(details: MatchDetails): EnrichedPlayerStat[] {
  const players = buildPlayerIndex(details);
  return details.playerStatistics.map((row) => ({
    ...row,
    player: players.get(row.player_id) ?? null,
    side: resolveSide(row.team_id, details.match.home_team_id, details.match.away_team_id),
  }));
}

/** Lineups paired with their side, home first. */
export function lineupsBySide(details: MatchDetails): Array<{ side: MatchSide; lineup: LineupRecord }> {
  const result: Array<{ side: MatchSide; lineup: LineupRecord }> = [];
  const home = details.lineups.find((row) => row.team_id === details.match.home_team_id);
  const away = details.lineups.find((row) => row.team_id === details.match.away_team_id);
  if (home) result.push({ side: 'home', lineup: home });
  if (away) result.push({ side: 'away', lineup: away });
  return result;
}

/** Events in kickoff order with their side resolved. */
export function eventsBySide(details: MatchDetails): Array<{ event: MatchEventRecord; side: MatchSide | null }> {
  return [...details.events]
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || (a.extra_minute ?? 0) - (b.extra_minute ?? 0))
    .map((event) => ({ event, side: resolveSide(event.team_id, details.match.home_team_id, details.match.away_team_id) }));
}

/** Kickoff shown in both local and UTC so the reference is never ambiguous. */
export function formatKickoffBoth(iso: string, locale = 'en-GB', timeZone?: string): { local: string; utc: string } {
  const zone = timeZone ?? 'UTC';
  const format = (tz: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(date);
    } catch {
      return date.toISOString();
    }
  };
  return { local: format(zone), utc: format('UTC') };
}

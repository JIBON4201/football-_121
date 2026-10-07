import { siteConfig } from '@/config/site';
import { routeUrl } from '@/config/routes';
import { fetchServer, type PaginatedResult } from '@/lib/data-fetch';
import { isValidSlug, parsePositiveInt } from '@/lib/validation';
import type { CompetitionRecord, Season } from '@/lib/competitions';
import type { Article, PaginationMeta, Player, Team } from '@/types/api';

/**
 * Player data layer.
 *
 * Career relationships come from `player_team_history` joined to canonical
 * team and season records, competitions are reached through the seasons those
 * rows name, and every statistic is aggregated server-side. The browser never
 * sums a career and never filters a statistics set.
 */

export const PLAYER_PAGE_SIZE = 24;
export const PLAYER_STATS_ROW_LIMIT = 20;
export const PLAYER_NEWS_PAGE_SIZE = 6;

export const PLAYER_REVALIDATE = {
  list: 3600,
  detail: 600,
  statistics: 300,
  news: 300,
} as const;

/** Canonical statistic fields, in the order they are presented. */
export const PLAYER_STAT_FIELDS = [
  'minutes',
  'goals',
  'assists',
  'shots',
  'shots_on_target',
  'passes',
  'pass_accuracy',
  'tackles',
  'interceptions',
  'clearances',
  'yellow_cards',
  'red_cards',
  'rating',
] as const;

export type PlayerStatKey = (typeof PLAYER_STAT_FIELDS)[number];

export const PLAYER_STAT_LABELS: Record<PlayerStatKey, string> = {
  minutes: 'Minutes',
  goals: 'Goals',
  assists: 'Assists',
  shots: 'Shots',
  shots_on_target: 'Shots on target',
  passes: 'Passes',
  pass_accuracy: 'Pass accuracy',
  tackles: 'Tackles',
  interceptions: 'Interceptions',
  clearances: 'Clearances',
  yellow_cards: 'Yellow cards',
  red_cards: 'Red cards',
  rating: 'Rating',
};

/** Mean rather than sum, so a total would be meaningless. */
export const PLAYER_AVERAGE_FIELDS: ReadonlySet<PlayerStatKey> = new Set<PlayerStatKey>([
  'rating',
  'pass_accuracy',
]);

export type Country = { id: string; name: string; slug: string; code: string | null; flag_url: string | null };

/** The canonical player record. Optional fields are omitted, never invented. */
export interface PlayerRecord extends Player {
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  nationality_id: string | null;
  preferred_foot: string | null;
  height_cm: number | null;
  status: string | null;
  nationality?: Country | null;
}

/** One `player_team_history` row with its resolved team and season. */
export interface CareerEntry {
  id: string;
  team: Team | null;
  season: Season | null;
  shirt_number: number | null;
  joined_at: string | null;
  left_at: string | null;
  is_current: boolean;
}

export type PlayerStatsScope = 'career' | 'season' | 'competition' | 'season_competition';

export const SCOPE_LABELS: Record<PlayerStatsScope, string> = {
  career: 'All recorded appearances',
  season: 'Single season',
  competition: 'Single competition',
  season_competition: 'Single season and competition',
};

export interface PlayerTotals {
  appearances: number;
  values: Record<PlayerStatKey, number | null>;
  /** Reported by some rows but not all. */
  partial: PlayerStatKey[];
  /** Reported by no row: unavailable, and deliberately not zero. */
  unavailable: PlayerStatKey[];
  average_rating: number | null;
  ratings_reported: number;
}

export type PlayerMatchOutcome = 'win' | 'draw' | 'loss';

/** One appearance, with the fixture context needed to link and label it. */
export interface PlayerAppearance {
  match_slug: string;
  scheduled_at: string;
  match_status: string;
  team: Team | null;
  opponent: Team | null;
  competition: CompetitionRecord | null;
  season_id: string | null;
  is_home: boolean;
  outcome: PlayerMatchOutcome | null;
  stats: Record<PlayerStatKey, number | null>;
}

export type PlayerStatisticsState = 'ready' | 'empty' | 'partial';

export interface PlayerStatisticsPayload {
  player: { id: string; name: string; slug: string };
  scope: PlayerStatsScope;
  season_id: string | null;
  competition_slug: string | null;
  appearances: PlayerAppearance[];
  totals: PlayerTotals;
  state: PlayerStatisticsState;
  /** True when a bound was reached, so totals are a subset. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Validation
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

function asCountry(value: unknown): Country | null {
  if (!isRecord(value)) return null;
  const name = asString(value.name);
  if (!name) return null;
  return {
    id: asString(value.id) ?? name,
    name,
    slug: asString(value.slug) ?? name,
    code: asString(value.code),
    flag_url: asString(value.flag_url),
  };
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
    is_current: value.is_current === true,
  };
}

function asCompetition(value: unknown): CompetitionRecord | null {
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
    country_id: asString(value.country_id),
    type: asString(value.type),
    gender: asString(value.gender),
    is_active: value.is_active === true,
    country: asCountry(value.country),
  };
}

function asPlayer(value: unknown): PlayerRecord | null {
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
    first_name: asString(value.first_name),
    last_name: asString(value.last_name),
    date_of_birth: asString(value.date_of_birth),
    nationality_id: asString(value.nationality_id),
    preferred_foot: asString(value.preferred_foot),
    height_cm: asNumber(value.height_cm),
    status: asString(value.status),
    nationality: asCountry(value.nationality),
  };
}

function asCareerEntry(value: unknown): CareerEntry | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  return {
    id,
    team: asTeam(value.team),
    season: asSeason(value.season),
    shirt_number: asNumber(value.shirt_number),
    joined_at: asString(value.joined_at),
    left_at: asString(value.left_at),
    is_current: value.is_current === true,
  };
}

function asStatValue(value: unknown): number | null {
  return asNumber(value);
}

function asStatMap(value: unknown): Record<PlayerStatKey, number | null> {
  const record = isRecord(value) ? value : {};
  const stats = {} as Record<PlayerStatKey, number | null>;
  for (const field of PLAYER_STAT_FIELDS) stats[field] = asStatValue(record[field]);
  return stats;
}

function asTotals(value: unknown): PlayerTotals | null {
  if (!isRecord(value)) return null;
  const appearances = asNumber(value.appearances);
  if (appearances === null) return null;
  const keys = (list: unknown): PlayerStatKey[] =>
    Array.isArray(list)
      ? list.filter((entry): entry is PlayerStatKey =>
          PLAYER_STAT_FIELDS.includes(entry as PlayerStatKey),
        )
      : [];
  return {
    appearances,
    values: asStatMap(value.values),
    partial: keys(value.partial),
    unavailable: keys(value.unavailable),
    average_rating: asNumber(value.average_rating),
    ratings_reported: asNumber(value.ratings_reported) ?? 0,
  };
}

/** Builds a team from the flat name/slug pair the statistics API returns. */
function asFlatTeam(name: unknown, slug: unknown): Team | null {
  const teamName = asString(name);
  const teamSlug = asString(slug);
  if (!teamName || !teamSlug) return null;
  return { id: teamSlug, name: teamName, short_name: null, slug: teamSlug, logo_url: null };
}

function asFlatCompetition(name: unknown, slug: unknown): CompetitionRecord | null {
  const compName = asString(name);
  const compSlug = asString(slug);
  if (!compName || !compSlug) return null;
  return {
    id: compSlug,
    name: compName,
    short_name: null,
    slug: compSlug,
    logo_url: null,
    is_active: true,
  };
}

/**
 * The statistics API returns flat `team_name`/`team_slug` pairs rather than
 * nested records, so the team, opponent and competition are re-assembled here.
 * A name without a slug yields null — a half-identified entity is never shown
 * as if it were resolved.
 */
function asAppearance(value: unknown): PlayerAppearance | null {
  if (!isRecord(value)) return null;
  const matchSlug = asString(value.match_slug);
  const scheduledAt = asString(value.scheduled_at);
  if (!matchSlug || !scheduledAt) return null;
  const outcome = value.outcome;
  return {
    match_slug: matchSlug,
    scheduled_at: scheduledAt,
    match_status: asString(value.match_status) ?? 'scheduled',
    team: asFlatTeam(value.team_name, value.team_slug),
    opponent: asFlatTeam(value.opponent_name, value.opponent_slug),
    competition: asFlatCompetition(value.competition_name, value.competition_slug),
    season_id: asString(value.season_id),
    is_home: value.is_home === true,
    outcome: outcome === 'win' || outcome === 'draw' || outcome === 'loss' ? outcome : null,
    stats: asStatMap(value),
  };
}

/** Narrow the aggregated statistics payload. */
export function toPlayerStatistics(value: unknown): PlayerStatisticsPayload | null {
  if (!isRecord(value)) return null;
  const player = isRecord(value.player) ? value.player : null;
  const totals = asTotals(value.totals);
  const slug = player ? asString(player.slug) : null;
  if (!player || !totals || !slug) return null;
  const scope = asString(value.scope);
  const state = asString(value.state);
  return {
    player: { id: asString(player.id) ?? slug, name: asString(player.name) ?? slug, slug },
    scope: scope === 'season' || scope === 'competition' || scope === 'season_competition' ? scope : 'career',
    season_id: asString(value.season_id),
    competition_slug: asString(value.competition_slug),
    // The API field is `matches`; it is exposed here as `appearances` because
    // a row is one recorded appearance, not a fixture in general.
    appearances: Array.isArray(value.matches)
      ? value.matches.map(asAppearance).filter((row): row is PlayerAppearance => row !== null)
      : [],
    totals,
    state: state === 'ready' || state === 'empty' || state === 'partial' ? state : 'empty',
    truncated: value.truncated === true,
  };
}

/** Narrow the aggregated player detail payload. */
export function toPlayerDetails(value: unknown): {
  player: PlayerRecord;
  nationality: Country | null;
  history: CareerEntry[];
  seasons: Season[];
  competitions: CompetitionRecord[];
  articles: Article[];
} | null {
  if (!isRecord(value)) return null;
  const player = asPlayer(value.player);
  if (!player) return null;
  return {
    player,
    nationality: asCountry(value.nationality),
    history: Array.isArray(value.history)
      ? value.history.map(asCareerEntry).filter((row): row is CareerEntry => row !== null)
      : [],
    seasons: Array.isArray(value.seasons) ? value.seasons.map(asSeason).filter((row): row is Season => row !== null) : [],
    competitions: Array.isArray(value.competitions)
      ? value.competitions.map(asCompetition).filter((row): row is CompetitionRecord => row !== null)
      : [],
    articles: Array.isArray(value.articles)
      ? value.articles.filter((row): row is Article => isRecord(row) && asString(row.slug) !== null)
      : [],
  };
}

function asArticle(row: unknown): Article | null {
  if (!isRecord(row)) return null;
  const slug = asString(row.slug);
  const title = asString(row.title);
  if (!slug || !title) return null;
  return {
    id: asString(row.id) ?? slug,
    title,
    slug,
    excerpt: asString(row.excerpt),
    article_type: asString(row.article_type) ?? 'news',
    published_at: asString(row.published_at),
    is_featured: row.is_featured === true,
    is_breaking: row.is_breaking === true,
    view_count: asNumber(row.view_count) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Views and selection
// ---------------------------------------------------------------------------

export const PLAYER_VIEWS = ['overview', 'career', 'matches', 'statistics', 'news'] as const;
export type PlayerView = (typeof PLAYER_VIEWS)[number];

const VIEW_LABELS: Record<PlayerView, string> = {
  overview: 'Overview',
  career: 'Career',
  matches: 'Matches',
  statistics: 'Statistics',
  news: 'News',
};

export function viewLabel(view: PlayerView): string {
  return VIEW_LABELS[view];
}

export function parsePlayerView(raw: string | string[] | undefined): PlayerView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PLAYER_VIEWS.find((view) => view === value) ?? 'overview';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSeasonId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

export interface PlayerSelection {
  view: PlayerView;
  seasonId: string | null;
  competition: string | null;
  limit: number;
}

export function parsePlayerSelection(searchParams: Record<string, string | string[] | undefined>): PlayerSelection {
  const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
  const competition = first(searchParams.competition);
  return {
    view: parsePlayerView(searchParams.view),
    seasonId: parseSeasonId(searchParams.season),
    competition: competition && isValidSlug(competition) ? competition : null,
    limit: Math.min(parsePositiveInt(searchParams.limit, PLAYER_STATS_ROW_LIMIT), 100),
  };
}

/** Every view and filter lives on the one canonical player path. */
export function playerHref(slug: string, selection: Partial<PlayerSelection>): string {
  const params = new URLSearchParams();
  if (selection.view && selection.view !== 'overview') params.set('view', selection.view);
  if (selection.seasonId) params.set('season', selection.seasonId);
  if (selection.competition) params.set('competition', selection.competition);
  if (selection.limit && selection.limit !== PLAYER_STATS_ROW_LIMIT) params.set('limit', String(selection.limit));
  const query = params.toString();
  return `${routeUrl('playerDetail', { slug })}${query ? `?${query}` : ''}`;
}

export const PLAYERS_CANONICAL = routeUrl('players');
export const PLAYERS_CANONICAL_URL = `${siteConfig.siteUrl}${PLAYERS_CANONICAL}`;

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export type PlayerListStatus = 'ready' | 'empty' | 'error';

export interface PlayerListResult extends PaginatedResult<PlayerRecord> {
  status: PlayerListStatus;
  query: string;
}

/** Bounded, server-side player search. The full player table is never loaded. */
export async function fetchPlayerList(
  options: { page?: number; limit?: number; query?: string } = {},
): Promise<PlayerListResult> {
  const page = options.page ?? 1;
  const limit = options.limit ?? PLAYER_PAGE_SIZE;
  const query = (options.query ?? '').trim();
  try {
    const envelope = await fetchServer<unknown>('/players', {
      page,
      limit,
      params: { q: query.length > 0 ? query : undefined },
      revalidate: PLAYER_REVALIDATE.list,
      tags: ['players-list'],
    });
    const rows = (Array.isArray(envelope.data) ? envelope.data : [])
      .map(asPlayer)
      .filter((row): row is PlayerRecord => row !== null);
    const pagination: PaginationMeta = envelope.pagination ?? {
      page,
      limit,
      total: rows.length,
      totalPages: rows.length === 0 ? 0 : 1,
    };
    return { rows, pagination, status: rows.length === 0 ? 'empty' : 'ready', query };
  } catch {
    return { rows: [], pagination: { page, limit, total: 0, totalPages: 0 }, status: 'error', query };
  }
}

export type PlayerDetailStatus = 'ready' | 'not-found' | 'error';

export type PlayerDetail = NonNullable<ReturnType<typeof toPlayerDetails>>;

/** `player` is null for not-found and error outcomes, which never render a profile. */
export interface PlayerDetailResult extends Omit<PlayerDetail, 'player'> {
  player: PlayerRecord | null;
  status: PlayerDetailStatus;
}

function emptyDetail(): Omit<PlayerDetailResult, 'status'> {
  return {
    player: null,
    nationality: null,
    history: [],
    seasons: [],
    competitions: [],
    articles: [],
  };
}

/** Aggregated player profile: identity, career, competitions and coverage. */
export async function fetchPlayerDetail(slug: string): Promise<PlayerDetailResult> {
  if (!isValidSlug(slug)) return { status: 'not-found', ...emptyDetail() };
  try {
    const envelope = await fetchServer<unknown>(`/players/${slug}/details`, {
      revalidate: PLAYER_REVALIDATE.detail,
      tags: [`player-detail:${slug}`],
    });
    const details = toPlayerDetails(envelope.data);
    if (!details) return { status: 'not-found', ...emptyDetail() };
    return { status: 'ready', ...details };
  } catch (error: unknown) {
    const code = (error as { status?: number })?.status;
    if (code === 404) return { status: 'not-found', ...emptyDetail() };
    return { status: 'error', ...emptyDetail() };
  }
}

export type SectionStatus = 'ready' | 'empty' | 'error';

export interface SectionResult<T> {
  status: SectionStatus;
  items: T[];
}

/**
 * Statistics and appearances, always server-aggregated and scoped by the
 * requested season/competition. A failure is reported as unavailable.
 */
export async function fetchPlayerStatistics(
  slug: string,
  selection: PlayerSelection,
): Promise<{ status: 'ready' | 'unavailable'; payload: PlayerStatisticsPayload | null }> {
  if (!isValidSlug(slug)) return { status: 'unavailable', payload: null };
  try {
    const envelope = await fetchServer<unknown>(`/players/${slug}/statistics`, {
      params: {
        season: selection.seasonId ?? undefined,
        competition: selection.competition ?? undefined,
        limit: selection.limit,
      },
      revalidate: PLAYER_REVALIDATE.statistics,
      tags: [
        `player-statistics:${slug}`,
        ...(selection.seasonId ? [`player-statistics:${slug}:${selection.seasonId}`] : []),
        ...(selection.competition ? [`player-statistics:${slug}:${selection.competition}`] : []),
      ],
    });
    const payload = toPlayerStatistics(envelope.data);
    return payload ? { status: 'ready', payload } : { status: 'unavailable', payload: null };
  } catch {
    return { status: 'unavailable', payload: null };
  }
}

/** Published coverage linked to the player through `article_players`. */
export async function fetchPlayerNews(slug: string, limit = PLAYER_NEWS_PAGE_SIZE): Promise<SectionResult<Article>> {
  if (!isValidSlug(slug)) return { status: 'error', items: [] };
  try {
    const envelope = await fetchServer<unknown>('/news', {
      page: 1,
      limit,
      params: { player: slug },
      revalidate: PLAYER_REVALIDATE.news,
      tags: [`player-news:${slug}`],
    });
    const items = (Array.isArray(envelope.data) ? envelope.data : [])
      .map(asArticle)
      .filter((item): item is Article => item !== null);
    return { status: items.length === 0 ? 'empty' : 'ready', items };
  } catch {
    return { status: 'error', items: [] };
  }
}

// ---------------------------------------------------------------------------
// Career helpers
// ---------------------------------------------------------------------------

/**
 * Career rows ordered oldest first, with the current spell last. A row with no
 * dates is ordered last rather than guessed into a place in the timeline.
 */
export function orderCareer(history: CareerEntry[]): CareerEntry[] {
  const key = (entry: CareerEntry): string => {
    const joined = entry.joined_at ?? entry.season?.start_date ?? null;
    if (!joined) return '9999-12-31';
    const left = entry.left_at ?? entry.season?.end_date ?? null;
    return `${joined}|${left ?? joined}|${entry.is_current ? '1' : '0'}`;
  };
  return [...history].sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
}

/** The current team spell, resolved from `player_team_history`. */
export function currentTeamEntry(history: CareerEntry[]): CareerEntry | null {
  return history.find((entry) => entry.is_current && entry.team !== null) ?? null;
}

/** Competitions reached through the seasons named by the career rows. */
export function careerCompetitions(
  history: CareerEntry[],
  competitions: CompetitionRecord[],
): Array<{ competition: CompetitionRecord; seasons: Season[] }> {
  const buckets = new Map<string, Season[]>();
  for (const entry of history) {
    const season = entry.season;
    if (!season || !season.competition_id) continue;
    const bucket = buckets.get(season.competition_id);
    if (bucket) bucket.push(season);
    else buckets.set(season.competition_id, [season]);
  }
  return competitions
    .map((competition) => ({ competition, seasons: buckets.get(competition.id) ?? [] }))
    .filter((entry) => entry.seasons.length > 0)
    .sort((a, b) => a.competition.name.localeCompare(b.competition.name));
}

/** Seasons the player has a career row for, newest first. */
export function careerSeasons(history: CareerEntry[]): Season[] {
  const seen = new Map<string, Season>();
  for (const entry of history) {
    if (entry.season) seen.set(entry.season.id, entry.season);
  }
  return Array.from(seen.values()).sort((a, b) => b.name.localeCompare(a.name));
}

/** Format a stat without inventing a zero for an unreported value. */
export function formatPlayerStat(value: number | null, field: PlayerStatKey): string {
  if (value === null) return '—';
  if (PLAYER_AVERAGE_FIELDS.has(field)) return value.toFixed(field === 'rating' ? 1 : 0);
  return String(value);
}

export type { Article, CompetitionRecord, Player, Season, Team };

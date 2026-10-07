import { siteConfig } from '@/config/site';
import { routeUrl } from '@/config/routes';
import { fetchServer, type PaginatedResult } from '@/lib/data-fetch';
import { isValidSlug, parsePositiveInt } from '@/lib/validation';
import type { Article, Competition, PaginationMeta, Team } from '@/types/api';

/**
 * Competition data layer.
 *
 * Every filter and every aggregate is resolved by the backend: the standings
 * table is a server-side calculation, matches reuse the existing matches API
 * (so filtering logic is never duplicated here) and seasons come from the
 * canonical `seasons` records. Nothing is derived from incomplete client data.
 */

export const COMPETITION_PAGE_SIZE = 24;
export const COMPETITION_MATCHES_PAGE_SIZE = 12;
export const COMPETITION_NEWS_PAGE_SIZE = 6;
export const COMPETITION_TEAM_LIMIT = 60;

/** Per-surface ISR tiers (seconds). */
export const COMPETITION_REVALIDATE = {
  list: 3600,
  detail: 600,
  standings: 300,
  matches: 120,
  news: 300,
  teams: 3600,
} as const;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A season belongs to exactly one competition; switching never forks entities. */
export interface Season {
  id: string;
  competition_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
}

export interface Country {
  id: string;
  name: string;
  slug: string;
  code: string | null;
  flag_url: string | null;
}

/** The backend competition record, including its optional region. */
export interface CompetitionRecord extends Competition {
  country_id?: string | null;
  type?: string | null;
  gender?: string | null;
  is_active?: boolean;
  country?: Country | null;
}

export interface StandingRow {
  team_id: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
}

export interface StandingTeam {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  logo_url: string | null;
}

/**
 * `empty` — the competition has no results yet.
 * `incomplete` — some finished matches were missing a score.
 * `not_applicable` — the format (e.g. a cup) has no meaningful table.
 * An API failure is an error, never one of these states.
 */
export type StandingsState = 'ready' | 'empty' | 'incomplete' | 'not_applicable';

export interface StandingsPayload {
  competition: { id: string; name: string; slug: string; type: string | null };
  season: Season | null;
  teams: StandingTeam[];
  standings: {
    rows: StandingRow[];
    matches_considered: number;
    matches_skipped: number;
    rules_id: string;
    format: string;
  };
  state: StandingsState;
  total_matches: number;
  rules_id: string;
  format: string;
}

// ---------------------------------------------------------------------------
// Response validation
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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

function asTeam(value: unknown): StandingTeam | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  const slug = asString(value.slug);
  if (!id || !name || !slug) return null;
  return { id, name, short_name: asString(value.short_name), slug, logo_url: asString(value.logo_url) };
}

function asStandingRow(value: unknown): StandingRow | null {
  if (!isRecord(value)) return null;
  const teamId = asString(value.team_id);
  const position = asNumber(value.position);
  if (!teamId || position === null) return null;
  return {
    team_id: teamId,
    position,
    played: asNumber(value.played) ?? 0,
    won: asNumber(value.won) ?? 0,
    drawn: asNumber(value.drawn) ?? 0,
    lost: asNumber(value.lost) ?? 0,
    goals_for: asNumber(value.goals_for) ?? 0,
    goals_against: asNumber(value.goals_against) ?? 0,
    goal_difference: asNumber(value.goal_difference) ?? 0,
    points: asNumber(value.points) ?? 0,
  };
}

function asStandingsPayload(value: unknown): StandingsPayload | null {
  if (!isRecord(value)) return null;
  const competition = asCompetition(value.competition);
  const standings = isRecord(value.standings) ? value.standings : null;
  if (!competition || !standings) return null;
  const state = asString(value.state);
  const validStates: StandingsState[] = ['ready', 'empty', 'incomplete', 'not_applicable'];
  return {
    competition: {
      id: competition.id,
      name: competition.name,
      slug: competition.slug,
      type: competition.type ?? null,
    },
    season: asSeason(value.season),
    teams: Array.isArray(value.teams) ? value.teams.map(asTeam).filter((t): t is StandingTeam => t !== null) : [],
    standings: {
      rows: Array.isArray(standings.rows)
        ? standings.rows.map(asStandingRow).filter((row): row is StandingRow => row !== null)
        : [],
      matches_considered: asNumber(standings.matches_considered) ?? 0,
      matches_skipped: asNumber(standings.matches_skipped) ?? 0,
      rules_id: asString(standings.rules_id) ?? 'unknown',
      format: asString(standings.format) ?? 'league',
    },
    state: validStates.find((candidate) => candidate === state) ?? 'empty',
    total_matches: asNumber(value.total_matches) ?? 0,
    rules_id: asString(value.rules_id) ?? 'unknown',
    format: asString(value.format) ?? 'league',
  };
}

/** Narrow the aggregated competition detail payload. */
export function toCompetitionDetails(value: unknown): {
  competition: CompetitionRecord;
  country: Country | null;
  seasons: Season[];
  teams: StandingTeam[];
  upcomingMatches: unknown[];
  recentMatches: unknown[];
  articles: Article[];
} | null {
  if (!isRecord(value)) return null;
  const competition = asCompetition(value.competition);
  if (!competition) return null;
  const articles = Array.isArray(value.articles)
    ? value.articles.filter((row): row is Article => isRecord(row) && asString(row.slug) !== null)
    : [];
  return {
    competition,
    country: asCountry(value.country),
    seasons: Array.isArray(value.seasons) ? value.seasons.map(asSeason).filter((s): s is Season => s !== null) : [],
    teams: Array.isArray(value.teams) ? value.teams.map(asTeam).filter((t): t is StandingTeam => t !== null) : [],
    upcomingMatches: Array.isArray(value.upcomingMatches) ? value.upcomingMatches : [],
    recentMatches: Array.isArray(value.recentMatches) ? value.recentMatches : [],
    articles,
  };
}

// ---------------------------------------------------------------------------
// Views and season resolution
// ---------------------------------------------------------------------------

export const COMPETITION_VIEWS = ['overview', 'matches', 'standings', 'teams', 'news'] as const;
export type CompetitionView = (typeof COMPETITION_VIEWS)[number];

const VIEW_LABELS: Record<CompetitionView, string> = {
  overview: 'Overview',
  matches: 'Matches',
  standings: 'Standings',
  teams: 'Teams',
  news: 'News',
};

export function viewLabel(view: CompetitionView): string {
  return VIEW_LABELS[view];
}

/** Unknown view values fall back to the overview rather than 404-ing. */
export function parseCompetitionView(raw: string | string[] | undefined): CompetitionView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return COMPETITION_VIEWS.find((view) => view === value) ?? 'overview';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A season is addressable by uuid only; anything else is ignored. */
export function parseSeasonId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

export interface CompetitionSelection {
  view: CompetitionView;
  /** Null means "the competition's current season". */
  seasonId: string | null;
  page: number;
  /** Optional match filters, passed straight through to the matches API. */
  status: string | null;
  team: string | null;
  from: string | null;
  to: string | null;
}

export function parseCompetitionSelection(searchParams: Record<string, string | string[] | undefined>): CompetitionSelection {
  const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const team = first(searchParams.team);
  return {
    view: parseCompetitionView(searchParams.view),
    seasonId: parseSeasonId(searchParams.season),
    page: parsePositiveInt(searchParams.page, 1),
    status: asString(first(searchParams.status)),
    team: team && isValidSlug(team) ? team : null,
    from: isoDate.test(first(searchParams.from) ?? '') ? (first(searchParams.from) as string) : null,
    to: isoDate.test(first(searchParams.to) ?? '') ? (first(searchParams.to) as string) : null,
  };
}

/**
 * Season and view links always target the same canonical competition URL.
 * Only the query string varies, so a season can never fork the entity or
 * produce a competing canonical path.
 */
export function competitionHref(slug: string, selection: Partial<CompetitionSelection>): string {
  const params = new URLSearchParams();
  if (selection.view && selection.view !== 'overview') params.set('view', selection.view);
  if (selection.seasonId) params.set('season', selection.seasonId);
  if (selection.status) params.set('status', selection.status);
  if (selection.team) params.set('team', selection.team);
  if (selection.from) params.set('from', selection.from);
  if (selection.to) params.set('to', selection.to);
  if (selection.page && selection.page > 1) params.set('page', String(selection.page));
  const query = params.toString();
  return `${routeUrl('competitionDetail', { slug })}${query ? `?${query}` : ''}`;
}

export const COMPETITION_CANONICAL = routeUrl('competitions');
export const COMPETITION_CANONICAL_URL = `${siteConfig.siteUrl}${COMPETITION_CANONICAL}`;

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export type CompetitionListStatus = 'ready' | 'empty' | 'error';

export interface CompetitionListResult extends PaginatedResult<CompetitionRecord> {
  status: CompetitionListStatus;
}

/** Active competitions, ordered by name. Popularity ranking is a later step. */
export async function fetchCompetitionList(options: { page?: number; limit?: number } = {}): Promise<CompetitionListResult> {
  const page = options.page ?? 1;
  const limit = options.limit ?? COMPETITION_PAGE_SIZE;
  try {
    const envelope = await fetchServer<unknown>('/competitions', {
      page,
      limit,
      params: { active: true },
      revalidate: COMPETITION_REVALIDATE.list,
      tags: ['competitions-list'],
    });
    const rows = (Array.isArray(envelope.data) ? envelope.data : [])
      .map(asCompetition)
      .filter((row): row is CompetitionRecord => row !== null);
    const pagination: PaginationMeta = envelope.pagination ?? {
      page,
      limit,
      total: rows.length,
      totalPages: rows.length === 0 ? 0 : 1,
    };
    return { rows, pagination, status: rows.length === 0 ? 'empty' : 'ready' };
  } catch {
    return {
      rows: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
      status: 'error',
    };
  }
}

export type CompetitionDetailStatus = 'ready' | 'not-found' | 'error';

export interface CompetitionDetailResult {
  status: CompetitionDetailStatus;
  competition: CompetitionRecord | null;
  country: Country | null;
  seasons: Season[];
  teams: StandingTeam[];
  upcomingMatches: unknown[];
  recentMatches: unknown[];
  articles: Article[];
  /** Resolved season for the current request; null when none was asked for. */
  season: Season | null;
}

function emptyDetail(): Omit<CompetitionDetailResult, 'status'> {
  return {
    competition: null,
    country: null,
    seasons: [],
    teams: [],
    upcomingMatches: [],
    recentMatches: [],
    articles: [],
    season: null,
  };
}

/**
 * Competition detail. Seasons always come from the canonical records so the
 * selector can offer history without creating duplicate competition entities.
 */
export async function fetchCompetitionDetail(
  slug: string,
  seasonId: string | null = null,
): Promise<CompetitionDetailResult> {
  if (!isValidSlug(slug)) return { status: 'not-found', ...emptyDetail() };
  try {
    const envelope = await fetchServer<unknown>(`/competitions/${slug}/details`, {
      revalidate: COMPETITION_REVALIDATE.detail,
      tags: [`competition-detail:${slug}`],
    });
    const details = toCompetitionDetails(envelope.data);
    if (!details) return { status: 'not-found', ...emptyDetail() };
    return {
      status: 'ready',
      ...details,
      season: seasonId ? (details.seasons.find((season) => season.id === seasonId) ?? null) : null,
    };
  } catch (error: unknown) {
    const code = (error as { status?: number })?.status;
    if (code === 404) return { status: 'not-found', ...emptyDetail() };
    return { status: 'error', ...emptyDetail() };
  }
}

/** Newest season first, so the current one leads the selector. */
export function orderSeasons(seasons: Season[]): Season[] {
  return [...seasons].sort((a, b) => {
    if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
    const left = a.start_date ?? '';
    const right = b.start_date ?? '';
    if (left !== right) return right.localeCompare(left);
    return b.name.localeCompare(a.name);
  });
}

/** The season a request resolves to: explicit id, else the current season. */
export function resolveSeason(seasons: Season[], seasonId: string | null): Season | null {
  if (seasonId) return seasons.find((season) => season.id === seasonId) ?? null;
  return seasons.find((season) => season.is_current) ?? null;
}

export type StandingsStatus = 'ready' | 'unavailable';

export interface StandingsResult {
  status: StandingsStatus;
  payload: StandingsPayload | null;
  /** Teams keyed by id so a row can always resolve a name and slug. */
  teamsById: Map<string, StandingTeam>;
}

/** Standings are always server-calculated; a failure is reported as such. */
export async function fetchStandings(slug: string, seasonId: string | null): Promise<StandingsResult> {
  if (!isValidSlug(slug)) return { status: 'unavailable', payload: null, teamsById: new Map() };
  try {
    const envelope = await fetchServer<unknown>(`/competitions/${slug}/standings`, {
      params: { season: seasonId ?? undefined },
      revalidate: COMPETITION_REVALIDATE.standings,
      tags: [`competition-standings:${slug}`, ...(seasonId ? [`competition-standings:${slug}:${seasonId}`] : [])],
    });
    const payload = asStandingsPayload(envelope.data);
    if (!payload) return { status: 'unavailable', payload: null, teamsById: new Map() };
    return {
      status: 'ready',
      payload,
      teamsById: new Map(payload.teams.map((team) => [team.id, team])),
    };
  } catch {
    return { status: 'unavailable', payload: null, teamsById: new Map() };
  }
}

export type SectionStatus = 'ready' | 'empty' | 'error';

export interface SectionResult<T> {
  status: SectionStatus;
  items: T[];
  pagination?: PaginationMeta;
}

async function fetchCompetitionSection<T>(
  path: string,
  validate: (row: unknown) => T | null,
  options: { params?: Record<string, string | number | undefined>; limit: number; revalidate: number; tag: string; page?: number },
): Promise<SectionResult<T>> {
  try {
    const envelope = await fetchServer<unknown>(path, {
      page: options.page ?? 1,
      limit: options.limit,
      params: options.params,
      revalidate: options.revalidate,
      tags: [options.tag],
    });
    const items = (Array.isArray(envelope.data) ? envelope.data : [])
      .map(validate)
      .filter((item): item is T => item !== null);
    return {
      status: items.length === 0 ? 'empty' : 'ready',
      items,
      ...(envelope.pagination ? { pagination: envelope.pagination } : {}),
    };
  } catch {
    return { status: 'error', items: [] };
  }
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

/**
 * Competition matches. Filtering is delegated to the existing matches API —
 * this layer only decides which query to send.
 */
export function fetchCompetitionMatches(
  slug: string,
  selection: CompetitionSelection,
  limit = COMPETITION_MATCHES_PAGE_SIZE,
): Promise<SectionResult<unknown>> {
  return fetchCompetitionSection<unknown>(
    '/matches',
    (row) => (isRecord(row) ? row : null),
    {
      params: {
        competition: slug,
        season: selection.seasonId ?? undefined,
        status: selection.status ?? undefined,
        team: selection.team ?? undefined,
        from: selection.from ?? undefined,
        to: selection.to ?? undefined,
      },
      limit,
      revalidate: COMPETITION_REVALIDATE.matches,
      tag: `competition-matches:${slug}`,
      page: selection.page,
    },
  );
}

/** Published coverage linked to this competition through canonical relations. */
export function fetchCompetitionNews(
  slug: string,
  limit = COMPETITION_NEWS_PAGE_SIZE,
): Promise<SectionResult<Article>> {
  return fetchCompetitionSection<Article>(
    '/news',
    asArticle,
    {
      params: { competition: slug },
      limit,
      revalidate: COMPETITION_REVALIDATE.news,
      tag: `competition-news:${slug}`,
    },
  );
}

/**
 * Participating teams for a season. The canonical `team_competitions` link is
 * the only source of participation; a team is never inferred from a fixture.
 */
export async function fetchCompetitionTeams(
  slug: string,
  teams: StandingTeam[],
  seasonId: string | null,
): Promise<SectionResult<StandingTeam>> {
  if (teams.length === 0) {
    // Fall back to the standings payload, which is season-scoped too.
    const standings = await fetchStandings(slug, seasonId);
    const items = standings.payload?.teams ?? [];
    return { status: items.length === 0 ? 'empty' : 'ready', items };
  }
  return { status: teams.length === 0 ? 'empty' : 'ready', items: teams.slice(0, COMPETITION_TEAM_LIMIT) };
}

export type { Team, Competition, Article, PaginationMeta };
export { asStringArray };

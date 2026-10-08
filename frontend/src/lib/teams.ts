import { siteConfig } from '@/config/site';
import { routeUrl } from '@/config/routes';
import { fetchServer, type PaginatedResult } from '@/lib/data-fetch';
import { isValidSlug, parsePositiveInt } from '@/lib/validation';
import { parseCompetitionView, type CompetitionRecord, type Season } from '@/lib/competitions';
import { enrichMatchRows, type MatchListItem } from '@/lib/matches';
import type { Article, Competition, PaginationMeta, Player, Team, Venue } from '@/types/api';

/**
 * Team data layer.
 *
 * The squad comes from `player_team_history` joined to canonical player
 * records, statistics and form come from the backend calculation, and match
 * filtering reuses the existing matches API — no filtering or aggregation logic
 * is duplicated here. Player records are never copied or reshaped beyond the
 * fields the public contract exposes.
 */

export const TEAM_PAGE_SIZE = 24;
export const TEAM_MATCHES_PAGE_SIZE = 12;
export const TEAM_NEWS_PAGE_SIZE = 6;
export const SQUAD_PREVIEW_LIMIT = 8;

export const TEAM_REVALIDATE = {
  list: 3600,
  detail: 600,
  statistics: 300,
  matches: 120,
  news: 300,
} as const;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface Country {
  id: string;
  name: string;
  slug: string;
  code: string | null;
  flag_url: string | null;
}

/** The canonical team record, including the optional region and venue links. */
export interface TeamRecord extends Team {
  founded_year: number | null;
  venue_id: string | null;
  website_url: string | null;
  is_active: boolean;
  country_id: string | null;
  country?: Country | null;
}

export interface VenueRecord extends Venue {
  slug?: string | null;
  image_url?: string | null;
  capacity?: number | null;
}

/**
 * One squad entry: the canonical team-membership row plus the player record it
 * resolves to. The link row is what makes shirt number and captain status
 * possible; the player record is never duplicated.
 */
export interface SquadPlayer {
  player: Player | null;
  shirt_number: number | null;
  captain: boolean;
  is_current: boolean;
  season_id: string | null;
}

/** A `team_competitions` row: the canonical participation relationship. */
export interface ParticipationLink {
  competition_id: string;
  season_id: string;
}

export type TeamOutcome = 'win' | 'draw' | 'loss';

export interface TeamFormResult {
  outcome: TeamOutcome;
  goals_for: number;
  goals_against: number;
  opponent_id: string | null;
  scheduled_at: string;
}

export interface TeamTotals {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  clean_sheets: number;
}

export type TeamStatisticsState = 'ready' | 'empty' | 'incomplete';

export interface TeamStatisticsPayload {
  team: { id: string; name: string; slug: string };
  season_id: string | null;
  totals: TeamTotals;
  form: TeamFormResult[];
  matches_considered: number;
  matches_skipped: number;
  state: TeamStatisticsState;
}

/** A competition the team takes part in, with the season it participates in. */
export interface TeamCompetitionEntry {
  competition: Competition;
  seasons: Season[];
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

function asTeam(value: unknown): TeamRecord | null {
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
    founded_year: asNumber(value.founded_year),
    venue_id: asString(value.venue_id),
    // External URL: validated at render time, never rendered raw.
    website_url: asString(value.website_url),
    is_active: value.is_active === true,
    country_id: asString(value.country_id),
    country: asCountry(value.country),
  };
}

function asVenue(value: unknown): VenueRecord | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    city: asString(value.city),
    slug: asString(value.slug),
    capacity: asNumber(value.capacity),
    image_url: asString(value.image_url),
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

function asOutcome(value: unknown): TeamOutcome | null {
  return value === 'win' || value === 'draw' || value === 'loss' ? value : null;
}

function asTeamTotals(value: unknown): TeamTotals | null {
  if (!isRecord(value)) return null;
  const played = asNumber(value.played);
  if (played === null) return null;
  return {
    played,
    won: asNumber(value.won) ?? 0,
    drawn: asNumber(value.drawn) ?? 0,
    lost: asNumber(value.lost) ?? 0,
    goals_for: asNumber(value.goals_for) ?? 0,
    goals_against: asNumber(value.goals_against) ?? 0,
    goal_difference: asNumber(value.goal_difference) ?? 0,
    clean_sheets: asNumber(value.clean_sheets) ?? 0,
  };
}

/** Narrow the aggregated statistics payload. */
export function toTeamStatistics(value: unknown): TeamStatisticsPayload | null {
  if (!isRecord(value)) return null;
  const team = isRecord(value.team) ? value.team : null;
  const totals = asTeamTotals(value.totals);
  const slug = team ? asString(team.slug) : null;
  if (!team || !totals || !slug) return null;
  const state = asString(value.state);
  return {
    team: { id: asString(team.id) ?? slug, name: asString(team.name) ?? slug, slug },
    season_id: asString(value.season_id),
    totals,
    form: Array.isArray(value.form)
      ? value.form
          .map((entry): TeamFormResult | null => {
            if (!isRecord(entry)) return null;
            const outcome = asOutcome(entry.outcome);
            const goalsFor = asNumber(entry.goals_for);
            const goalsAgainst = asNumber(entry.goals_against);
            const scheduledAt = asString(entry.scheduled_at);
            if (!outcome || goalsFor === null || goalsAgainst === null || !scheduledAt) return null;
            return {
              outcome,
              goals_for: goalsFor,
              goals_against: goalsAgainst,
              opponent_id: asString(entry.opponent_id),
              scheduled_at: scheduledAt,
            };
          })
          .filter((entry): entry is TeamFormResult => entry !== null)
      : [],
    matches_considered: asNumber(value.matches_considered) ?? 0,
    matches_skipped: asNumber(value.matches_skipped) ?? 0,
    state: state === 'ready' || state === 'empty' || state === 'incomplete' ? state : 'empty',
  };
}

/** Narrow the aggregated team detail payload. */
export function toTeamDetails(value: unknown): {
  team: TeamRecord;
  country: Country | null;
  venue: VenueRecord | null;
  competitions: CompetitionRecord[];
  seasons: Season[];
  upcomingMatches: unknown[];
  recentMatches: unknown[];
  articles: Article[];
  squad: SquadPlayer[];
  participation: ParticipationLink[];
} | null {
  if (!isRecord(value)) return null;
  const team = asTeam(value.team);
  if (!team) return null;
  return {
    team,
    country: asCountry(value.country),
    venue: asVenue(value.venue),
    competitions: Array.isArray(value.competitions)
      ? value.competitions.map(asCompetition).filter((c): c is CompetitionRecord => c !== null)
      : [],
    seasons: Array.isArray(value.seasons) ? value.seasons.map(asSeason).filter((s): s is Season => s !== null) : [],
    upcomingMatches: Array.isArray(value.upcomingMatches) ? value.upcomingMatches : [],
    recentMatches: Array.isArray(value.recentMatches) ? value.recentMatches : [],
    articles: Array.isArray(value.articles)
      ? value.articles.map(asArticle).filter((a): a is Article => a !== null)
      : [],
    squad: Array.isArray(value.squad)
      ? value.squad
          .map((row): SquadPlayer | null => {
            if (!isRecord(row)) return null;
            return {
              player: asPlayer(row.player),
              shirt_number: asNumber(row.shirt_number),
              // `player_team_history` has no captain column today, so this stays
              // false unless the API starts supplying it. It is never inferred.
              captain: row.captain === true,
              is_current: row.is_current === true,
              season_id: asString(row.season_id),
            };
          })
          .filter((row): row is SquadPlayer => row !== null)
      : [],
    participation: Array.isArray(value.participation)
      ? value.participation
          .map((row): ParticipationLink | null => {
            if (!isRecord(row)) return null;
            const competitionId = asString(row.competition_id);
            const seasonId = asString(row.season_id);
            if (!competitionId || !seasonId) return null;
            return { competition_id: competitionId, season_id: seasonId };
          })
          .filter((row): row is ParticipationLink => row !== null)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Views and selection
// ---------------------------------------------------------------------------

export const TEAM_VIEWS = ['overview', 'matches', 'squad', 'competitions', 'news'] as const;
export type TeamView = (typeof TEAM_VIEWS)[number];

const VIEW_LABELS: Record<TeamView, string> = {
  overview: 'Overview',
  matches: 'Matches',
  squad: 'Squad',
  competitions: 'Competitions',
  news: 'News',
};

export function viewLabel(view: TeamView): string {
  return VIEW_LABELS[view];
}

export function parseTeamView(raw: string | string[] | undefined): TeamView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return TEAM_VIEWS.find((view) => view === value) ?? 'overview';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSeasonId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

/** Fixture window: 'upcoming' | 'results' | 'all'. */
export type MatchWindow = 'upcoming' | 'results' | 'all';

export interface TeamSelection {
  view: TeamView;
  seasonId: string | null;
  page: number;
  window: MatchWindow;
  competition: string | null;
  from: string | null;
  to: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseMatchWindow(raw: string | string[] | undefined): MatchWindow {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'upcoming' || value === 'results' ? value : 'all';
}

export function parseTeamSelection(searchParams: Record<string, string | string[] | undefined>): TeamSelection {
  const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
  const competition = first(searchParams.competition);
  return {
    view: parseTeamView(searchParams.view),
    seasonId: parseSeasonId(searchParams.season),
    page: parsePositiveInt(searchParams.page, 1),
    window: parseMatchWindow(searchParams.window),
    competition: competition && isValidSlug(competition) ? competition : null,
    from: ISO_DATE.test(first(searchParams.from) ?? '') ? (first(searchParams.from) as string) : null,
    to: ISO_DATE.test(first(searchParams.to) ?? '') ? (first(searchParams.to) as string) : null,
  };
}

/** Every view and filter lives on the one canonical team path. */
export function teamHref(slug: string, selection: Partial<TeamSelection>): string {
  const params = new URLSearchParams();
  if (selection.view && selection.view !== 'overview') params.set('view', selection.view);
  if (selection.seasonId) params.set('season', selection.seasonId);
  if (selection.window && selection.window !== 'all') params.set('window', selection.window);
  if (selection.competition) params.set('competition', selection.competition);
  if (selection.from) params.set('from', selection.from);
  if (selection.to) params.set('to', selection.to);
  if (selection.page && selection.page > 1) params.set('page', String(selection.page));
  const query = params.toString();
  return `${routeUrl('teamDetail', { slug })}${query ? `?${query}` : ''}`;
}

export const TEAMS_CANONICAL = routeUrl('teams');
export const TEAMS_CANONICAL_URL = `${siteConfig.siteUrl}${TEAMS_CANONICAL}`;

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export type TeamListStatus = 'ready' | 'empty' | 'error';

export interface TeamListResult extends PaginatedResult<TeamRecord> {
  status: TeamListStatus;
  /** The submitted search term, echoed for the form. */
  query: string;
}

/** Bounded, server-side team search. The full team table is never downloaded. */
export async function fetchTeamList(options: { page?: number; limit?: number; query?: string } = {}): Promise<TeamListResult> {
  const page = options.page ?? 1;
  const limit = options.limit ?? TEAM_PAGE_SIZE;
  const query = (options.query ?? '').trim();
  try {
    const envelope = await fetchServer<unknown>('/teams', {
      page,
      limit,
      params: { active: true, q: query.length > 0 ? query : undefined },
      revalidate: TEAM_REVALIDATE.list,
      tags: ['teams-list'],
    });
    const rows = (Array.isArray(envelope.data) ? envelope.data : [])
      .map(asTeam)
      .filter((row): row is TeamRecord => row !== null);
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

export type TeamDetailStatus = 'ready' | 'not-found' | 'error';

export type TeamDetail = NonNullable<ReturnType<typeof toTeamDetails>>;

/** `team` is null for not-found and error outcomes, which never render a profile. */
export interface TeamDetailResult extends Omit<TeamDetail, 'team'> {
  team: TeamRecord | null;
  status: TeamDetailStatus;
}

function emptyDetail(): Omit<TeamDetailResult, 'status'> {
  return {
    team: null,
    country: null,
    venue: null,
    competitions: [],
    seasons: [],
    upcomingMatches: [],
    recentMatches: [],
    articles: [],
    squad: [],
    participation: [],
  };
}

/** Aggregated team profile: identity, squad, competitions, fixtures, news. */
export async function fetchTeamDetail(slug: string): Promise<TeamDetailResult> {
  if (!isValidSlug(slug)) return { status: 'not-found', ...emptyDetail() };
  try {
    const envelope = await fetchServer<unknown>(`/teams/${slug}/details`, {
      revalidate: TEAM_REVALIDATE.detail,
      tags: [`team-detail:${slug}`],
    });
    const details = toTeamDetails(envelope.data);
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
  pagination?: PaginationMeta;
}

/**
 * Statistics and recent form, always server-calculated. A failure is reported
 * as unavailable rather than as an all-zero record.
 */
export async function fetchTeamStatistics(
  slug: string,
  seasonId: string | null,
  formLimit = 5,
): Promise<{ status: 'ready' | 'unavailable'; payload: TeamStatisticsPayload | null }> {
  if (!isValidSlug(slug)) return { status: 'unavailable', payload: null };
  try {
    const envelope = await fetchServer<unknown>(`/teams/${slug}/statistics`, {
      params: { season: seasonId ?? undefined, form: formLimit },
      revalidate: TEAM_REVALIDATE.statistics,
      tags: [`team-statistics:${slug}`, ...(seasonId ? [`team-statistics:${slug}:${seasonId}`] : [])],
    });
    const payload = toTeamStatistics(envelope.data);
    return payload ? { status: 'ready', payload } : { status: 'unavailable', payload: null };
  } catch {
    return { status: 'unavailable', payload: null };
  }
}

/**
 * Team fixtures or results. Filtering is delegated to the existing matches
 * API — this layer only chooses the query.
 */
export async function fetchTeamMatches(
  slug: string,
  selection: TeamSelection,
  limit = TEAM_MATCHES_PAGE_SIZE,
): Promise<SectionResult<MatchListItem>> {
  if (!isValidSlug(slug)) return { status: 'error', items: [] };
  const phase = selection.window === 'upcoming' ? 'upcoming' : selection.window === 'results' ? 'finished' : null;
  try {
    const envelope = await fetchServer<unknown>('/matches', {
      page: selection.page,
      limit,
      params: {
        team: slug,
        phase: phase ?? undefined,
        competition: selection.competition ?? undefined,
        season: selection.seasonId ?? undefined,
        from: selection.from ?? undefined,
        to: selection.to ?? undefined,
        // Results read newest-first; fixtures read soonest-first.
        sort: selection.window === 'results' ? 'desc' : selection.window === 'upcoming' ? 'asc' : undefined,
        include: 'card',
      },
      revalidate: TEAM_REVALIDATE.matches,
      tags: [`team-matches:${slug}`],
    });
    const items = enrichMatchRows(Array.isArray(envelope.data) ? envelope.data : []);
    return {
      status: items.length === 0 ? 'empty' : 'ready',
      items,
      ...(envelope.pagination ? { pagination: envelope.pagination } : {}),
    };
  } catch {
    return { status: 'error', items: [] };
  }
}

/** Published coverage linked to this team through `article_teams`. */
export async function fetchTeamNews(slug: string, limit = TEAM_NEWS_PAGE_SIZE): Promise<SectionResult<Article>> {
  if (!isValidSlug(slug)) return { status: 'error', items: [] };
  try {
    const envelope = await fetchServer<unknown>('/news', {
      page: 1,
      limit,
      params: { team: slug },
      revalidate: TEAM_REVALIDATE.news,
      tags: [`team-news:${slug}`],
    });
    const items = (Array.isArray(envelope.data) ? envelope.data : [])
      .map(asArticle)
      .filter((item): item is Article => item !== null);
    return {
      status: items.length === 0 ? 'empty' : 'ready',
      items,
      ...(envelope.pagination ? { pagination: envelope.pagination } : {}),
    };
  } catch {
    return { status: 'error', items: [] };
  }
}

// ---------------------------------------------------------------------------
// Squad grouping
// ---------------------------------------------------------------------------

export type SquadGroupKey = 'goalkeepers' | 'defenders' | 'midfielders' | 'forwards' | 'unknown';

export const SQUAD_GROUPS: Array<{ key: SquadGroupKey; label: string }> = [
  { key: 'goalkeepers', label: 'Goalkeepers' },
  { key: 'defenders', label: 'Defenders' },
  { key: 'midfielders', label: 'Midfielders' },
  { key: 'forwards', label: 'Forwards' },
  { key: 'unknown', label: 'Other / unknown' },
];

/**
 * Map a canonical position onto a squad group. An absent or unrecognised
 * position lands in 'unknown' — a position is never guessed.
 */
export function squadGroupFor(position: string | null | undefined): SquadGroupKey {
  const value = (position ?? '').trim().toLowerCase();
  if (!value) return 'unknown';
  if (/(^|\b)(goalkeeper|keeper|gk|goalkeeping)(\b|$)/.test(value)) return 'goalkeepers';
  if (/(^|\b)(defender|back|centre[- ]?back|center[- ]?back|full[- ]?back|wing[- ]?back|defence|defense)(\b|$)/.test(value)) {
    return 'defenders';
  }
  if (/(^|\b)(midfielder|central mid|defensive mid|attacking mid|winger|wide mid|playmaker)(\b|$)/.test(value)) {
    return 'midfielders';
  }
  if (/(^|\b)(forward|striker|centre[- ]?forward|center[- ]?forward|second striker)(\b|$)/.test(value)) {
    return 'forwards';
  }
  return 'unknown';
}

export interface SquadGroup {
  key: SquadGroupKey;
  label: string;
  players: SquadPlayer[];
}

/**
 * Group the squad into the four standard units plus an explicit unknown bucket.
 * Groups with no players are omitted rather than rendered empty.
 */
export function groupSquad(squad: SquadPlayer[], currentOnly = true): SquadGroup[] {
  const eligible = currentOnly ? squad.filter((row) => row.is_current) : squad;
  const buckets = new Map<SquadGroupKey, SquadPlayer[]>();
  for (const row of eligible) {
    const player = row.player;
    if (!player) continue;
    const key = squadGroupFor(player.position);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  return SQUAD_GROUPS.filter((group) => (buckets.get(group.key)?.length ?? 0) > 0).map((group) => ({
    ...group,
    players: [...(buckets.get(group.key) ?? [])].sort(byShirtNumber),
  }));
}

/** Shirt number first (unknown numbers last), then alphabetical. */
function byShirtNumber(a: SquadPlayer, b: SquadPlayer): number {
  const left = a.shirt_number;
  const right = b.shirt_number;
  if (left !== null && right !== null && left !== right) return left - right;
  if (left !== null && right === null) return -1;
  if (left === null && right !== null) return 1;
  return (a.player?.display_name ?? '').localeCompare(b.player?.display_name ?? '');
}

/** Squad entries whose player record could not be resolved. */
export function unresolvedSquad(squad: SquadPlayer[]): number {
  return squad.filter((row) => row.player === null).length;
}

// ---------------------------------------------------------------------------
// Team competitions
// ---------------------------------------------------------------------------

/**
 * Competitions the team participates in, each carrying the seasons it plays in.
 * Participation comes from the canonical competition/season relation only.
 */
export function buildTeamCompetitions(
  competitions: CompetitionRecord[],
  seasons: Season[],
  participation: ParticipationLink[],
): TeamCompetitionEntry[] {
  const byCompetition = new Map<string, Season[]>();
  for (const link of participation) {
    const season = seasons.find((candidate) => candidate.id === link.season_id);
    if (!season) continue;
    const bucket = byCompetition.get(season.competition_id);
    if (bucket) bucket.push(season);
    else byCompetition.set(season.competition_id, [season]);
  }
  return competitions
    .map((competition) => ({ competition, seasons: byCompetition.get(competition.id) ?? [] }))
    .sort((a, b) => a.competition.name.localeCompare(b.competition.name));
}

export type { Competition, Player, Team, Venue, Article };
export { parseCompetitionView };

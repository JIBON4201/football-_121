import { badRequest, notFound, upstream } from '../lib/errors';
import { log } from '../lib/logger';
import { isSettledStatus, rankAggregates, type HeadToHead, type StandingsResult } from '../lib/standings';
import { standingsRulesFor, supportsTable } from '../lib/standings-rules';
import { anonClient, type DbClient } from '../lib/supabase';
import { SEASON_COLUMNS, TEAM_COLUMNS, listByIds, maybeById } from './related';
/**
 * Standings data access. Every value is derived from canonical rows (matches,
 * seasons, teams, team_competitions) — no standings table exists yet and no
 * figure is invented client-side.
 *
 * Query count is fixed: competition -> season -> [aggregated matches, participating
 * teams, team records] -> calculate. No per-team queries.
 *
 * Aggregation is performed in PostgreSQL using a single query that filters
 * finished matches with valid scores and aggregates per team, avoiding
 * fetching thousands of rows for JavaScript-side processing.
 */

const STANDINGS_MATCH_COLUMNS =
  'id,season_id,home_team_id,away_team_id,scheduled_at,status,home_score,away_score';

/** Bounds so a competition with a huge history cannot be pulled wholesale. */
export const MAX_STANDINGS_MATCHES = 5000;
export const MAX_STANDINGS_TEAMS = 5000;

export interface StandingsTeam {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  logo_url: string | null;
}

export interface StandingsSeason {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
}

export interface StandingsPayload {
  competition: { id: string; name: string; slug: string; type: string | null };
  season: StandingsSeason | null;
  teams: StandingsTeam[];
  standings: StandingsResult;
  /** 'ready' | 'empty' (no results yet) | 'incomplete' (partial results). */
  state: 'ready' | 'empty' | 'incomplete' | 'not_applicable';
  total_matches: number;
  rules_id: string;
  format: string;
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function loadCompetition(client: DbClient, slug: string) {
  const { data, error } = await client
    .from('competitions')
    .select('id,name,slug,type')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw upstream('Failed to load competition');
  if (!data) throw notFound('Competition');
  return data as { id: string; name: string; slug: string; type: string | null };
}

/**
 * Resolve the requested season, defaulting to the current one.
 *
 * An explicitly requested season that does not belong to this competition is
 * rejected rather than silently replaced with the current season: serving a
 * different table than the URL asked for is worse than a clear error.
 */
async function loadSeason(
  client: DbClient,
  competitionId: string,
  seasonId: string | null,
): Promise<StandingsSeason | null> {
  if (seasonId) {
    const row = await maybeById(client, 'seasons', SEASON_COLUMNS, seasonId);
    if (!row || String(row.competition_id) !== competitionId) {
      throw badRequest('Season does not belong to this competition');
    }
    return {
      id: String(row.id),
      name: String(row.name),
      start_date: (row.start_date as string | null) ?? null,
      end_date: (row.end_date as string | null) ?? null,
      is_current: row.is_current === true,
    };
  }
  const { data, error } = await client
    .from('seasons')
    .select('id,name,start_date,end_date,is_current')
    .eq('competition_id', competitionId)
    .eq('is_current', true)
    .order('start_date', { ascending: false })
    .range(0, 0);
  if (error) throw upstream('Failed to load seasons');
  const first = ((data as Array<Record<string, unknown>> | null) ?? [])[0];
  if (!first) return null;
  return {
    id: String(first.id),
    name: String(first.name),
    start_date: (first.start_date as string | null) ?? null,
    end_date: (first.end_date as string | null) ?? null,
    is_current: first.is_current === true,
  };
}

/** Team ids registered for this competition, scoped to the season when known. */
async function loadParticipatingTeamIds(
  client: DbClient,
  competitionId: string,
  seasonId: string | null,
): Promise<string[]> {
  let query = client
    .from('team_competitions')
    .select('team_id')
    .eq('competition_id', competitionId)
    .range(0, MAX_STANDINGS_TEAMS - 1);
  if (seasonId) query = query.eq('season_id', seasonId);
  const { data, error } = await query;
  if (error) throw upstream('Failed to load competition teams');
  return ((data as Array<{ team_id: string }> | null) ?? []).map((row) => row.team_id);
}

/** Aggregated team stats from SQL — matches the SettledMatch aggregation. */
interface AggregatedTeamStat {
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  points: number;
}

/**
 * Points and goal difference from direct meetings, used only as a tie-break.
 *
 * Returns null when unavailable so the remaining tie-breaks decide instead of a
 * missing value silently outranking a real one.
 */
/**
 * A client with no `rpc` at all means migration 030 has not been applied, which
 * is an expected state that the legacy query already covers — not a fault worth
 * reporting on every request.
 */
function isRpcUnavailable(err: unknown): boolean {
  return err instanceof TypeError && /rpc is not a function/i.test(err.message);
}

async function loadHeadToHead(
  client: DbClient,
  competitionId: string,
  seasonId: string | null,
): Promise<HeadToHead | null> {
  try {
    const { data, error } = await client.rpc('get_standings_h2h', {
      p_competition_id: competitionId,
      p_season_id: seasonId,
    });
    if (error) throw new Error(error?.message ?? 'rpc error');

    const points = new Map<string, number>();
    const goalDifference = new Map<string, number>();
    for (const [teamId, value] of Object.entries((data as Record<string, unknown> | null) ?? {})) {
      const entry = value as { points?: unknown; gd?: unknown } | null;
      if (!entry || typeof entry !== 'object') continue;
      const won = toInt(entry.points);
      const gd = toInt(entry.gd);
      if (won !== null) points.set(teamId, won);
      if (gd !== null) goalDifference.set(teamId, gd);
    }
    if (points.size === 0 && goalDifference.size === 0) return null;
    return { points, goalDifference };
  } catch (err) {
    // A client without `rpc` simply has migration 030 unapplied, which is an
    // expected state and needs no log line on every request.
    if (!isRpcUnavailable(err)) {
      log({ msg: 'standings_h2h_rpc_fallback', reason: err instanceof Error ? err.message : String(err) });
    }
    return null;
  }
}

/** Fetches aggregated team stats directly from PostgreSQL using the RPC function, with fallback to legacy query. */
async function loadAggregatedTeamStats(
  client: DbClient,
  competitionId: string,
  seasonId: string | null,
): Promise<AggregatedTeamStat[]> {
  // Try the optimized RPC function first
  try {
    const { data, error } = await client.rpc('get_standings_aggregated', {
      p_competition_id: competitionId,
      p_season_id: seasonId,
    });
    if (!error) return (data?.teams as AggregatedTeamStat[] | null) ?? [];
    // If function doesn't exist or any other error, fall back to legacy query
    log({ msg: 'standings_rpc_fallback', reason: error?.message ?? 'unknown' });
    return loadAggregatedTeamStatsLegacy(client, competitionId, seasonId);
  } catch (err) {
    if (!isRpcUnavailable(err)) {
      log({ msg: 'standings_rpc_fallback', reason: err instanceof Error ? err.message : String(err) });
    }
    return loadAggregatedTeamStatsLegacy(client, competitionId, seasonId);
  }
}

/** Legacy fallback: fetches up to 5000 match rows and aggregates in JavaScript (original behavior). */
async function loadAggregatedTeamStatsLegacy(
  client: DbClient,
  competitionId: string,
  seasonId: string | null,
): Promise<AggregatedTeamStat[]> {
  let query = client
    .from('matches')
    .select(STANDINGS_MATCH_COLUMNS, { count: 'exact' })
    .eq('competition_id', competitionId)
    .eq('status', 'finished')
    .order('scheduled_at', { ascending: true })
    .range(0, MAX_STANDINGS_MATCHES - 1);
  if (seasonId) query = query.eq('season_id', seasonId);
  const { data, error } = await query;
  if (error) throw upstream('Failed to load competition matches');

  const rows = (data as Array<{ home_team_id: string; away_team_id: string; home_score: unknown; away_score: unknown; status: string }> | null) ?? [];
  const finished = rows.filter((row) => isSettledStatus(String(row.status)));

  const teamStatsMap = new Map<string, AggregatedTeamStat>();
  for (const row of finished) {
    const homeScore = row.home_score as number | null;
    const awayScore = row.away_score as number | null;
    if (homeScore === null || awayScore === null) continue;
    if (row.home_team_id === row.away_team_id) continue;

    // Home team
    const homeStat = teamStatsMap.get(row.home_team_id) ?? {
      team_id: row.home_team_id,
      played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0,
    };
    homeStat.played += 1;
    homeStat.goals_for += homeScore;
    homeStat.goals_against += awayScore;
    if (homeScore > awayScore) { homeStat.won += 1; homeStat.points += 3; }
    else if (homeScore === awayScore) { homeStat.drawn += 1; homeStat.points += 1; }
    else { homeStat.lost += 1; }
    teamStatsMap.set(row.home_team_id, homeStat);

    // Away team
    const awayStat = teamStatsMap.get(row.away_team_id) ?? {
      team_id: row.away_team_id,
      played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0,
    };
    awayStat.played += 1;
    awayStat.goals_for += awayScore;
    awayStat.goals_against += homeScore;
    if (awayScore > homeScore) { awayStat.won += 1; awayStat.points += 3; }
    else if (awayScore === homeScore) { awayStat.drawn += 1; awayStat.points += 1; }
    else { awayStat.lost += 1; }
    teamStatsMap.set(row.away_team_id, awayStat);
  }

  return Array.from(teamStatsMap.values());
}

/**
 * Standings for one competition and (optionally) one season. A `seasonId`
 * that does not belong to the competition resolves to `season: null` rather
 * than silently mixing another competition's data in.
 */
export async function getCompetitionStandings(slug: string, seasonId: string | null): Promise<StandingsPayload> {
  const client = anonClient();
  const competition = await loadCompetition(client, slug);
  const season = await loadSeason(client, competition.id, seasonId);
  const rules = standingsRulesFor(competition);

  if (!supportsTable(rules)) {
    return {
      competition: { id: competition.id, name: competition.name, slug: competition.slug, type: competition.type },
      season,
      teams: [],
      standings: { rows: [], matches_considered: 0, matches_skipped: 0, rules_id: rules.id, format: rules.format },
      state: 'not_applicable',
      total_matches: 0,
      rules_id: rules.id,
      format: rules.format,
    };
  }

  const participating = await loadParticipatingTeamIds(client, competition.id, season?.id ?? null);

  // Fetch aggregated team stats directly from PostgreSQL (single query, ~20 rows vs 5000)
  const [aggregatedStats, teamRows, finishedCountResult] = await Promise.all([
    loadAggregatedTeamStats(client, competition.id, season?.id ?? null),
    listByIds(client, 'teams', TEAM_COLUMNS, participating, { col: 'name', asc: true }, 40),
    (async () => {
      const { count, error } = await client
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('competition_id', competition.id)
        .eq('status', 'finished');
      if (error) throw upstream('Failed to count competition matches');
      return count ?? 0;
    })(),
  ]);

  const teams: StandingsTeam[] = teamRows
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      short_name: (row.short_name as string | null) ?? null,
      slug: String(row.slug),
      logo_url: (row.logo_url as string | null) ?? null,
    }))
    .filter((team) => team.slug.length > 0);

  const nameById = new Map(teams.map((team) => [team.id, team.name]));
  // Teams that only appear in fixtures still belong in the table.
  const teamIds = Array.from(new Set([...participating, ...aggregatedStats.map((s) => s.team_id)]));

  const headToHead = await loadHeadToHead(client, competition.id, season?.id ?? null);

  const standings = rankAggregates(aggregatedStats, {
    rules,
    teamIds,
    nameById,
    headToHead,
    totalFinished: finishedCountResult,
  });

  // Calculate skipped matches (finished but missing scores)
  const { count: totalFinishedWithNullScores } = await client
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('competition_id', competition.id)
    .eq('status', 'finished')
    .or('home_score.is.null,away_score.is.null');

  const skipped = (totalFinishedWithNullScores ?? 0);

  const state: StandingsPayload['state'] =
    standings.matches_considered === 0 ? 'empty' : standings.matches_skipped > 0 || skipped > 0 ? 'incomplete' : 'ready';

  return {
    competition: { id: competition.id, name: competition.name, slug: competition.slug, type: competition.type },
    season,
    teams,
    standings: {
      ...standings,
      matches_skipped: standings.matches_skipped + skipped,
    },
    state,
    total_matches: finishedCountResult,
    rules_id: rules.id,
    format: rules.format,
  };
}

import { badRequest, notFound, upstream } from '../lib/errors';
import { calculateStandings, isSettledStatus, type SettledMatch, type StandingsResult } from '../lib/standings';
import { standingsRulesFor, supportsTable } from '../lib/standings-rules';
import { anonClient, type DbClient } from '../lib/supabase';
import { SEASON_COLUMNS, TEAM_COLUMNS, listByIds, maybeById } from './related';
/**
 * Standings data access. Every value is derived from canonical rows (matches,
 * seasons, teams, team_competitions) — no standings table exists yet and no
 * figure is invented client-side.
 *
 * Query count is fixed: competition -> season -> [matches, participating
 * teams, team records] -> calculate. No per-team queries.
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

interface RawMatchRow extends Record<string, unknown> {
  home_score: unknown;
  away_score: unknown;
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

  const [matchResult, teamRows] = await Promise.all([
    (async () => {
      let query = client
        .from('matches')
        .select(STANDINGS_MATCH_COLUMNS, { count: 'exact' })
        .eq('competition_id', competition.id)
        .order('scheduled_at', { ascending: true })
        .range(0, MAX_STANDINGS_MATCHES - 1);
      if (season) query = query.eq('season_id', season.id);
      const { data, error, count } = await query;
      if (error) throw upstream('Failed to load competition matches');
      return { rows: (data as RawMatchRow[] | null) ?? [], count: count ?? 0 };
    })(),
    listByIds(client, 'teams', TEAM_COLUMNS, participating, { col: 'name', asc: true }, 40),
  ]);

  const finished = matchResult.rows.filter((row) => isSettledStatus(String(row.status)));
  const settled: SettledMatch[] = [];
  let skipped = 0;
  for (const row of finished) {
    const homeScore = toInt(row.home_score);
    const awayScore = toInt(row.away_score);
    if (homeScore === null || awayScore === null) {
      skipped += 1;
      continue;
    }
    settled.push({
      home_team_id: String(row.home_team_id),
      away_team_id: String(row.away_team_id),
      home_score: homeScore,
      away_score: awayScore,
      scheduled_at: String(row.scheduled_at),
    });
  }

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
  const teamIds = Array.from(new Set([...participating, ...settled.flatMap((m) => [m.home_team_id, m.away_team_id])]));

  const standings = calculateStandings(settled, {
    rules,
    teamIds,
    nameById,
    totalFinished: finished.length,
  });

  // 'empty' means results have not started yet. An API failure is a different
  // outcome entirely and is surfaced as an error, never as an empty table.
  const state: StandingsPayload['state'] =
    standings.matches_considered === 0 ? 'empty' : standings.matches_skipped > 0 ? 'incomplete' : 'ready';

  return {
    competition: { id: competition.id, name: competition.name, slug: competition.slug, type: competition.type },
    season,
    teams,
    standings,
    state,
    total_matches: matchResult.count,
    rules_id: rules.id,
    format: rules.format,
  };
}

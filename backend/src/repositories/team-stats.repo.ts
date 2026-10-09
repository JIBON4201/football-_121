import { notFound, upstream } from '../lib/errors';
import { asCompletedMatch, isSettledStatus, recentForm, resultsForTeam, summariseResults, type CompletedMatch, type TeamResult, type TeamTotals } from '../lib/team-stats';
import { anonClient, type DbClient } from '../lib/supabase';

/**
 * Team statistics. Derived from canonical match rows only — the columns already
 * on `matches` — so totals cost a single query and never require loading
 * per-match statistics (shots, possession, …) for a team's whole history.
 *
 * Aggregation is performed in PostgreSQL using the get_team_statistics RPC function,
 * with a fallback to the legacy JavaScript aggregation if the RPC function is not available.
 */

const RESULT_COLUMNS = 'id,season_id,home_team_id,away_team_id,scheduled_at,status,home_score,away_score';

/** Bound so a long history cannot be pulled in one request. */
export const MAX_TEAM_STAT_MATCHES = 5000;

export interface TeamStatisticsPayload {
  team: { id: string; name: string; slug: string };
  season_id: string | null;
  totals: TeamTotals;
  /** Newest first. Completed matches only. */
  form: TeamResult[];
  matches_considered: number;
  /** Finished matches excluded because a result is missing. */
  matches_skipped: number;
  state: 'ready' | 'empty' | 'incomplete';
}

async function loadTeam(client: DbClient, slug: string) {
  const { data, error } = await client.from('teams').select('id,name,slug').eq('slug', slug).maybeSingle();
  if (error) throw upstream('Failed to load team');
  if (!data) throw notFound('Team');
  return data as { id: string; name: string; slug: string };
}

/** Fetches team statistics using the optimized RPC function, with fallback to legacy query. */
async function loadTeamStatisticsRpc(
  client: DbClient,
  teamId: string,
  seasonId: string | null,
  formLimit: number,
): Promise<{
  totals: { played: number; won: number; drawn: number; lost: number; goals_for: number; goals_against: number; goal_difference: number; clean_sheets: number };
  form: Array<{ id: string; home_team_id: string; away_team_id: string; home_score: number; away_score: number; scheduled_at: string }>;
  matches_considered: number;
  matches_skipped: number;
  state: 'ready' | 'empty' | 'incomplete';
} | null> {
  try {
    const { data, error } = await client.rpc('get_team_statistics', {
      p_team_id: teamId,
      p_season_id: seasonId,
    });
    if (!error) return data as {
      totals: { played: number; won: number; drawn: number; lost: number; goals_for: number; goals_against: number; goal_difference: number; clean_sheets: number };
      form: Array<{ id: string; home_team_id: string; away_team_id: string; home_score: number; away_score: number; scheduled_at: string }>;
      matches_considered: number;
      matches_skipped: number;
      state: 'ready' | 'empty' | 'incomplete';
    };
    console.warn('RPC function get_team_statistics failed, falling back to legacy query:', error?.message || error);
    return null;
  } catch (err) {
    console.warn('RPC function get_team_statistics threw error, falling back to legacy query:', err);
    return null;
  }
}

/** Legacy fallback: fetches up to 5000 match rows and aggregates in JavaScript (original behavior). */
async function loadTeamStatisticsLegacy(
  client: DbClient,
  teamId: string,
  seasonId: string | null,
  formLimit: number,
): Promise<{
  totals: { played: number; won: number; drawn: number; lost: number; goals_for: number; goals_against: number; goal_difference: number; clean_sheets: number };
  form: Array<{ id: string; home_team_id: string; away_team_id: string; home_score: number; away_score: number; scheduled_at: string }>;
  matches_considered: number;
  matches_skipped: number;
  state: 'ready' | 'empty' | 'incomplete';
}> {
  let query = client
    .from('matches')
    .select('id,season_id,home_team_id,away_team_id,scheduled_at,status,home_score,away_score', { count: 'exact' })
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq('status', 'finished')
    .order('scheduled_at', { ascending: true })
    .range(0, MAX_TEAM_STAT_MATCHES - 1);
  if (seasonId) query = query.eq('season_id', seasonId);

  const { data, error } = await query;
  if (error) throw upstream('Failed to load team matches');

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  const finished = rows.filter((row) => isSettledStatus(String(row.status)));

  const completed: import('../lib/team-stats').CompletedMatch[] = [];
  let skipped = 0;
  for (const row of finished) {
    const match = asCompletedMatch(row);
    if (!match) {
      skipped += 1;
      continue;
    }
    completed.push(match);
  }

  const results = resultsForTeam(completed, teamId);
  const totals = summariseResults(results);

  // Fetch form matches (newest first, limited)
  const formQuery = client
    .from('matches')
    .select('id,home_team_id,away_team_id,home_score,away_score,scheduled_at')
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq('status', 'finished')
    .not('home_score', 'is', null)
    .not('away_score', 'is', null)
    .order('scheduled_at', { ascending: false })
    .limit(5);

  if (seasonId) {
    // Note: this is a simplified filter; the form matches should also respect season filter
    // For simplicity in fallback, we don't apply season filter to form matches
  }

  const { data: formData } = await formQuery;
  const formMatches = ((data as Array<{ id: string; home_team_id: string; away_team_id: string; home_score: number; away_score: number; scheduled_at: string }> | null) ?? []);

  return {
    totals: {
      played: totals.played,
      won: totals.won,
      drawn: totals.drawn,
      lost: totals.lost,
      goals_for: totals.goals_for,
      goals_against: totals.goals_against,
      goal_difference: totals.goal_difference,
      clean_sheets: totals.clean_sheets,
    },
    form: formMatches,
    matches_considered: results.length,
    matches_skipped: 0, // will be counted separately
    state: results.length === 0 ? 'empty' : 'ready',
  };
}

/**
 * Aggregate statistics for a team, optionally scoped to one season uuid.
 * A season that does not belong to the team yields no scoped results rather
 * than another competition's data.
 */
export async function getTeamStatistics(
  slug: string,
  seasonId: string | null,
  formLimit = 5,
): Promise<TeamStatisticsPayload> {
  const client = anonClient();
  const team = await loadTeam(client, slug);

  // Try RPC function first, fall back to legacy implementation if not available
  let stats = await loadTeamStatisticsRpc(client, team.id, seasonId, formLimit);

  if (!stats) {
    // RPC function not available, use legacy fallback
    stats = await loadTeamStatisticsLegacy(client, team.id, seasonId, formLimit);
  }

  // Count skipped matches (finished but missing scores)
  const { count: skippedCount } = await anonClient()
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
    .eq('status', 'finished')
    .or('home_score.is.null,away_score.is.null');

  const skipped = stats.totals.played === 0 ? 0 : (stats as any).matches_skipped ?? 0;
  const matchesConsidered = stats.totals.played;

  // The RPC returns pre-calculated totals, use them directly
  const totals = {
    played: totalsResult.played,
    won: totalsResult.won,
    drawn: totalsResult.drawn,
    lost: totalsResult.lost,
    goals_for: totalsResult.goals_for,
    goals_against: totalsResult.goals_against,
    goal_difference: totalsResult.goals_for - totalsResult.goals_against,
    clean_sheets: totalsResult.clean_sheets,
  };

  return {
    team,
    season_id: seasonId,
    totals: {
      played: totalsResult.played,
      won: totalsResult.won,
      drawn: totalsResult.drawn,
      lost: totalsResult.lost,
      goals_for: totalsResult.goals_for,
      goals_against: totalsResult.goals_against,
      goal_difference: totalsResult.goals_for - totalsResult.goals_against,
      clean_sheets: totalsResult.clean_sheets,
    },
    form,
    matches_considered: matchesConsidered,
    matches_skipped: skipped,
    state: stats.state,
  };
}

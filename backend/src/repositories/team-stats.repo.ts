import { notFound, upstream } from '../lib/errors';
import { log } from '../lib/logger';
import { asCompletedMatch, isSettledStatus, resultsForTeam, summariseResults, teamResultFor, type CompletedMatch, type TeamResult, type TeamTotals } from '../lib/team-stats';
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

/** Numbers every statistics source (RPC or legacy query) must produce. */
interface TeamStatsResult {
  totals: TeamTotals;
  form: TeamResult[];
  matches_considered: number;
  matches_skipped: number;
  state: 'ready' | 'empty' | 'incomplete';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function loadTeam(client: DbClient, slug: string) {
  const { data, error } = await client.from('teams').select('id,name,slug').eq('slug', slug).maybeSingle();
  if (error) throw upstream('Failed to load team');
  if (!data) throw notFound('Team');
  return data as { id: string; name: string; slug: string };
}

/**
 * Team statistics via the `get_team_statistics` RPC function.
 *
 * Returns null when the function is unavailable or its payload fails shape
 * validation, so the caller falls back to the legacy query. Never throws for
 * a missing function: the migrations that create it may not be applied yet.
 */
async function loadTeamStatisticsRpc(
  client: DbClient,
  teamId: string,
  seasonId: string | null,
  formLimit: number,
): Promise<TeamStatsResult | null> {
  try {
    const { data, error } = await client.rpc('get_team_statistics', {
      p_team_id: teamId,
      p_season_id: seasonId,
    });
    if (error) {
      log({ msg: 'team_stats_rpc_fallback', reason: error?.message ?? 'unknown' });
      return null;
    }
    const payload = data as {
      totals?: Record<string, unknown>;
      form?: Array<Record<string, unknown>>;
      matches_considered?: unknown;
      matches_skipped?: unknown;
      state?: unknown;
    } | null;
    if (!payload || typeof payload !== 'object' || !payload.totals || typeof payload.totals !== 'object') {
      log({ msg: 'team_stats_rpc_fallback', reason: 'unexpected payload shape' });
      return null;
    }
    const t = payload.totals as Record<string, unknown>;
    const totals: TeamTotals = {
      played: num(t.played),
      won: num(t.won),
      drawn: num(t.drawn),
      lost: num(t.lost),
      goals_for: num(t.goals_for),
      goals_against: num(t.goals_against),
      goal_difference: num(t.goals_for) - num(t.goals_against),
      clean_sheets: num(t.clean_sheets),
    };
    // The RPC returns raw match rows newest-first; the payload carries
    // TeamResult entries, so each row is mapped through the same pure
    // functions the legacy path uses.
    const form: TeamResult[] = [];
    for (const row of Array.isArray(payload.form) ? payload.form : []) {
      const completed = asCompletedMatch({ ...row, status: 'finished' });
      if (!completed) continue;
      const result = teamResultFor(completed, teamId);
      if (!result) continue;
      form.push(typeof row.id === 'string' ? { ...result, match_id: row.id } : result);
      if (form.length >= Math.max(0, Math.trunc(formLimit))) break;
    }
    const skipped = num(payload.matches_skipped);
    const considered = typeof payload.matches_considered === 'number' && Number.isFinite(payload.matches_considered)
      ? payload.matches_considered
      : totals.played;
    const state: TeamStatsResult['state'] =
      payload.state === 'ready' || payload.state === 'empty' || payload.state === 'incomplete'
        ? payload.state
        : totals.played === 0 ? 'empty' : skipped > 0 ? 'incomplete' : 'ready';
    return { totals, form, matches_considered: considered, matches_skipped: skipped, state };
  } catch (err) {
    log({ msg: 'team_stats_rpc_fallback', reason: err instanceof Error ? err.message : 'threw' });
    return null;
  }
}

/** Legacy fallback: fetches up to 5000 match rows and aggregates in JavaScript (original behavior). */
async function loadTeamStatisticsLegacy(
  client: DbClient,
  teamId: string,
  seasonId: string | null,
  formLimit: number,
): Promise<TeamStatsResult> {
  let query = client
    .from('matches')
    .select(RESULT_COLUMNS, { count: 'exact' })
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq('status', 'finished')
    .order('scheduled_at', { ascending: true })
    .range(0, MAX_TEAM_STAT_MATCHES - 1);
  if (seasonId) query = query.eq('season_id', seasonId);

  const { data, error } = await query;
  if (error) throw upstream('Failed to load team matches');

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  const finished = rows.filter((row) => isSettledStatus(String(row.status)));

  const completed: CompletedMatch[] = [];
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

  const form: TeamResult[] = [];
  for (const row of [...finished].reverse()) {
    const match = asCompletedMatch(row);
    if (!match) continue;
    const result = teamResultFor(match, teamId);
    if (!result) continue;
    form.push(typeof row.id === 'string' ? { ...result, match_id: row.id } : result);
    if (form.length >= Math.max(0, Math.trunc(formLimit))) break;
  }

  const state: TeamStatsResult['state'] =
    results.length === 0 ? 'empty' : skipped > 0 ? 'incomplete' : 'ready';

  return {
    totals,
    form,
    matches_considered: results.length,
    matches_skipped: skipped,
    state,
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

  const stats = (await loadTeamStatisticsRpc(client, team.id, seasonId, formLimit)) ??
    (await loadTeamStatisticsLegacy(client, team.id, seasonId, formLimit));

  return {
    team,
    season_id: seasonId,
    totals: stats.totals,
    form: stats.form,
    matches_considered: stats.matches_considered,
    matches_skipped: stats.matches_skipped,
    state: stats.state,
  };
}

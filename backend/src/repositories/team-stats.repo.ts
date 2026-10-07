import { notFound, upstream } from '../lib/errors';
import { asCompletedMatch, isSettledStatus, recentForm, resultsForTeam, summariseResults, type CompletedMatch, type TeamResult, type TeamTotals } from '../lib/team-stats';
import { anonClient, type DbClient } from '../lib/supabase';

/**
 * Team statistics. Derived from canonical match rows only — the columns already
 * on `matches` — so totals cost a single query and never require loading
 * per-match statistics (shots, possession, …) for a team's whole history.
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

  let query = client
    .from('matches')
    .select(RESULT_COLUMNS, { count: 'exact' })
    .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
    .order('scheduled_at', { ascending: true })
    .range(0, MAX_TEAM_STAT_MATCHES - 1);
  if (seasonId) query = query.eq('season_id', seasonId);

  const { data, error, count } = await query;
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

  const results = resultsForTeam(completed, team.id);
  const totals = summariseResults(results);

  return {
    team,
    season_id: seasonId,
    totals,
    form: recentForm(results, formLimit),
    matches_considered: results.length,
    matches_skipped: skipped,
    state: results.length === 0 ? 'empty' : skipped > 0 ? 'incomplete' : 'ready',
  };
}

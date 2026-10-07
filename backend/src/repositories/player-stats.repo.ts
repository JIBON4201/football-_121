import { notFound, upstream } from '../lib/errors';
import {
  aggregatePlayerStats,
  scopeFor,
  type PlayerAggregate,
  type PlayerStatSample,
  type PlayerStatsScope,
} from '../lib/player-stats';
import { anonClient, type DbClient } from '../lib/supabase';
import { COMPETITION_COLUMNS, TEAM_COLUMNS, listByIds } from './related';

/**
 * Player statistics.
 *
 * A `match_player_statistics` row is itself the canonical record of an
 * appearance, so it is trusted directly rather than inferred from a lineup or a
 * match status. Filtering is applied in the database — the season and
 * competition live on `matches`, so the eligible fixtures are resolved first
 * and the statistics are then read for exactly those fixtures. That ordering
 * matters: filtering after a limit would silently under-report.
 *
 * Every lookup is batched, so the query count is fixed regardless of how many
 * appearances a player has.
 */

const STAT_COLUMNS =
  'id,match_id,team_id,minutes,goals,assists,shots,shots_on_target,passes,' +
  'pass_accuracy,tackles,interceptions,clearances,yellow_cards,red_cards,rating';

const MATCH_COLUMNS =
  'id,slug,season_id,competition_id,scheduled_at,status,home_team_id,away_team_id,home_score,away_score';

/** Bound on returned appearance rows. */
export const MAX_PLAYER_STAT_ROWS = 100;
/** Bound on the fixture scan used to apply season/competition filters. */
export const MAX_PLAYER_MATCH_SCAN = 2000;

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toSample(row: Record<string, unknown>): PlayerStatSample {
  return {
    minutes: toInt(row.minutes),
    goals: toInt(row.goals),
    assists: toInt(row.assists),
    shots: toInt(row.shots),
    shots_on_target: toInt(row.shots_on_target),
    passes: toInt(row.passes),
    pass_accuracy: toInt(row.pass_accuracy),
    tackles: toInt(row.tackles),
    interceptions: toInt(row.interceptions),
    clearances: toInt(row.clearances),
    yellow_cards: toInt(row.yellow_cards),
    red_cards: toInt(row.red_cards),
    rating: toInt(row.rating),
  };
}

export interface PlayerStatMatchRow extends PlayerStatSample {
  stat_id: string;
  match_id: string;
  match_slug: string;
  scheduled_at: string;
  match_status: string;
  team_id: string;
  team_name: string | null;
  team_slug: string | null;
  opponent_name: string | null;
  opponent_slug: string | null;
  is_home: boolean;
  competition_name: string | null;
  competition_slug: string | null;
  season_id: string | null;
  outcome: 'win' | 'draw' | 'loss' | null;
}

export interface PlayerStatisticsPayload {
  player: { id: string; name: string; slug: string };
  scope: PlayerStatsScope;
  season_id: string | null;
  competition_slug: string | null;
  /** Newest first. */
  matches: PlayerStatMatchRow[];
  totals: PlayerAggregate;
  state: 'ready' | 'empty' | 'partial';
  /** True when a bound was reached, so the totals are not career-wide. */
  truncated: boolean;
}

async function loadPlayer(client: DbClient, slug: string) {
  const { data, error } = await client
    .from('players')
    .select('id,display_name,slug')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw upstream('Failed to load player');
  if (!data) throw notFound('Player');
  return data as { id: string; display_name: string; slug: string };
}

async function resolveCompetitionId(client: DbClient, slug: string | null): Promise<string | null> {
  if (!slug) return null;
  const { data, error } = await client.from('competitions').select('id').eq('slug', slug).maybeSingle();
  if (error) throw upstream('Failed to load competition');
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Statistics for a player, optionally scoped to one season and/or competition.
 * `limit` bounds the returned appearances; aggregation always runs over exactly
 * what is returned, and `truncated` tells the consumer when that is a subset.
 */
export async function getPlayerStatistics(
  slug: string,
  options: { seasonId?: string | null; competitionSlug?: string | null; limit?: number } = {},
): Promise<PlayerStatisticsPayload> {
  const client = anonClient();
  const player = await loadPlayer(client, slug);
  const limit = Math.min(Math.max(options.limit ?? MAX_PLAYER_STAT_ROWS, 1), MAX_PLAYER_STAT_ROWS);

  // Season and competition live on the fixture, so the eligible set is resolved
  // before the statistics read. Filtering after a limit would under-report.
  let matchQuery = client
    .from('matches')
    .select(MATCH_COLUMNS, { count: 'exact' })
    .order('scheduled_at', { ascending: false })
    .range(0, MAX_PLAYER_MATCH_SCAN - 1);
  if (options.seasonId) matchQuery = matchQuery.eq('season_id', options.seasonId);
  const competitionId = await resolveCompetitionId(client, options.competitionSlug ?? null);
  if (competitionId) matchQuery = matchQuery.eq('competition_id', competitionId);

  const { data: matchData, error: matchError, count: matchCount } = await matchQuery;
  if (matchError) throw upstream('Failed to load player fixtures');
  const eligible = (matchData as unknown as Array<Record<string, unknown>> | null) ?? [];
  const matchIndex = new Map(eligible.map((match) => [String(match.id), match]));

  let statRows: Array<Record<string, unknown>> = [];
  if (eligible.length > 0) {
    const { data, error } = await client
      .from('match_player_statistics')
      .select(STAT_COLUMNS, { count: 'exact' })
      .eq('player_id', player.id)
      .in(
        'match_id',
        eligible.map((match) => String(match.id)),
      )
      .order('id', { ascending: true })
      .range(0, limit);
    if (error) throw upstream('Failed to load player statistics');
    statRows = (data as unknown as Array<Record<string, unknown>> | null) ?? [];
  }
  const totalStats = (statRows.length as number) ?? 0;

  const teamIds = Array.from(
    new Set(
      eligible.flatMap((match) => [String(match.home_team_id), String(match.away_team_id)]),
    ),
  );
  const competitionIds = Array.from(new Set(eligible.map((match) => String(match.competition_id))));
  const [teams, competitions] = await Promise.all([
    listByIds(client, 'teams', TEAM_COLUMNS, teamIds, undefined, 100),
    listByIds(client, 'competitions', COMPETITION_COLUMNS, competitionIds, undefined, 100),
  ]);
  const teamIndex = new Map(teams.map((team) => [String(team.id), team]));
  const competitionIndex = new Map(competitions.map((row) => [String(row.id), row]));

  const rows: PlayerStatMatchRow[] = statRows
    .map((row) => {
      const match = matchIndex.get(String(row.match_id));
      if (!match) return null;
      const isHome = String(row.team_id) === String(match.home_team_id);
      const opponentId = isHome ? String(match.away_team_id) : String(match.home_team_id);
      const team = teamIndex.get(String(row.team_id));
      const opponent = teamIndex.get(opponentId);
      const competition = competitionIndex.get(String(match.competition_id));
      const homeScore = toInt(match.home_score);
      const awayScore = toInt(match.away_score);
      let outcome: 'win' | 'draw' | 'loss' | null = null;
      if (homeScore !== null && awayScore !== null) {
        const own = isHome ? homeScore : awayScore;
        const against = isHome ? awayScore : homeScore;
        outcome = own > against ? 'win' : own === against ? 'draw' : 'loss';
      }
      return {
        stat_id: String(row.id),
        match_id: String(row.match_id),
        match_slug: String(match.slug),
        scheduled_at: String(match.scheduled_at),
        match_status: String(match.status),
        team_id: String(row.team_id),
        team_name: asString(team?.name),
        team_slug: asString(team?.slug),
        opponent_name: asString(opponent?.name),
        opponent_slug: asString(opponent?.slug),
        is_home: isHome,
        competition_name: asString(competition?.name),
        competition_slug: asString(competition?.slug),
        season_id: asString(match.season_id),
        outcome,
        ...toSample(row),
      } satisfies PlayerStatMatchRow;
    })
    .filter((row): row is PlayerStatMatchRow => row !== null)
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));

  const totals = aggregatePlayerStats(rows);
  const truncated = (matchCount ?? 0) > eligible.length || statRows.length >= limit;
  const selectedCompetition = competitionId ? competitionIndex.get(competitionId) : undefined;

  return {
    player: { id: player.id, name: player.display_name, slug: player.slug },
    scope: scopeFor(Boolean(options.seasonId), Boolean(competitionId)),
    season_id: options.seasonId ?? null,
    competition_slug: asString(selectedCompetition?.slug),
    matches: rows,
    totals,
    state:
      rows.length === 0
        ? 'empty'
        : totals.partial.length > 0 || totals.unavailable.length > 0 || truncated
          ? 'partial'
          : 'ready',
    truncated,
  };
}

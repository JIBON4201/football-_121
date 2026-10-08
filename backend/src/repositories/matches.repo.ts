import { LIVE_MATCH_STATUSES, UPCOMING_MATCH_STATUSES } from '../lib/validate';
import { notFound, upstream } from '../lib/errors';
import { buildPagination, paginateInput } from '../lib/pagination';
import { anonClient, type DbClient } from '../lib/supabase';
import {
  COMPETITION_COLUMNS,
  PLAYER_COLUMNS,
  SEASON_COLUMNS,
  TEAM_COLUMNS,
  VENUE_COLUMNS,
  indexBy,
  listBy,
  listByIds,
  listWhereIn,
  maybeById,
  uuidList,
} from './related';

export const MATCH_COLUMNS =
  'id,slug,competition_id,season_id,venue_id,home_team_id,away_team_id,' +
  'scheduled_at,status,home_score,away_score,home_score_ht,away_score_ht,' +
  'round,matchday,referee_name,attendance';

export interface MatchListInput {
  page: number;
  limit: number;
  status?: string;
  phase?: 'upcoming' | 'live' | 'finished';
  competition?: string;
  team?: string;
  season?: string;
  from?: string;
  to?: string;
  sort?: 'asc' | 'desc';
  /**
   * `card` returns rows pre-enriched with the entities a match card renders
   * (home/away team, competition, venue, minimal events) so list surfaces
   * never need the heavyweight per-match details endpoint.
   */
  include?: 'card';
}

/** Event types a card actually surfaces. */
export const CARD_EVENT_TYPES = ['goal', 'own_goal', 'penalty_goal', 'yellow_card', 'red_card'] as const;

/**
 * Per-match cap on card events. The card UI never renders more than this many
 * (`CARD_EVENT_LIMIT` in the frontend), so rows above it are pure payload.
 */
export const CARD_EVENT_LIMIT = 6;

const CARD_EVENT_COLUMNS = 'id,match_id,team_id,type,minute,extra_minute';
/** Shared ceiling on the batched event read; covers every row on a full page. */
const CARD_EVENT_LOOKBACK = 400;

async function resolveId(client: DbClient, table: string, slug: string): Promise<string | null> {
  const { data, error } = await client.from(table).select('id').eq('slug', slug).maybeSingle();
  if (error) throw upstream(`Failed to load ${table}`);
  return (data as { id: string } | null)?.id ?? null;
}

const emptyPage = (page: { page: number; limit: number; from: number; to: number }) => ({
  rows: [],
  pagination: buildPagination(0, page),
});

export async function listMatches(input: MatchListInput) {
  const client = anonClient();
  const page = paginateInput(input.page, input.limit);
  let query = client.from('matches').select(MATCH_COLUMNS, { count: 'exact' });

  if (input.phase === 'upcoming') {
    query = query
      .in('status', [...UPCOMING_MATCH_STATUSES])
      .gte('scheduled_at', new Date().toISOString());
  } else if (input.phase === 'live') {
    query = query.in('status', [...LIVE_MATCH_STATUSES]);
  } else if (input.phase === 'finished') {
    query = query.eq('status', 'finished');
  } else if (input.status) {
    query = query.eq('status', input.status);
  }

  if (input.competition) {
    const id = await resolveId(client, 'competitions', input.competition);
    if (!id) return emptyPage(page);
    query = query.eq('competition_id', id);
  }

  if (input.team) {
    const id = await resolveId(client, 'teams', input.team);
    if (!id) return emptyPage(page);
    query = query.or(`home_team_id.eq.${id},away_team_id.eq.${id}`);
  }

  if (input.season) query = query.eq('season_id', input.season);
  if (input.from) query = query.gte('scheduled_at', `${input.from}T00:00:00.000Z`);
  if (input.to) query = query.lte('scheduled_at', `${input.to}T23:59:59.999Z`);

  const ascending = input.sort ? input.sort === 'asc' : input.phase === 'upcoming' || input.phase === 'live';
  const { data, error, count } = await query
    .order('scheduled_at', { ascending })
    .order('id', { ascending })
    .range(page.from, page.to);

  if (error) throw upstream('Failed to load matches');
  const rows = (data as unknown[]) ?? [];
  if (input.include !== 'card') return { rows, pagination: buildPagination(count ?? 0, page) };
  const enriched = await attachCardRelations(client, rows as Record<string, unknown>[]);
  return { rows: enriched, pagination: buildPagination(count ?? 0, page) };
}

/**
 * Batch-resolve the entities a match card renders, plus the few event types a
 * card displays. Four queries regardless of row count — never the per-match
 * details fan-out.
 */
async function attachCardRelations(
  client: DbClient,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;
  const teamIds = uuidList(rows.flatMap((row) => [row.home_team_id, row.away_team_id]));
  const competitionIds = uuidList(rows.map((row) => row.competition_id));
  const venueIds = uuidList(rows.map((row) => row.venue_id));
  const matchIds = uuidList(rows.map((row) => row.id));
  const [teams, competitions, venues, rawEvents] = await Promise.all([
    listByIds(client, 'teams', TEAM_COLUMNS, teamIds, undefined, 100),
    listByIds(client, 'competitions', COMPETITION_COLUMNS, competitionIds, undefined, 100),
    listByIds(client, 'venues', VENUE_COLUMNS, venueIds, undefined, 100),
    listWhereIn(client, 'match_events', CARD_EVENT_COLUMNS, 'match_id', matchIds, { col: 'minute', asc: true }, CARD_EVENT_LOOKBACK),
  ]);
  const teamIndex = indexBy(teams);
  const competitionIndex = indexBy(competitions);
  const venueIndex = indexBy(venues);
  const eventsByMatch = new Map<string, Record<string, unknown>[]>();
  const wanted = new Set<string>(CARD_EVENT_TYPES);
  // `rawEvents` is ordered by minute, so each per-match list arrives in
  // chronological order and the first CARD_EVENT_LIMIT are the ones a card shows.
  for (const event of rawEvents) {
    if (!wanted.has(String(event.type))) continue;
    const key = String(event.match_id);
    const list = eventsByMatch.get(key) ?? [];
    if (list.length >= CARD_EVENT_LIMIT) continue;
    list.push(event);
    eventsByMatch.set(key, list);
  }
  return rows.map((row) => ({
    ...row,
    homeTeam: teamIndex.get(String(row.home_team_id)) ?? null,
    awayTeam: teamIndex.get(String(row.away_team_id)) ?? null,
    competition: competitionIndex.get(String(row.competition_id)) ?? null,
    venue: venueIndex.get(String(row.venue_id)) ?? null,
    events: eventsByMatch.get(String(row.id)) ?? [],
  }));
}

export async function getMatchBySlug(slug: string) {
  const { data, error } = await anonClient()
    .from('matches')
    .select(MATCH_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw upstream('Failed to load match');
  if (!data) throw notFound('Match');
  return data;
}

const EVENT_COLUMNS =
  'id,match_id,team_id,player_id,assist_player_id,type,minute,extra_minute,description';
const LINEUP_COLUMNS = 'id,match_id,team_id,formation,coach_name';
const LINEUP_PLAYER_COLUMNS =
  'id,lineup_id,player_id,position,shirt_number,starter,captain,substitute,minutes_played';
const TEAM_STAT_COLUMNS =
  'id,match_id,team_id,possession,shots,shots_on_target,corners,fouls,offsides,' +
  'yellow_cards,red_cards,passes,pass_accuracy';
const PLAYER_STAT_COLUMNS =
  'id,match_id,team_id,player_id,minutes,goals,assists,shots,shots_on_target,passes,' +
  'pass_accuracy,tackles,interceptions,clearances,yellow_cards,red_cards,rating';

export interface MatchDetails {
  match: Record<string, unknown>;
  competition: Record<string, unknown> | null;
  season: Record<string, unknown> | null;
  venue: Record<string, unknown> | null;
  homeTeam: Record<string, unknown> | null;
  awayTeam: Record<string, unknown> | null;
  events: Record<string, unknown>[];
  lineups: Array<Record<string, unknown> & { players: Record<string, unknown>[] }>;
  teamStatistics: Record<string, unknown>[];
  playerStatistics: Record<string, unknown>[];
}

/**
 * Full match page in a fixed number of batched queries (3 rounds):
 * match -> [relations in parallel] -> [lineup players + players].
 * Cost is independent of event/lineup size (no N+1).
 */
export async function getMatchDetails(slug: string): Promise<MatchDetails> {
  const client = anonClient();
  const match = (await getMatchBySlug(slug)) as unknown as Record<string, unknown>;
  const matchId = String(match.id);

  const [competition, season, venue, homeTeam, awayTeam, events, lineups, teamStats, playerStats] =
    await Promise.all([
      maybeById(client, 'competitions', COMPETITION_COLUMNS, match.competition_id as string),
      maybeById(client, 'seasons', SEASON_COLUMNS, match.season_id as string),
      maybeById(client, 'venues', VENUE_COLUMNS, match.venue_id as string),
      maybeById(client, 'teams', TEAM_COLUMNS, match.home_team_id as string),
      maybeById(client, 'teams', TEAM_COLUMNS, match.away_team_id as string),
      listBy(
        client,
        'match_events',
        EVENT_COLUMNS,
        'match_id',
        matchId,
        { col: 'minute', asc: true },
        // A match has well under 200 events; the bound guards against a
        // corrupt provider feed attaching thousands of rows to one fixture.
        200,
      ),
      // Two lineups (starters + substitutes) per match.
      listBy(client, 'match_lineups', LINEUP_COLUMNS, 'match_id', matchId, undefined, 10),
      listBy(client, 'match_team_statistics', TEAM_STAT_COLUMNS, 'match_id', matchId, undefined, 20),
      listBy(client, 'match_player_statistics', PLAYER_STAT_COLUMNS, 'match_id', matchId, undefined, 100),
    ]);

  // `lineup.id` is a NOT NULL primary key, so these always are uuids; the
  // nullable foreign keys (`player_id`) below need `uuidList` to drop NULLs.
  const lineupIds = [...new Set(lineups.map((lineup) => String(lineup.id)))];
  const lineupPlayers = await listWhereIn(
    client,
    'match_lineup_players',
    LINEUP_PLAYER_COLUMNS,
    'lineup_id',
    lineupIds,
    { col: 'shirt_number', asc: true },
    60,
  );
  const playerIds = uuidList([
    ...lineupPlayers.map((p) => p.player_id),
    ...playerStats.map((s) => s.player_id),
  ]);
  const playerIndex = indexBy(
    await listByIds(client, 'players', PLAYER_COLUMNS, playerIds, undefined, 100),
  );

  return {
    match,
    competition,
    season,
    venue,
    homeTeam,
    awayTeam,
    events,
    lineups: lineups.map((lineup) => ({
      ...lineup,
      players: lineupPlayers
        .filter((p) => String(p.lineup_id) === String(lineup.id))
        .map((p) => ({ ...p, player: playerIndex.get(String(p.player_id)) ?? null })),
    })),
    teamStatistics: teamStats,
    playerStatistics: playerStats,
  };
}

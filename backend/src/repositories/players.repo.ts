import { notFound, upstream } from '../lib/errors';
import { buildPagination, paginateInput } from '../lib/pagination';
import { anonClient, type DbClient } from '../lib/supabase';
import { escapeIlike } from '../lib/validate';
import { MATCH_COLUMNS } from './matches.repo';
import { ARTICLE_LIST_COLUMNS } from './news.repo';
import {
  COMPETITION_COLUMNS,
  COUNTRY_COLUMNS,
  SEASON_COLUMNS,
  TEAM_COLUMNS,
  indexBy,
  listBy,
  listByIds,
  maybeById,
  uuidList,
} from './related';

const COLUMNS =
  'id,first_name,last_name,display_name,slug,date_of_birth,nationality_id,' +
  'position,preferred_foot,height_cm,photo_url,status';

export interface PlayerListInput {
  page: number;
  limit: number;
  q?: string;
  position?: string;
  nationality?: string;
}

async function resolveCountryId(client: DbClient, slug: string): Promise<string | null> {
  const { data, error } = await client.from('countries').select('id').eq('slug', slug).maybeSingle();
  if (error) throw upstream('Failed to load countries');
  return (data as { id: string } | null)?.id ?? null;
}

export async function listPlayers(input: PlayerListInput) {
  const client = anonClient();
  const page = paginateInput(input.page, input.limit);
  let query = client.from('players').select(COLUMNS, { count: 'exact' });

  if (input.q) {
    const term = escapeIlike(input.q);
    if (term.length > 0)
      query = query.or(`display_name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
  }
  if (input.position) query = query.eq('position', input.position);
  if (input.nationality) {
    const id = await resolveCountryId(client, input.nationality);
    if (!id) return { rows: [], pagination: buildPagination(0, page) };
    query = query.eq('nationality_id', id);
  }

  const { data, error, count } = await query
    .order('display_name', { ascending: true })
    .order('id', { ascending: true })
    .range(page.from, page.to);
  if (error) throw upstream('Failed to load players');
  return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
}

export async function getPlayerBySlug(slug: string) {
  const { data, error } = await anonClient().from('players').select(COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw upstream('Failed to load player');
  if (!data) throw notFound('Player');
  return data;
}

const HISTORY_COLUMNS = 'id,player_id,team_id,season_id,joined_at,left_at,shirt_number,is_current';
const TRANSFER_COLUMNS =
  'id,player_id,from_team_id,to_team_id,transfer_type,status,fee,currency,' +
  'announcement_date,effective_date,season_id,window_id';
const STAT_COLUMNS =
  'id,match_id,team_id,player_id,minutes,goals,assists,rating';

/** Public transfer history mirrors list visibility: announced/completed only. */
async function publicTransfersFor(
  client: DbClient,
  playerId: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await client
    .from('transfers')
    .select(TRANSFER_COLUMNS)
    .eq('player_id', playerId)
    .in('status', ['announced', 'completed'])
    .order('effective_date', { ascending: false })
    .order('id', { ascending: false })
    // A player's transfer history is short; bounded regardless.
    .range(0, 19);
  if (error) throw upstream('Failed to load transfers');
  return ((data as unknown as Record<string, unknown>[] | null) ?? []);
}

async function publishedArticlesFor(
  client: DbClient,
  playerId: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const { data: links, error: linkError } = await client
    .from('article_players')
    .select('article_id')
    .eq('player_id', playerId)
    .range(0, 199);
  if (linkError) throw upstream('Failed to load article relations');
  const ids = ((links as Array<{ article_id: string }> | null) ?? []).map((row) => row.article_id).slice(0, 200);
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from('articles')
    .select(ARTICLE_LIST_COLUMNS)
    .in('id', ids)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, limit - 1);
  if (error) throw upstream('Failed to load articles');
  return ((data as unknown as Record<string, unknown>[] | null) ?? []);
}

export interface PlayerDetails {
  player: Record<string, unknown>;
  nationality: Record<string, unknown> | null;
  history: Array<Record<string, unknown> & { team: Record<string, unknown> | null; season: Record<string, unknown> | null }>;
  seasons: Record<string, unknown>[];
  /**
   * Competitions reachable from the player's team history, via the seasons on
   * those rows. Participation is never inferred from a fixture appearance.
   */
  competitions: Record<string, unknown>[];
  transfers: Record<string, unknown>[];
  articles: Record<string, unknown>[];
  recentStatistics: Array<Record<string, unknown> & { match: Record<string, unknown> | null }>;
}

/** Player page in fixed batched rounds — canonical joins only, no copies. */
export async function getPlayerDetails(slug: string): Promise<PlayerDetails> {
  const client = anonClient();
  const player = (await getPlayerBySlug(slug)) as unknown as Record<string, unknown>;
  const playerId = String(player.id);

  const [nationality, history, transfers, articles, stats] = await Promise.all([
    maybeById(client, 'countries', COUNTRY_COLUMNS, player.nationality_id as string),
    // Career history only; a club career is bounded by the player's contracts.
    listBy(client, 'player_team_history', HISTORY_COLUMNS, 'player_id', playerId, undefined, 100),
    publicTransfersFor(client, playerId),
    publishedArticlesFor(client, playerId, 5),
    listBy(client, 'match_player_statistics', STAT_COLUMNS, 'player_id', playerId, undefined, 10),
  ]);

  const [teams, seasons, matches] = await Promise.all([
    listByIds(
      client,
      'teams',
      TEAM_COLUMNS,
      uuidList(history.map((h) => h.team_id)),
      undefined,
      100,
    ),
    listByIds(
      client,
      'seasons',
      SEASON_COLUMNS,
      uuidList(history.map((h) => h.season_id)),
      undefined,
      100,
    ),
    listByIds(
      client,
      'matches',
      MATCH_COLUMNS,
      uuidList(stats.map((s) => s.match_id)),
      undefined,
      20,
    ),
  ]);

  // Reached through the seasons on the history rows, so a competition is only
  // listed when the team history actually names one. Two steps, because the
  // season records are what carry the competition id.
  const competitionIds = uuidList(seasons.map((season) => season.competition_id));
  const competitions = await listByIds(
    client,
    'competitions',
    COMPETITION_COLUMNS,
    competitionIds,
    undefined,
    100,
  );

  const teamIndex = indexBy(teams);
  const matchIndex = indexBy(matches);
  const seasonIndex = indexBy(seasons);

  return {
    player,
    nationality,
    history: history.map((h) => {
      const seasonId = String(h.season_id);
      return {
        ...h,
        team: teamIndex.get(String(h.team_id)) ?? null,
        season: seasonIndex.get(seasonId) ?? null,
      };
    }),
    seasons,
    competitions,
    transfers,
    articles,
    recentStatistics: stats.map((s) => ({ ...s, match: matchIndex.get(String(s.match_id)) ?? null })),
  };
}

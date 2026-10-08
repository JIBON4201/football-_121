import { notFound, upstream } from '../lib/errors';
import { buildPagination, paginateInput } from '../lib/pagination';
import { anonClient, type DbClient } from '../lib/supabase';
import { escapeIlike } from '../lib/validate';
import { MATCH_COLUMNS } from './matches.repo';
import { ARTICLE_LIST_COLUMNS } from './news.repo';
import {
  COMPETITION_COLUMNS,
  COUNTRY_COLUMNS,
  PLAYER_COLUMNS,
  SEASON_COLUMNS,
  VENUE_COLUMNS,
  indexBy,
  listBy,
  listByIds,
  maybeById,
  uuidList,
} from './related';

const COLUMNS =
  'id,name,short_name,slug,country_id,logo_url,founded_year,venue_id,website_url,is_active';

export interface TeamListInput {
  page: number;
  limit: number;
  q?: string;
  country?: string;
  active?: boolean;
}

async function resolveCountryId(client: DbClient, slug: string): Promise<string | null> {
  const { data, error } = await client.from('countries').select('id').eq('slug', slug).maybeSingle();
  if (error) throw upstream('Failed to load countries');
  return (data as { id: string } | null)?.id ?? null;
}

export async function listTeams(input: TeamListInput) {
  const client = anonClient();
  const page = paginateInput(input.page, input.limit);
  let query = client.from('teams').select(COLUMNS, { count: 'exact' });

  if (input.q) {
    const term = escapeIlike(input.q);
    if (term.length > 0) query = query.or(`name.ilike.%${term}%,short_name.ilike.%${term}%`);
  }
  if (input.country) {
    const id = await resolveCountryId(client, input.country);
    if (!id) return { rows: [], pagination: buildPagination(0, page) };
    query = query.eq('country_id', id);
  }
  if (input.active !== undefined) query = query.eq('is_active', input.active);

  const { data, error, count } = await query
    .order('name', { ascending: true })
    .order('id', { ascending: true })
    .range(page.from, page.to);
  if (error) throw upstream('Failed to load teams');
  return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
}

export async function getTeamBySlug(slug: string) {
  const { data, error } = await anonClient().from('teams').select(COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw upstream('Failed to load team');
  if (!data) throw notFound('Team');
  return data;
}

const HISTORY_COLUMNS = 'id,player_id,team_id,season_id,joined_at,left_at,shirt_number,is_current';

async function teamMatches(
  client: DbClient,
  teamId: string,
  upcoming: boolean,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const now = new Date().toISOString();
  let query = client
    .from('matches')
    .select(MATCH_COLUMNS)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
  query = upcoming
    ? query.gte('scheduled_at', now).order('scheduled_at', { ascending: true })
    : query.lte('scheduled_at', now).order('scheduled_at', { ascending: false });
  const { data, error } = await query.order('id', { ascending: upcoming }).range(0, limit - 1);
  if (error) throw upstream('Failed to load team matches');
  return ((data as unknown as Record<string, unknown>[] | null) ?? []);
}

async function publishedArticlesFor(
  client: DbClient,
  relationTable: string,
  column: string,
  entityId: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const { data: links, error: linkError } = await client
    .from(relationTable)
    .select('article_id')
    .eq(column, entityId)
    .range(0, 199);
  if (linkError) throw upstream('Failed to load article relations');
  const ids = ((links as Array<{ article_id: string }> | null) ?? []).map((row) => row.article_id);
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

export interface TeamDetails {
  team: Record<string, unknown>;
  country: Record<string, unknown> | null;
  venue: Record<string, unknown> | null;
  competitions: Record<string, unknown>[];
  seasons: Record<string, unknown>[];
  upcomingMatches: Record<string, unknown>[];
  recentMatches: Record<string, unknown>[];
  articles: Record<string, unknown>[];
  squad: Array<Record<string, unknown> & { player: Record<string, unknown> | null }>;
  /** Canonical team_competitions rows, so a consumer never infers participation. */
  participation: Array<{ competition_id: string; season_id: string }>;
}

/**
 * Team page in fixed batched rounds — no per-row queries. The country and venue
 * are single-row lookups issued in the same parallel round, so the cost stays
 * constant regardless of squad or fixture size.
 */
export async function getTeamDetails(slug: string): Promise<TeamDetails> {
  const client = anonClient();
  const team = (await getTeamBySlug(slug)) as unknown as Record<string, unknown>;
  const teamId = String(team.id);

  const [country, venue, links, upcomingMatches, recentMatches, history, articles] = await Promise.all([
    maybeById(client, 'countries', COUNTRY_COLUMNS, team.country_id as string | null),
    maybeById(client, 'venues', VENUE_COLUMNS, team.venue_id as string | null),
    // Grows with every season the team has contested.
    listBy(client, 'team_competitions', 'team_id,competition_id,season_id', 'team_id', teamId, undefined, 200),
    teamMatches(client, teamId, true, 5),
    teamMatches(client, teamId, false, 5),
    // A long-established club has thousands of players in its all-time history.
    // This was previously unbounded, which made the public team page payload
    // (and the player lookup below) grow without limit.
    listBy(client, 'player_team_history', HISTORY_COLUMNS, 'team_id', teamId, undefined, 500),
    publishedArticlesFor(client, 'article_teams', 'team_id', teamId, 5),
  ]);

  const [competitions, seasons, players] = await Promise.all([
    listByIds(
      client,
      'competitions',
      COMPETITION_COLUMNS,
      uuidList(links.map((l) => l.competition_id)),
      undefined,
      200,
    ),
    listByIds(
      client,
      'seasons',
      SEASON_COLUMNS,
      uuidList(links.map((l) => l.season_id)),
      undefined,
      200,
    ),
    listByIds(
      client,
      'players',
      PLAYER_COLUMNS,
      uuidList(history.map((h) => h.player_id)),
      undefined,
      300,
    ),
  ]);
  const playerIndex = indexBy(players);

  return {
    team,
    country,
    venue,
    competitions,
    seasons,
    upcomingMatches,
    recentMatches,
    articles,
    squad: history.map((h) => ({ ...h, player: playerIndex.get(String(h.player_id)) ?? null })),
    participation: links.map((l) => ({
      competition_id: String(l.competition_id),
      season_id: String(l.season_id),
    })),
  };
}

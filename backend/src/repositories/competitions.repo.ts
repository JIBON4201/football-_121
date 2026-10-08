import { notFound, upstream } from '../lib/errors';
import { buildPagination, paginateInput } from '../lib/pagination';
import { anonClient, type DbClient } from '../lib/supabase';
import { escapeIlike } from '../lib/validate';
import { MATCH_COLUMNS } from './matches.repo';
import { ARTICLE_LIST_COLUMNS } from './news.repo';
import { SEASON_COLUMNS, TEAM_COLUMNS, COUNTRY_COLUMNS, listBy, listByIds, maybeById, uuidList } from './related';

const COLUMNS = 'id,name,short_name,slug,country_id,logo_url,type,gender,is_active';

export interface CompetitionListInput {
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

export async function listCompetitions(input: CompetitionListInput) {
  const client = anonClient();
  const page = paginateInput(input.page, input.limit);
  let query = client.from('competitions').select(COLUMNS, { count: 'exact' });

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
  if (error) throw upstream('Failed to load competitions');
  return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
}

export async function getCompetitionBySlug(slug: string) {
  const { data, error } = await anonClient()
    .from('competitions')
    .select(COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw upstream('Failed to load competition');
  if (!data) throw notFound('Competition');
  return data;
}

async function competitionMatches(
  client: DbClient,
  competitionId: string,
  upcoming: boolean,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const now = new Date().toISOString();
  let query = client.from('matches').select(MATCH_COLUMNS).eq('competition_id', competitionId);
  query = upcoming
    ? query.gte('scheduled_at', now).order('scheduled_at', { ascending: true })
    : query.lte('scheduled_at', now).order('scheduled_at', { ascending: false });
  const { data, error } = await query.order('id', { ascending: upcoming }).range(0, limit - 1);
  if (error) throw upstream('Failed to load competition matches');
  return ((data as unknown as Record<string, unknown>[] | null) ?? []);
}

async function publishedArticlesFor(
  client: DbClient,
  competitionId: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const { data: links, error: linkError } = await client
    .from('article_competitions')
    .select('article_id')
    .eq('competition_id', competitionId)
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

export interface CompetitionDetails {
  competition: Record<string, unknown>;
  country: Record<string, unknown> | null;
  seasons: Record<string, unknown>[];
  teams: Record<string, unknown>[];
  upcomingMatches: Record<string, unknown>[];
  recentMatches: Record<string, unknown>[];
  articles: Record<string, unknown>[];
}

/**
 * Competition page in fixed batched rounds. Standings live behind their own
 * endpoint (`/competitions/:slug/standings`) so this payload stays cacheable
 * on the long static TTL while a live table can use a shorter one.
 */
export async function getCompetitionDetails(slug: string): Promise<CompetitionDetails> {
  const client = anonClient();
  const competition = (await getCompetitionBySlug(slug)) as unknown as Record<string, unknown>;
  const competitionId = String(competition.id);

  const [country, seasons, links, upcomingMatches, recentMatches, articles] = await Promise.all([
    maybeById(client, 'countries', COUNTRY_COLUMNS, competition.country_id as string | null),
    listBy(
      client,
      'seasons',
      SEASON_COLUMNS,
      'competition_id',
      competitionId,
      { col: 'start_date', asc: false },
      // Newest-first; no competition page needs its full historical season list.
      50,
    ),
    // Grows with every season a competition has ever run. Bounded so the
    // payload (and the follow-up team lookup) cannot grow without limit.
    listBy(
      client,
      'team_competitions',
      'team_id,competition_id,season_id',
      'competition_id',
      competitionId,
      undefined,
      200,
    ),
    competitionMatches(client, competitionId, true, 10),
    competitionMatches(client, competitionId, false, 10),
    publishedArticlesFor(client, competitionId, 5),
  ]);

  const teams = await listByIds(
    client,
    'teams',
    TEAM_COLUMNS,
    uuidList(links.map((l) => l.team_id)),
    { col: 'name', asc: true },
    200,
  );

  return { competition, country, seasons, teams, upcomingMatches, recentMatches, articles };
}

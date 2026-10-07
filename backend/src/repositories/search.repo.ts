import { upstream } from '../lib/errors';
import { anonClient, type DbClient } from '../lib/supabase';

export const MAX_SEARCH_TOKENS = 5;
const MAX_RESOLVED_IDS = 10;

const TEAM_SEARCH_COLUMNS = 'id,name,short_name,slug,logo_url';
const PLAYER_SEARCH_COLUMNS = 'id,display_name,first_name,last_name,slug,photo_url,position';
const COMPETITION_SEARCH_COLUMNS = 'id,name,short_name,slug,logo_url,country_id';
const MATCH_SEARCH_COLUMNS =
  'id,slug,competition_id,home_team_id,away_team_id,scheduled_at,status,home_score,away_score';
const ARTICLE_SEARCH_COLUMNS =
  'id,title,slug,excerpt,article_type,published_at,featured_image_id';

/** Split a raw query into safe bounded tokens (only alphanumerics kept). */
export function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.slice(0, 50))
    .filter((token) => token.length >= 2)
    .slice(0, MAX_SEARCH_TOKENS);
}

function escapeToken(token: string): string {
  return token.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function orIlike(columns: string[], tokens: string[]): string {
  const parts: string[] = [];
  for (const col of columns) {
    for (const token of tokens) parts.push(`${col}.ilike.%${escapeToken(token)}%`);
  }
  return parts.join(',');
}

async function run<T>(table: string, build: (client: DbClient) => PromiseLike<unknown>): Promise<T[]> {
  const { data, error } = (await build(anonClient())) as unknown as {
    data: T[] | null;
    error: unknown;
  };
  if (error) throw upstream(`Search failed on ${table}`);
  return data ?? [];
}

export function searchTeamsRaw(client: DbClient, tokens: string[], limit: number) {
  if (tokens.length === 0) return Promise.resolve([]);
  return client
    .from('teams')
    .select(TEAM_SEARCH_COLUMNS)
    .or(orIlike(['name', 'short_name', 'slug'], tokens))
    .range(0, limit - 1);
}

export async function searchTeams(tokens: string[], limit: number) {
  return run<Record<string, unknown>>('teams', (client) => searchTeamsRaw(client, tokens, limit));
}

export async function searchPlayers(tokens: string[], limit: number) {
  if (tokens.length === 0) return [];
  return run<Record<string, unknown>>('players', (client) =>
    client
      .from('players')
      .select(PLAYER_SEARCH_COLUMNS)
      .or(orIlike(['display_name', 'first_name', 'last_name', 'slug'], tokens))
      .range(0, limit - 1),
  );
}

export async function searchCompetitions(tokens: string[], limit: number) {
  if (tokens.length === 0) return [];
  return run<Record<string, unknown>>('competitions', (client) =>
    client
      .from('competitions')
      .select(COMPETITION_SEARCH_COLUMNS)
      .or(orIlike(['name', 'short_name', 'slug'], tokens))
      .range(0, limit - 1),
  );
}

export interface ArticleSearchFilters {
  from?: string;
  to?: string;
  relation?: { table: string; column: string; entityId: string };
}

export async function searchArticles(
  tokens: string[],
  limit: number,
  filters: ArticleSearchFilters = {},
) {
  if (tokens.length === 0) return [];
  const client = anonClient();
  let articleIds: string[] | null = null;
  if (filters.relation) {
    const { data, error } = await client
      .from(filters.relation.table)
      .select('article_id')
      .eq(filters.relation.column, filters.relation.entityId)
      // Bounded in the database: a heavily-linked entity (a big club) would
      // otherwise return thousands of rows before the JS slice trims them.
      .range(0, 199);
    if (error) throw upstream('Search failed on article relations');
    articleIds = ((data as Array<{ article_id: string }> | null) ?? [])
      .map((row) => row.article_id)
      .slice(0, 200);
    if (articleIds.length === 0) return [];
  }
  return run<Record<string, unknown>>('articles', (inner) => {
    let query = inner
      .from('articles')
      .select(ARTICLE_SEARCH_COLUMNS)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .or(orIlike(['title', 'excerpt'], tokens));
    if (articleIds) query = query.in('id', articleIds);
    if (filters.from) query = query.gte('published_at', `${filters.from}T00:00:00.000Z`);
    if (filters.to) query = query.lte('published_at', `${filters.to}T23:59:59.999Z`);
    return query.range(0, limit - 1);
  });
}

export interface MatchSearchFilters {
  competitionId?: string;
  teamId?: string;
  from?: string;
  to?: string;
}

export async function searchMatches(tokens: string[], limit: number, filters: MatchSearchFilters = {}) {
  if (tokens.length === 0) return [];
  const client = anonClient();

  // Resolve entity names to canonical IDs (bounded) for home/away/competition matching.
  const [teamRows, compRows] = await Promise.all([
    searchTeams(tokens, MAX_RESOLVED_IDS),
    searchCompetitions(tokens, MAX_RESOLVED_IDS),
  ]);
  const teamIds = [...new Set(teamRows.map((row) => String(row.id)))].slice(0, MAX_RESOLVED_IDS);
  const compIds = [...new Set(compRows.map((row) => String(row.id)))].slice(0, MAX_RESOLVED_IDS);

  const branches = tokens.map((token) => `slug.ilike.%${escapeToken(token)}%`);
  for (const id of teamIds) branches.push(`home_team_id.eq.${id}`, `away_team_id.eq.${id}`);
  for (const id of compIds) branches.push(`competition_id.eq.${id}`);

  const rows = await run<Record<string, unknown>>('matches', (inner) => {
    let query = inner.from('matches').select(MATCH_SEARCH_COLUMNS).or(branches.join(','));
    if (filters.competitionId) query = query.eq('competition_id', filters.competitionId);
    if (filters.from) query = query.gte('scheduled_at', `${filters.from}T00:00:00.000Z`);
    if (filters.to) query = query.lte('scheduled_at', `${filters.to}T23:59:59.999Z`);
    // teamId is a disjunction over two columns that PostgREST cannot AND with
    // the relevance OR-group; it is applied in the service over bounded rows.
    return query.range(0, limit - 1);
  });

  if (filters.teamId) {
    return rows.filter(
      (row) => String(row.home_team_id) === filters.teamId || String(row.away_team_id) === filters.teamId,
    );
  }
  return rows;
}

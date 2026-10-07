import { notFound, upstream } from '../lib/errors';
import { buildPagination, paginateInput } from '../lib/pagination';
import { anonClient, type DbClient } from '../lib/supabase';
import { escapeIlike } from '../lib/validate';

export const ARTICLE_LIST_COLUMNS =
  'id,title,slug,excerpt,article_type,published_at,is_featured,is_breaking,view_count';
const DETAIL_COLUMNS = `${ARTICLE_LIST_COLUMNS},content`;

const PUBLIC_LIST_FIELDS = [
  'id',
  'title',
  'slug',
  'excerpt',
  'article_type',
  'published_at',
  'is_featured',
  'is_breaking',
  'view_count',
] as const;

const PUBLIC_DETAIL_FIELDS = [...PUBLIC_LIST_FIELDS, 'content'] as const;

function pickPublic<T extends Record<string, unknown>>(row: T, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = (row as Record<string, unknown>)[field] ?? null;
  // Preserve null vs missing semantics for optional text fields.
  return out;
}

export interface NewsListInput {
  page: number;
  limit: number;
  type?: string;
  category?: string;
  tag?: string;
  team?: string;
  player?: string;
  competition?: string;
  match?: string;
  q?: string;
  sort?: 'asc' | 'desc';
  breaking?: boolean;
  featured?: boolean;
  from?: string;
  to?: string;
}

async function resolveId(client: DbClient, table: string, slug: string): Promise<string | null> {
  const { data, error } = await client.from(table).select('id').eq('slug', slug).maybeSingle();
  if (error) throw upstream(`Failed to load ${table}`);
  return (data as { id: string } | null)?.id ?? null;
}

async function articleIdsFor(
  client: DbClient,
  relationTable: string,
  column: string,
  entityId: string,
): Promise<string[]> {
  const { data, error } = await client.from(relationTable).select('article_id').eq(column, entityId).range(0, 199);
  if (error) throw upstream('Failed to load article relations');
  return ((data as Array<{ article_id: string }> | null) ?? []).map((row) => row.article_id).slice(0, 200);
}

/** Published content only — drafts are never exposed through this layer. */
export async function listNews(input: NewsListInput) {
  const client = anonClient();
  const page = paginateInput(input.page, input.limit);

  const relationFilters: Array<[string, string, string | null | undefined]> = [
    ['article_categories', 'category_id', input.category ? await resolveId(client, 'categories', input.category) : undefined],
    ['article_tags', 'tag_id', input.tag ? await resolveId(client, 'tags', input.tag) : undefined],
    ['article_teams', 'team_id', input.team ? await resolveId(client, 'teams', input.team) : undefined],
    ['article_players', 'player_id', input.player ? await resolveId(client, 'players', input.player) : undefined],
    ['article_competitions', 'competition_id', input.competition ? await resolveId(client, 'competitions', input.competition) : undefined],
    ['article_matches', 'match_id', input.match ? await resolveId(client, 'matches', input.match) : undefined],
  ];

  let query = client
    .from('articles')
    .select(ARTICLE_LIST_COLUMNS, { count: 'exact' })
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .lte('published_at', new Date().toISOString());

  if (input.type) query = query.eq('article_type', input.type);
  if (input.breaking !== undefined) query = query.eq('is_breaking', input.breaking);
  if (input.featured !== undefined) query = query.eq('is_featured', input.featured);
  if (input.from) query = query.gte('published_at', `${input.from}T00:00:00.000Z`);
  if (input.to) query = query.lte('published_at', `${input.to}T23:59:59.999Z`);

  for (const [relationTable, column, entityId] of relationFilters) {
    if (entityId === null) return { rows: [], ...page, total: 0, pagination: buildPagination(0, page) };
    if (entityId === undefined) continue;
    const ids = await articleIdsFor(client, relationTable, column, entityId);
    if (ids.length === 0) return { rows: [], ...page, total: 0, pagination: buildPagination(0, page) };
    query = query.in('id', ids);
  }

  if (input.q) {
    const term = escapeIlike(input.q);
    if (term.length > 0) query = query.or(`title.ilike.%${term}%,excerpt.ilike.%${term}%`);
  }

  const ascending = input.sort === 'asc';
  const { data, error, count } = await query
    .order('published_at', { ascending })
    .order('id', { ascending })
    .range(page.from, page.to);

  if (error) throw upstream('Failed to load news');
  const rows = (((data as unknown[]) ?? []) as Array<Record<string, unknown>>).map((row) =>
    pickPublic(row, PUBLIC_LIST_FIELDS),
  );
  return { rows, pagination: buildPagination(count ?? 0, page) };
}

export async function getNewsBySlug(slug: string) {
  const { data, error } = await anonClient()
    .from('articles')
    .select(DETAIL_COLUMNS)
    .eq('slug', slug)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .lte('published_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw upstream('Failed to load article');
  if (!data) throw notFound('Article');
  return pickPublic(data as Record<string, unknown>, PUBLIC_DETAIL_FIELDS);
}

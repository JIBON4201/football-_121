import { notFound, upstream } from '../lib/errors';
import { serviceClient, type DbClient } from '../lib/supabase';

export interface ArticleRow {
  id: string;
  author_id: string | null;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  status: string;
  article_type: string;
  featured_image_id: string | null;
  published_at: string | null;
  scheduled_at: string | null;
  is_featured: boolean;
  is_breaking: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
}

function toRow(data: unknown): ArticleRow {
  return data as ArticleRow;
}

export async function getArticleById(id: string, client: DbClient = serviceClient()): Promise<ArticleRow> {
  const { data, error } = await client.from('articles').select('*').eq('id', id).maybeSingle();
  if (error) throw upstream('Failed to load article');
  if (!data) throw notFound('Article');
  return toRow(data);
}

export async function getArticleBySlugInternal(
  slug: string,
  client: DbClient = serviceClient(),
): Promise<ArticleRow | null> {
  const { data, error } = await client.from('articles').select('*').eq('slug', slug).maybeSingle();
  if (error) throw upstream('Failed to load article');
  return data ? toRow(data) : null;
}

export async function slugTaken(slug: string, excludeId?: string, client: DbClient = serviceClient()): Promise<boolean> {
  let query = client.from('articles').select('id').eq('slug', slug).limit(1);
  const { data, error } = await query;
  if (error) throw upstream('Failed to check slug');
  const rows = ((data as Array<{ id: string }> | null) ?? []).filter((r) => r.id !== excludeId);
  return rows.length > 0;
}

export interface CreateArticleInput {
  /** Nullable: the synthetic dev-bypass identity has no profiles row. */
  authorId: string | null;
  title: string;
  slug: string;
  excerpt?: string | null;
  content: string;
  articleType: string;
  featuredImageId?: string | null;
  isFeatured?: boolean;
  isBreaking?: boolean;
  status?: string;
}

export async function insertArticle(
  input: CreateArticleInput,
  client: DbClient = serviceClient(),
): Promise<ArticleRow> {
  const { data, error } = await client
    .from('articles')
    .insert({
      author_id: input.authorId,
      title: input.title,
      slug: input.slug,
      excerpt: input.excerpt ?? null,
      content: input.content,
      article_type: input.articleType,
      featured_image_id: input.featuredImageId ?? null,
      status: input.status ?? 'draft',
      is_featured: input.isFeatured ?? false,
      is_breaking: input.isBreaking ?? false,
    })
    .select('*');
  if (error || !data?.length) throw upstream('Failed to create article');
  return toRow((data as unknown[])[0]);
}

export async function updateArticleRow(
  id: string,
  patch: Record<string, unknown>,
  client: DbClient = serviceClient(),
): Promise<ArticleRow> {
  const { data, error } = await client.from('articles').update(patch).eq('id', id).select('*');
  if (error) throw upstream('Failed to update article');
  const rows = ((data as unknown[]) ?? []).map(toRow);
  if (!rows.length) throw notFound('Article');
  return rows[0];
}

export async function deleteArticleRow(id: string, client: DbClient = serviceClient()): Promise<void> {
  const { data, error } = await client.from('articles').delete().eq('id', id).select('id');
  if (error) throw upstream('Failed to delete article');
  if (!((data as unknown[]) ?? []).length) throw notFound('Article');
}

export async function listEditorialArticles(
  filter: { status?: string; authorId?: string; limit?: number },
  client: DbClient = serviceClient(),
): Promise<ArticleRow[]> {
  let query = client.from('articles').select('*');
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.authorId) query = query.eq('author_id', filter.authorId);
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .range(0, (filter.limit ?? 50) - 1);
  if (error) throw upstream('Failed to load articles');
  return ((data as unknown[]) ?? []).map(toRow);
}

export async function listDueScheduledArticles(
  nowIso: string,
  limit = 50,
  client: DbClient = serviceClient(),
): Promise<ArticleRow[]> {
  const { data, error } = await client
    .from('articles')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .range(0, limit - 1);
  if (error) throw upstream('Failed to load scheduled articles');
  return ((data as unknown[]) ?? []).map(toRow);
}

// --- Relationships (categories/tags/teams/players/competitions/matches) ---

const REL_TABLES = {
  categories: { table: 'article_categories', articleCol: 'article_id', entityCol: 'category_id', entityTable: 'categories' },
  tags: { table: 'article_tags', articleCol: 'article_id', entityCol: 'tag_id', entityTable: 'tags' },
  teams: { table: 'article_teams', articleCol: 'article_id', entityCol: 'team_id', entityTable: 'teams' },
  players: { table: 'article_players', articleCol: 'article_id', entityCol: 'player_id', entityTable: 'players' },
  competitions: {
    table: 'article_competitions',
    articleCol: 'article_id',
    entityCol: 'competition_id',
    entityTable: 'competitions',
  },
  matches: { table: 'article_matches', articleCol: 'article_id', entityCol: 'match_id', entityTable: 'matches' },
} as const;

export type RelationKind = keyof typeof REL_TABLES;

export async function getRelatedIds(
  kind: RelationKind,
  articleId: string,
  client: DbClient = serviceClient(),
): Promise<string[]> {
  const rel = REL_TABLES[kind];
  // Relations per article are few, but the query is bounded regardless: a
// long-running article can accumulate many player/team links over time.
  const { data, error } = await client
    .from(rel.table)
    .select(rel.entityCol)
    .eq(rel.articleCol, articleId)
    .range(0, 199);
  if (error) throw upstream('Failed to load article relations');
  return (((data as Array<Record<string, string>> | null) ?? []).map((r) => r[rel.entityCol])).filter(Boolean);
}

export async function entityExists(
  entityTable: string,
  id: string,
  client: DbClient = serviceClient(),
): Promise<{ id: string; isActive?: boolean } | null> {
  const { data, error } = await client.from(entityTable).select('id,is_active').eq('id', id).maybeSingle();
  if (error) throw upstream(`Failed to load ${entityTable}`);
  return (data as { id: string; isActive?: boolean; is_active?: boolean } | null)
    ? { id: String((data as { id: string }).id), isActive: (data as { is_active?: boolean }).is_active }
    : null;
}

export async function replaceRelations(
  kind: RelationKind,
  articleId: string,
  entityIds: string[],
  client: DbClient = serviceClient(),
): Promise<string[]> {
  const rel = REL_TABLES[kind];
  const unique = [...new Set(entityIds)];
  await client.from(rel.table).delete().eq(rel.articleCol, articleId);
  if (unique.length === 0) return [];
  const rows = unique.map((entityId) => ({ [rel.articleCol]: articleId, [rel.entityCol]: entityId }));
  const { error } = await client.from(rel.table).insert(rows);
  if (error) throw upstream('Failed to save article relations');
  return unique;
}

// --- Media / SEO / redirects / audit ---

export async function getMediaById(id: string, client: DbClient = serviceClient()) {
  const { data, error } = await client.from('media').select('*').eq('id', id).maybeSingle();
  if (error) throw upstream('Failed to load media');
  return (data as Record<string, unknown> | null) ?? null;
}

export async function getSeoForArticle(articleId: string, client: DbClient = serviceClient()) {
  const { data, error } = await client
    .from('seo_metadata')
    .select('*')
    .eq('entity_type', 'article')
    .eq('entity_id', articleId)
    .maybeSingle();
  if (error) throw upstream('Failed to load SEO metadata');
  return (data as Record<string, unknown> | null) ?? null;
}

export async function upsertSeoForArticle(
  articleId: string,
  seo: Record<string, unknown>,
  client: DbClient = serviceClient(),
) {
  const { data, error } = await client
    .from('seo_metadata')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert({ entity_type: 'article', entity_id: articleId, ...seo } as any, {
      onConflict: 'entity_type,entity_id',
    })
    .select('*');
  if (error) throw upstream('Failed to save SEO metadata');
  return ((data as unknown[]) ?? [])[0] ?? null;
}

export async function findActiveRedirect(sourcePath: string, client: DbClient = serviceClient()) {
  const { data, error } = await client
    .from('redirects')
    .select('*')
    .eq('source_path', sourcePath)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw upstream('Failed to load redirects');
  return (data as Record<string, unknown> | null) ?? null;
}

export async function createRedirect(
  sourcePath: string,
  destinationPath: string,
  client: DbClient = serviceClient(),
) {
  const { data, error } = await client
    .from('redirects')
    .insert({ source_path: sourcePath, destination_path: destinationPath, status_code: 301, is_active: true })
    .select('*');
  if (error) throw upstream('Failed to create redirect');
  return ((data as unknown[]) ?? [])[0] ?? null;
}

export async function deactivateRedirectsFor(destinationPath: string, client: DbClient = serviceClient()) {
  // Break chains pointing at the old URL: retarget them to the newest destination.
  //
  // Previously this read every matching row (unbounded) and then issued one
  // UPDATE per row. Every row receives the same value, so a single bulk
  // statement replaces the read-then-write loop. Failure tolerance is
  // unchanged: redirect bookkeeping must not break the redirect write itself.
  const { error } = await client
    .from('redirects')
    .update({ is_active: false })
    .eq('destination_path', destinationPath);
  void error;
}

export async function recordAudit(
  action: string,
  entityId: string,
  userId: string | null,
  details?: { oldData?: unknown; newData?: unknown },
  client: DbClient = serviceClient(),
): Promise<void> {
  await client
    .from('audit_logs')
    .insert({
      user_id: userId,
      action,
      entity_type: 'article',
      entity_id: entityId,
      old_data: (details?.oldData as Record<string, unknown> | null) ?? null,
      new_data: (details?.newData as Record<string, unknown> | null) ?? null,
    });
}

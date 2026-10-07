import { z, ZodError } from 'zod';
import { config } from '../config';
import { invalidateNamespace } from '../lib/cache';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  toServiceError,
  upstream,
} from '../lib/errors';
import { log } from '../lib/logger';
import { getUserRoles } from '../lib/roles';
import { serviceClient, type DbClient } from '../lib/supabase';
import { canonicalUrl } from '../lib/urls';
import {
  ARTICLE_TYPES,
  articleContentSchema,
  articleExcerptSchema,
  articleTitleSchema,
  articleTypeSchema,
  canonicalUrlSchema,
  sanitizeContent,
  slugifyTitle,
} from '../lib/validate';
import {
  createRedirect,
  deactivateRedirectsFor,
  entityExists,
  findActiveRedirect,
  getArticleById,
  getArticleBySlugInternal,
  getMediaById,
  getRelatedIds,
  getSeoForArticle,
  insertArticle,
  listDueScheduledArticles,
  listEditorialArticles,
  recordAudit,
  replaceRelations,
  slugTaken,
  updateArticleRow,
  deleteArticleRow,
  upsertSeoForArticle,
  type ArticleRow,
  type RelationKind,
} from '../repositories/articles.repo';

export const ARTICLE_STATUSES = ['draft', 'review', 'scheduled', 'published', 'archived'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

/** Strict publishing state machine. No bypasses. */
const TRANSITIONS: Record<ArticleStatus, ArticleStatus[]> = {
  draft: ['review', 'archived'],
  review: ['draft', 'published', 'scheduled', 'archived'],
  scheduled: ['published', 'draft', 'archived'],
  published: ['archived'],
  archived: ['draft'],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = (TRANSITIONS as Record<string, string[]>)[from] ?? [];
  return allowed.includes(to);
}

const EDITOR_ROLES = ['super_admin', 'admin', 'editor'];
const AUTHOR_ROLES = ['super_admin', 'admin', 'editor', 'author'];

function isEditor(roles: string[]): boolean {
  return roles.some((r) => (EDITOR_ROLES as string[]).includes(r));
}

function canWrite(roles: string[]): boolean {
  return roles.some((r) => (AUTHOR_ROLES as string[]).includes(r));
}

async function rolesFor(userId: string): Promise<string[]> {
  // DEV-ONLY: the synthetic bypass identity has no profiles/user_roles rows, so
  // its editorial role union comes from the bypass config, not the DB.
  // In production `adminBypassEnabled()` is false and this branch never runs.
  if (userId === '00000000-0000-0000-0000-000000000000') {
    try {
      const { adminBypassEnabled } = await import('../admin/bypass');
      if (adminBypassEnabled()) return ['super_admin', 'admin', 'editor', 'author', 'moderator'];
    } catch {
      // Fall through to the real role lookup.
    }
  }
  return getUserRoles(userId);
}

function ensureCanWrite(roles: string[]): void {
  if (!canWrite(roles)) throw forbidden('Editorial access requires author, editor or admin role');
}

function ensureEditor(roles: string[]): void {
  if (!isEditor(roles)) throw forbidden('This operation requires editor role or above');
}

function canEditRow(userId: string, roles: string[], article: ArticleRow): boolean {
  if (isEditor(roles)) return true;
  if (roles.includes('author') && article.author_id === userId) {
    return article.status === 'draft' || article.status === 'review';
  }
  return false;
}

async function invalidateArticleCaches(): Promise<void> {
  await invalidateNamespace('news').catch(() => undefined);
  await invalidateNamespace('search').catch(() => undefined);
  await invalidateNamespace('seo').catch(() => undefined);
  await invalidateNamespace('sitemap').catch(() => undefined);
}

async function ensureUniqueSlug(base: string, excludeId?: string, client?: DbClient): Promise<string> {
  const root = base.slice(0, 120) || 'article';
  let candidate = root;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const taken = await slugTaken(candidate, excludeId, client);
    if (!taken) return candidate;
    candidate = `${root}-${attempt + 2}`;
  }
  throw conflict('Slug collision: unable to generate unique slug');
}

function validateBreaking(articleType: string, isBreaking: boolean): void {
  if (articleType === 'breaking_news' && !isBreaking) {
    throw badRequest('breaking_news articles must have is_breaking=true');
  }
  if (isBreaking && articleType !== 'breaking_news') {
    throw badRequest('is_breaking=true requires article_type=breaking_news');
  }
}

async function validateFeaturedImage(
  featuredImageId: string | null | undefined,
  client: DbClient,
): Promise<void> {
  if (!featuredImageId) return;
  const media = await getMediaById(featuredImageId, client);
  if (!media) throw badRequest('Featured image does not exist');
  const mime = String(media.mime_type ?? '');
  if (!mime.startsWith('image/')) throw badRequest('Featured image must be an image type');
  if (!media.public_url && !media.storage_path) throw badRequest('Featured image is not accessible');
}

const seoInputSchema = z.object({
  metaTitle: z.string().trim().max(70).optional(),
  metaDescription: z.string().trim().max(160).optional(),
  canonicalUrl: canonicalUrlSchema,
  robotsIndex: z.boolean().optional(),
  robotsFollow: z.boolean().optional(),
  ogTitle: z.string().trim().max(200).optional(),
  ogDescription: z.string().max(2000).optional(),
  ogImage: z.string().trim().max(500).optional(),
  twitterTitle: z.string().trim().max(200).optional(),
  twitterDescription: z.string().max(2000).optional(),
  twitterImage: z.string().trim().max(500).optional(),
  schemaType: z.string().trim().max(100).optional(),
});

function seoToRow(articleId: string, input: z.infer<typeof seoInputSchema>): Record<string, unknown> {
  void articleId;
  const row: Record<string, unknown> = {};
  if (input.metaTitle !== undefined) row.meta_title = input.metaTitle || null;
  if (input.metaDescription !== undefined) row.meta_description = input.metaDescription || null;
  if (input.canonicalUrl !== undefined) row.canonical_url = input.canonicalUrl || null;
  if (input.robotsIndex !== undefined) row.robots_index = input.robotsIndex;
  if (input.robotsFollow !== undefined) row.robots_follow = input.robotsFollow;
  if (input.ogTitle !== undefined) row.og_title = input.ogTitle || null;
  if (input.ogDescription !== undefined) row.og_description = input.ogDescription || null;
  if (input.ogImage !== undefined) row.og_image = input.ogImage || null;
  if (input.twitterTitle !== undefined) row.twitter_title = input.twitterTitle || null;
  if (input.twitterDescription !== undefined) row.twitter_description = input.twitterDescription || null;
  if (input.twitterImage !== undefined) row.twitter_image = input.twitterImage || null;
  if (input.schemaType !== undefined) row.schema_type = input.schemaType || null;
  return row;
}

async function validateReferences(
  categoryIds: string[] | undefined,
  tagIds: string[] | undefined,
  client: DbClient,
): Promise<void> {
  if (categoryIds) {
    for (const id of categoryIds) {
      const row = await entityExists('categories', id, client);
      if (!row) throw badRequest(`Category ${id} does not exist`);
      const full = await client.from('categories').select('id,is_active').eq('id', id).maybeSingle();
      const data = (full as { data?: { is_active?: boolean } }).data;
      if (data && data.is_active === false) throw badRequest(`Category ${id} is not active`);
    }
  }
  if (tagIds) {
    for (const id of tagIds) {
      const row = await entityExists('tags', id, client);
      if (!row) throw badRequest(`Tag ${id} does not exist`);
    }
  }
}

async function validateEntityLinks(
  kind: RelationKind,
  ids: string[] | undefined,
  client: DbClient,
): Promise<void> {
  if (!ids) return;
  const tableMap: Record<RelationKind, string> = {
    categories: 'categories',
    tags: 'tags',
    teams: 'teams',
    players: 'players',
    competitions: 'competitions',
    matches: 'matches',
  };
  for (const id of ids) {
    const row = await entityExists(tableMap[kind], id, client);
    if (!row) throw badRequest(`Linked ${kind} record ${id} does not exist`);
  }
}

function toPublicArticle(row: ArticleRow): Record<string, unknown> {
  // Never expose internal editorial metadata publicly.
  const { author_id: _a, status: _s, scheduled_at: _sc, ...rest } = row as unknown as Record<string, unknown>;
  void _a;
  void _s;
  void _sc;
  return rest;
}

export interface CreateArticleRequest {
  title: string;
  slug?: string;
  excerpt?: string;
  content: string;
  articleType?: string;
  categoryIds?: string[];
  tagIds?: string[];
  teamIds?: string[];
  playerIds?: string[];
  competitionIds?: string[];
  matchIds?: string[];
  featuredImageId?: string | null;
  isFeatured?: boolean;
  isBreaking?: boolean;
  seo?: z.infer<typeof seoInputSchema>;
}

export interface UpdateArticleRequest {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  content?: string;
  articleType?: string;
  featuredImageId?: string | null;
  isFeatured?: boolean;
  isBreaking?: boolean;
}

async function guarded<T>(loader: () => Promise<T>, message: string): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, message);
  }
}

export const articlesService = {
  async create(userId: string, input: CreateArticleRequest): Promise<ArticleRow> {
    return guarded(async () => {
      const roles = await rolesFor(userId);
      ensureCanWrite(roles);
      const title = articleTitleSchema.parse(input.title);
      const content = articleContentSchema.parse(input.content);
      const excerpt = input.excerpt !== undefined ? articleExcerptSchema.parse(input.excerpt) ?? null : null;
      const articleType = articleTypeSchema.parse(input.articleType ?? 'news');
      const isFeatured = input.isFeatured ?? false;
      const isBreaking = input.isBreaking ?? false;
      validateBreaking(articleType, isBreaking);
      const client = serviceClient();
      await validateFeaturedImage(input.featuredImageId ?? null, client);
      await validateReferences(input.categoryIds, input.tagIds, client);
      await validateEntityLinks('teams', input.teamIds, client);
      await validateEntityLinks('players', input.playerIds, client);
      await validateEntityLinks('competitions', input.competitionIds, client);
      await validateEntityLinks('matches', input.matchIds, client);
      const base = input.slug ? input.slug.toLowerCase() : slugifyTitle(title);
      if (!/^[A-Za-z0-9_.-]+$/.test(base)) throw badRequest('Invalid slug');
      const slug = await ensureUniqueSlug(base, undefined, client);
      const cleanContent = sanitizeContent(content);
      const row = await insertArticle(
        {
          authorId: userId === '00000000-0000-0000-0000-000000000000' ? null : userId,
          title,
          slug,
          excerpt,
          content: cleanContent,
          articleType,
          featuredImageId: input.featuredImageId ?? null,
          isFeatured,
          isBreaking,
          status: 'draft',
        },
        client,
      );
      if (input.categoryIds) await replaceRelations('categories', row.id, input.categoryIds, client);
      if (input.tagIds) await replaceRelations('tags', row.id, input.tagIds, client);
      if (input.teamIds) await replaceRelations('teams', row.id, input.teamIds, client);
      if (input.playerIds) await replaceRelations('players', row.id, input.playerIds, client);
      if (input.competitionIds) await replaceRelations('competitions', row.id, input.competitionIds, client);
      if (input.matchIds) await replaceRelations('matches', row.id, input.matchIds, client);
      if (input.seo) {
        const parsed = seoInputSchema.parse(input.seo);
        await upsertSeoForArticle(row.id, seoToRow(row.id, parsed), client);
      }
      await recordAudit('article.create', row.id, userId, { newData: { title, slug } }, client);
      log({ msg: 'article_created', articleId: row.id, slug, authorId: userId });
      // Drafts are not public; no cache invalidation needed yet.
      return getArticleById(row.id, client);
    }, 'Article service unavailable');
  },

  async getEditorial(userId: string, id: string): Promise<Record<string, unknown>> {
    return guarded(async () => {
      const roles = await rolesFor(userId);
      ensureCanWrite(roles);
      const client = serviceClient();
      const article = await getArticleById(id, client);
      if (!canEditRow(userId, roles, article) && !isEditor(roles)) {
        // Authors may only view their own articles; editors view all.
        if (article.author_id !== userId) throw forbidden('Not your article');
      }
      const [categories, tags, teams, players, competitions, matches, seo] = await Promise.all([
        getRelatedIds('categories', id, client),
        getRelatedIds('tags', id, client),
        getRelatedIds('teams', id, client),
        getRelatedIds('players', id, client),
        getRelatedIds('competitions', id, client),
        getRelatedIds('matches', id, client),
        getSeoForArticle(id, client),
      ]);
      return { ...article, categories, tags, teams, players, competitions, matches, seo };
    }, 'Article service unavailable');
  },

  async listEditorial(
    userId: string,
    filter: { status?: string; mine?: boolean; limit?: number },
  ): Promise<ArticleRow[]> {
    return guarded(async () => {
      const roles = await rolesFor(userId);
      ensureCanWrite(roles);
      if (filter.status && !(ARTICLE_STATUSES as readonly string[]).includes(filter.status)) {
        throw badRequest('Invalid status filter');
      }
      // Authors default to their own articles; editors may list all.
      const authorId = filter.mine || !isEditor(roles) ? userId : undefined;
      return listEditorialArticles({ status: filter.status, authorId, limit: filter.limit ?? 50 });
    }, 'Article service unavailable');
  },

  async update(userId: string, id: string, input: UpdateArticleRequest): Promise<ArticleRow> {
    return guarded(async () => {
      const roles = await rolesFor(userId);
      ensureCanWrite(roles);
      const client = serviceClient();
      const before = await getArticleById(id, client);
      if (!canEditRow(userId, roles, before)) throw forbidden('Cannot edit this article');
      if (before.status === 'published' || before.status === 'scheduled' || before.status === 'archived') {
        // Published/scheduled/archived edits go through explicit lifecycle ops to
        // preserve canonical URLs. Allow only editors for those states.
        if (!isEditor(roles)) throw forbidden('Only editors may edit published content');
      }
      const patch: Record<string, unknown> = {};
      const nextType = input.articleType ?? before.article_type;
      const nextBreaking = input.isBreaking ?? before.is_breaking;
      if (input.articleType !== undefined) patch.article_type = articleTypeSchema.parse(input.articleType);
      validateBreaking(nextType, nextBreaking);
      if (input.title !== undefined) patch.title = articleTitleSchema.parse(input.title);
      if (input.excerpt !== undefined) {
        patch.excerpt = input.excerpt === null ? null : articleExcerptSchema.parse(input.excerpt) ?? null;
      }
      if (input.content !== undefined) patch.content = sanitizeContent(articleContentSchema.parse(input.content));
      if (input.featuredImageId !== undefined) {
        await validateFeaturedImage(input.featuredImageId, client);
        patch.featured_image_id = input.featuredImageId;
      }
      if (input.isFeatured !== undefined) patch.is_featured = Boolean(input.isFeatured);
      if (input.isBreaking !== undefined) patch.is_breaking = Boolean(input.isBreaking);
      const oldSlug = before.slug;
      let slugChanged = false;
      if (input.slug !== undefined && input.slug !== before.slug) {
        if (!/^[A-Za-z0-9_.-]+$/.test(input.slug)) throw badRequest('Invalid slug');
        patch.slug = await ensureUniqueSlug(input.slug.toLowerCase(), id, client);
        slugChanged = true;
      } else if (input.title !== undefined && !input.slug && before.status !== 'published') {
        // Keep drafts in sync with title unless an explicit slug was given.
        // Published slugs stay frozen to preserve canonical URLs.
        const candidate = slugifyTitle(String(patch.title));
        if (candidate !== before.slug) {
          patch.slug = await ensureUniqueSlug(candidate, id, client);
          slugChanged = true;
        }
      }
      if (Object.keys(patch).length === 0) return before;
      const after = await updateArticleRow(id, patch, client);
      if (slugChanged && before.status === 'published') {
        await this.preserveSlugInternal(client, oldSlug, String(after.slug));
      }
      await recordAudit('article.update', id, userId, { oldData: { title: before.title, slug: before.slug }, newData: patch }, client);
      if (after.status === 'published') await invalidateArticleCaches();
      return after;
    }, 'Article service unavailable');
  },

  async preserveSlugInternal(client: DbClient, oldSlug: string, newSlug: string): Promise<void> {
    const sourcePath = `/news/${oldSlug}`;
    const destinationPath = `/news/${newSlug}`;
    if (sourcePath === destinationPath) return;
    const existing = await findActiveRedirect(sourcePath, client);
    if (existing && String(existing.destination_path) === destinationPath) return;
    // Prevent loops: a redirect already pointing back would cycle.
    const reverse = await findActiveRedirect(destinationPath, client);
    if (reverse && String(reverse.destination_path) === sourcePath) {
      await client.from('redirects').update({ is_active: false }).eq('id', String((reverse as { id: string }).id));
    }
    // Collapse chains that would now double-hop through the old URL.
    await deactivateRedirectsFor(sourcePath, client);
    const clash = await findActiveRedirect(destinationPath, client);
    if (clash) {
      await client.from('redirects').update({ is_active: false }).eq('id', String((clash as { id: string }).id));
    }
    await createRedirect(sourcePath, destinationPath, client);
    log({ msg: 'article_redirect', sourcePath, destinationPath });
  },

  async transition(userId: string, id: string, to: ArticleStatus, opts?: { scheduledAt?: string }): Promise<ArticleRow> {
    return guarded(async () => {
      const roles = await rolesFor(userId);
      ensureCanWrite(roles);
      const client = serviceClient();
      const before = await getArticleById(id, client);
      const from = before.status as ArticleStatus;
      if (from === to) return before;
      if (!canTransition(from, to)) {
        throw badRequest(`Invalid transition ${from} → ${to}`);
      }
      // Permission matrix per transition.
      const owner = before.author_id === userId;
      switch (`${from}→${to}`) {
        case 'draft→review':
          if (!owner && !isEditor(roles)) throw forbidden('Only the author or editors may submit for review');
          break;
        case 'review→draft':
          if (!owner && !isEditor(roles)) throw forbidden('Only the author or editors may return to draft');
          break;
        case 'review→published':
        case 'review→scheduled':
        case 'scheduled→published':
          ensureEditor(roles);
          break;
        case 'scheduled→draft':
          if (!owner && !isEditor(roles)) throw forbidden('Only the author or editors may cancel a schedule');
          break;
        case 'draft→archived':
        case 'review→archived':
        case 'scheduled→archived':
        case 'published→archived':
          ensureEditor(roles);
          break;
        case 'archived→draft':
          ensureEditor(roles);
          break;
        default:
          throw badRequest('Transition not permitted');
      }
      if (to === 'scheduled') {
        if (!opts?.scheduledAt) throw badRequest('scheduledAt is required');
        const when = Date.parse(opts.scheduledAt);
        if (Number.isNaN(when)) throw badRequest('Invalid scheduledAt');
        if (when <= Date.now()) throw badRequest('scheduledAt must be in the future');
        await this.validatePublishable(client, before);
        const after = await updateArticleRow(id, { status: 'scheduled', scheduled_at: new Date(when).toISOString() }, client);
        await recordAudit('article.schedule', id, userId, { oldData: { status: from }, newData: { status: to } }, client);
        return after;
      }
      if (to === 'published') {
        return this.publishInternal(client, before, userId);
      }
      if ((from as string) === 'scheduled' && (to as string) !== 'scheduled') {
        const after = await updateArticleRow(id, { status: to, scheduled_at: null }, client);
        await recordAudit(`article.${to}`, id, userId, { oldData: { status: from }, newData: { status: to } }, client);
        await invalidateArticleCaches();
        return after;
      }
      if (to === 'archived') {
        const after = await updateArticleRow(id, { status: 'archived' }, client);
        await recordAudit('article.archive', id, userId, { oldData: { status: from }, newData: { status: to } }, client);
        await invalidateArticleCaches();
        return after;
      }
      // draft/review restores
      const after = await updateArticleRow(
        id,
        to === 'draft' ? { status: 'draft', scheduled_at: null, published_at: before.published_at } : { status: to },
        client,
      );
      await recordAudit(`article.${to}`, id, userId, { oldData: { status: from }, newData: { status: to } }, client);
      if ((from as string) === 'published' || (to as string) === 'published') await invalidateArticleCaches();
      return after;
    }, 'Article service unavailable');
  },

  async validatePublishable(client: DbClient, article: ArticleRow): Promise<void> {
    try {
      articleTitleSchema.parse(article.title);
      articleContentSchema.parse(article.content);
      articleTypeSchema.parse(article.article_type);
    } catch {
      throw badRequest('Article is incomplete: title/content/type invalid');
    }
    validateBreaking(article.article_type, article.is_breaking);
    await validateFeaturedImage(article.featured_image_id, client);
    // SEO is optional but must be valid when present.
    const seo = await getSeoForArticle(article.id, client);
    if (seo?.canonical_url) {
      const v = String(seo.canonical_url);
      if (!(v.startsWith('/') || v.startsWith('https://') || v.startsWith('http://'))) {
        throw badRequest('SEO canonical URL is invalid');
      }
    }
  },

  async publishInternal(client: DbClient, article: ArticleRow, actorId: string | null): Promise<ArticleRow> {
    await this.validatePublishable(client, article);
    const nowIso = new Date().toISOString();
    const after = await updateArticleRow(
      article.id,
      { status: 'published', published_at: article.published_at ?? nowIso, scheduled_at: null },
      client,
    );
    await recordAudit('article.publish', article.id, actorId, { oldData: { status: article.status }, newData: { status: 'published' } }, client);
    log({ msg: 'article_published', articleId: article.id, slug: after.slug });
    await invalidateArticleCaches();
    return after;
  },

  /** Scheduled publisher: safe, idempotent, recoverable. Never loses articles. */
  async publishDue(nowMs: number = Date.now(), limit = 50): Promise<{ processed: number; published: number; failed: number; failures: Array<{ id: string; error: string }> }> {
    const client = serviceClient();
    const nowIso = new Date(nowMs).toISOString();
    const due = await listDueScheduledArticles(nowIso, limit, client).catch((error) => {
      throw toServiceError(error, 'Scheduled publisher unavailable');
    });
    let published = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const article of due) {
      try {
        const fresh = await getArticleById(article.id, client);
        if (fresh.status !== 'scheduled') continue;
        if (!fresh.scheduled_at || Date.parse(fresh.scheduled_at) > nowMs) continue;
        await this.publishInternal(client, fresh, null);
        published += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Scheduled publish failed';
        failures.push({ id: article.id, error: message.slice(0, 500) });
        // Record failure for operators; article stays scheduled for retry.
        await recordAudit('article.schedule_failed', article.id, null, { newData: { error: message.slice(0, 500) } }, client).catch(() => undefined);
        log({ msg: 'article_schedule_failed', articleId: article.id, error: message.slice(0, 200) });
      }
    }
    return { processed: due.length, published, failed: failures.length, failures };
  },

  async remove(userId: string, id: string): Promise<void> {
    await guarded(async () => {
      const roles = await rolesFor(userId);
      ensureCanWrite(roles);
      const client = serviceClient();
      const article = await getArticleById(id, client);
      if (article.status === 'published' || article.status === 'scheduled') {
        if (!(await import('../lib/roles').then((m) => m.userHasAnyRole(userId, ['super_admin', 'admin'])))) {
          throw forbidden('Only admins may delete published or scheduled articles; archive them instead');
        }
      } else if (!isEditor(roles)) {
        if (!(article.author_id === userId && (article.status === 'draft' || article.status === 'review'))) {
          throw forbidden('Cannot delete this article');
        }
      }
      await deleteArticleRow(id, client);
      await recordAudit('article.delete', id, userId, { oldData: { slug: article.slug, status: article.status } }, client);
      await invalidateArticleCaches();
    }, 'Article service unavailable');
  },

  async setRelations(
    userId: string,
    id: string,
    kind: RelationKind,
    entityIds: string[],
  ): Promise<string[]> {
    return guarded(async () => {
      const roles = await rolesFor(userId);
      ensureCanWrite(roles);
      if (entityIds.length > 50) throw badRequest('Too many relationships (max 50)');
      for (const eid of entityIds) {
        if (typeof eid !== 'string' || eid.length === 0 || eid.length > 100) throw badRequest('Invalid entity id');
      }
      const client = serviceClient();
      const article = await getArticleById(id, client);
      if (!canEditRow(userId, roles, article)) throw forbidden('Cannot manage relationships for this article');
      if (article.status === 'published' || article.status === 'archived') {
        if (!isEditor(roles)) throw forbidden('Only editors may change relationships on published content');
      }
      if (kind === 'categories') await validateReferences(entityIds, undefined, client);
      else if (kind === 'tags') await validateReferences(undefined, entityIds, client);
      else await validateEntityLinks(kind, entityIds, client);
      const saved = await replaceRelations(kind, id, entityIds, client);
      await recordAudit(`article.relations.${kind}`, id, userId, { newData: { ids: saved } }, client);
      if (article.status === 'published') await invalidateArticleCaches();
      return saved;
    }, 'Article service unavailable');
  },

  async setSeo(userId: string, id: string, input: unknown): Promise<Record<string, unknown> | null> {
    return guarded(async () => {
      const roles = await rolesFor(userId);
      ensureCanWrite(roles);
      let parsed: z.infer<typeof seoInputSchema>;
      try {
        parsed = seoInputSchema.parse(input);
      } catch (error) {
        if (error instanceof ZodError) throw badRequest('Invalid SEO metadata', error.flatten());
        throw error;
      }
      const client = serviceClient();
      const article = await getArticleById(id, client);
      if (!canEditRow(userId, roles, article)) throw forbidden('Cannot manage SEO for this article');
      const saved = await upsertSeoForArticle(id, seoToRow(id, parsed), client);
      await recordAudit('article.seo', id, userId, { newData: parsed }, client);
      return (saved as Record<string, unknown> | null) ?? null;
    }, 'Article service unavailable');
  },

  /** Public-safe single fetch (published only). Reuses RLS-backed repo via anon path. */
  toPublic(row: ArticleRow): Record<string, unknown> {
    return toPublicArticle(row);
  },

  /** Sitemap eligibility: published articles with canonical URL. */
  async getSitemapEntries(limit = 1000): Promise<Array<{ slug: string; url: string; updatedAt: string | null; articleType: string }>> {
    const client = serviceClient();
    const rows = await listEditorialArticles({ status: 'published', limit }, client).catch((error) => {
      throw toServiceError(error, 'Sitemap unavailable');
    });
    return rows.map((r) => ({
      slug: r.slug,
      url: canonicalUrl('news', r.slug),
      updatedAt: r.updated_at ?? r.published_at,
      articleType: r.article_type,
    }));
  },

  async getNewsSitemapEntries(limit = 1000): Promise<Array<{ slug: string; url: string; publishedAt: string | null; title: string }>> {
    const client = serviceClient();
    const cutoff = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await client
      .from('articles')
      .select('slug,title,published_at')
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .gte('published_at', cutoff)
      .order('published_at', { ascending: false })
      .range(0, limit - 1);
    if (error) throw upstream('Sitemap unavailable');
    return (((data as Array<{ slug: string; title: string; published_at: string }> | null) ?? []).map((r) => ({
      slug: r.slug,
      url: canonicalUrl('news', r.slug),
      publishedAt: r.published_at,
      title: r.title,
    })));
  },
};

export { ARTICLE_TYPES, config };

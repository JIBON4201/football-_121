/**
 * Step 18 — Admin articles data access.
 *
 * Single seam for `/api/v1/admin/articles`. Transport/retries/envelope come
 * from the shared ApiClient; this module maps status codes to the UI states
 * and parses the list query from URL search params. No business logic, no
 * duplicate queries — the backend service layer owns filtering/lifecycle.
 */
import { createApiClient } from '@/lib/api-client';
import { toAdminError, type AdminFailure, type AdminPagination } from './resource';
import { getAdminAccessToken } from '@/lib/admin-session';
import { siteConfig } from '@/config/site';
import type { AdminArticleCreateInput, AdminArticleEditorial, AdminArticleListRow, AdminArticleUpdateInput } from '@/types/api';
import { ARTICLES_DEFAULT_LIMIT, articlesQueryToSearch, parseArticlesQuery, type AdminArticlesQuery, type PublicCategoryRow } from './article-query';

// Re-export the client-safe query helpers so server callers have one import
// point; client components must import from './article-query' directly (this
// module is server-only).
export { ARTICLES_DEFAULT_LIMIT, articlesQueryToSearch, parseArticlesQuery, type AdminArticlesQuery, type PublicCategoryRow };

export type ArticlesListResult =
  | { status: 'ok'; rows: AdminArticleListRow[]; pagination: AdminPagination }
  | AdminFailure;

export type ArticleResult =
  | { status: 'ok'; article: AdminArticleEditorial }
  | AdminFailure;

function adminClient() {
  return createApiClient({ baseUrl: siteConfig.apiUrl, getToken: () => getAdminAccessToken() ?? null });
}

function isObjectRow(row: unknown): row is Record<string, unknown> {
  return row !== null && typeof row === 'object' && !Array.isArray(row);
}

function toListRow(row: unknown): AdminArticleListRow | null {
  if (!isObjectRow(row) || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    slug: typeof row.slug === 'string' ? row.slug : '',
    title: typeof row.title === 'string' ? row.title : 'Untitled',
    excerpt: typeof row.excerpt === 'string' ? row.excerpt : null,
    status: typeof row.status === 'string' ? row.status : 'unknown',
    article_type: typeof row.article_type === 'string' ? row.article_type : 'unknown',
    author_id: typeof row.author_id === 'string' ? row.author_id : null,
    featured_image_id: typeof row.featured_image_id === 'string' ? row.featured_image_id : null,
    published_at: typeof row.published_at === 'string' ? row.published_at : null,
    scheduled_at: typeof row.scheduled_at === 'string' ? row.scheduled_at : null,
    is_breaking: Boolean(row.is_breaking),
    is_featured: Boolean(row.is_featured),
    view_count: typeof row.view_count === 'number' ? row.view_count : 0,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

export function normalizeArticlesListResult(envelope: unknown): ArticlesListResult {
  if (!isObjectRow(envelope)) return { status: 'error', message: 'Malformed response' };
  const data = envelope.data;
  const rows = Array.isArray(data) ? data.map(toListRow).filter((r): r is AdminArticleListRow => r !== null) : [];
  const pagination = isObjectRow(envelope.pagination)
    ? {
        page: typeof envelope.pagination.page === 'number' ? envelope.pagination.page : 1,
        limit: typeof envelope.pagination.limit === 'number' ? envelope.pagination.limit : ARTICLES_DEFAULT_LIMIT,
        total: typeof envelope.pagination.total === 'number' ? envelope.pagination.total : rows.length,
        totalPages: typeof envelope.pagination.totalPages === 'number' ? envelope.pagination.totalPages : 1,
      }
    : { page: 1, limit: ARTICLES_DEFAULT_LIMIT, total: rows.length, totalPages: 1 };
  return { status: 'ok', rows, pagination };
}

export async function fetchAdminArticles(query: AdminArticlesQuery): Promise<ArticlesListResult> {
  const params = articlesQueryToSearch(query);
  // Backend expects article_type (snake) on the wire.
  if (query.articleType) {
    params.delete('articleType');
    params.set('article_type', query.articleType);
  }
  try {
    const envelope = await adminClient().get<AdminArticleListRow[]>('/admin/articles', {
      query: Object.fromEntries(params),
      cache: 'no-store',
    });
return normalizeArticlesListResult(envelope);
  } catch (error) {
    return toAdminError(error, 'Articles unavailable');
  }
}

export async function fetchAdminArticle(id: string): Promise<ArticleResult> {
  try {
    const envelope = await adminClient().get<AdminArticleEditorial>(`/admin/articles/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    const article = envelope?.data;
    if (!article || typeof article.id !== 'string') return { status: 'error', message: 'Malformed article' };
    return { status: 'ok', article };
  } catch (error) {
    return toAdminError(error, 'Article unavailable');
  }
}

export async function createAdminArticle(input: AdminArticleCreateInput): Promise<ArticleResult> {
  try {
    const envelope = await adminClient().post<AdminArticleEditorial>('/admin/articles', input);
    const article = envelope?.data;
    if (!article || typeof article.id !== 'string') return { status: 'error', message: 'Malformed response' };
    return { status: 'ok', article };
  } catch (error) {
    return toArticleError(error);
  }
}

export async function updateAdminArticle(id: string, input: AdminArticleUpdateInput): Promise<ArticleResult> {
  try {
    const envelope = await adminClient().request<AdminArticleEditorial>(`/admin/articles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    });
    const article = envelope?.data;
    if (!article || typeof article.id !== 'string') return { status: 'error', message: 'Malformed response' };
    return { status: 'ok', article };
  } catch (error) {
    return toArticleError(error);
  }
}

export async function deleteAdminArticle(id: string): Promise<{ status: 'ok' } | AdminFailure> {
  try {
    await adminClient().request<{ id: string; deleted: boolean }>(`/admin/articles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return { status: 'ok' };
  } catch (error) {
    return toArticleError(error);
  }
}

/** Delegates to the shared mapper so articles share one status vocabulary. */
function toArticleError(error: unknown): AdminFailure {
  return toAdminError(error, 'Request failed');
}

/**
 * Public, read-only category list for filters and the create form.
 *
 * Was a raw `fetch` with a 3600s untagged cache — a direct violation of the
 * project rule that API access goes through the shared client, and the reason a
 * newly created category could take an hour to appear in the article form. Goes
 * through the shared client now, still untagged because categories have no feed
 * tag of their own; `no-store` beats a stale hour for an admin form.
 */
export async function fetchPublicCategories(): Promise<PublicCategoryRow[]> {
  try {
    const envelope = await createApiClient({ baseUrl: siteConfig.apiUrl }).get<Array<Record<string, unknown>>>('/categories', {
      query: { limit: 100 },
      cache: 'no-store',
    });
    if (!Array.isArray(envelope?.data)) return [];
    return envelope.data
      .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
      .map((row) => ({
        id: typeof row.id === 'string' ? row.id : '',
        name: typeof row.name === 'string' ? row.name : '',
        slug: typeof row.slug === 'string' ? row.slug : '',
      }))
      .filter((c) => c.id && c.name);
  } catch {
    return [];
  }
}

/**
 * Step 18 — shared, client-safe article query helpers.
 *
 * This module deliberately imports NOTHING server-only (no next/headers, no
 * admin-session): it is the boundary between the client filter UI and the
 * server data layer. Both sides parse and serialise the same URL params, so
 * the client can render filters and the server can render results without a
 * second query language.
 */

export const ARTICLES_DEFAULT_LIMIT = 20;

export interface AdminArticlesQuery {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  articleType?: string;
  categoryId?: string;
  featured?: boolean;
  sort?: string;
  order?: string;
}

export interface PublicCategoryRow {
  id: string;
  name: string;
  slug: string;
}

/** URL search params → typed list query (all values optional, clamped). */
export function parseArticlesQuery(searchParams: Record<string, string | string[] | undefined>): AdminArticlesQuery {
  const asSingle = (v: string | string[] | undefined): string | undefined =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;

  const pageRaw = asSingle(searchParams.page);
  const page = pageRaw && /^\d+$/.test(pageRaw) ? Math.max(1, Math.floor(Number(pageRaw))) : 1;

  const limitRaw = asSingle(searchParams.limit);
  const limit =
    limitRaw && /^\d+$/.test(limitRaw) ? Math.min(100, Math.max(1, Math.floor(Number(limitRaw)))) : ARTICLES_DEFAULT_LIMIT;

  const featuredRaw = asSingle(searchParams.featured);
  const featured = featuredRaw === 'true' ? true : featuredRaw === 'false' ? false : undefined;

  const sortRaw = asSingle(searchParams.sort);
  const sort = sortRaw && ['created_at', 'published_at', 'updated_at'].includes(sortRaw) ? sortRaw : undefined;

  const orderRaw = asSingle(searchParams.order);
  const order = orderRaw === 'asc' ? 'asc' : orderRaw === 'desc' ? 'desc' : undefined;

  return {
    page,
    limit,
    q: asSingle(searchParams.q),
    status: asSingle(searchParams.status),
    articleType: asSingle(searchParams.articleType),
    categoryId: asSingle(searchParams.categoryId),
    featured,
    sort,
    order,
  };
}

/** Query object → URLSearchParams (only set values, clamped types). */
export function articlesQueryToSearch(query: AdminArticlesQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.page > 1) params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.articleType) params.set('articleType', query.articleType);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.featured !== undefined) params.set('featured', String(query.featured));
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  return params;
}

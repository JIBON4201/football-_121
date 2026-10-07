import { siteConfig } from '@/config/site';
import { fetchServer, toPaginated, type PaginatedResult } from '@/lib/data-fetch';
import type { Article, Transfer } from '@/types/api';

/**
 * News data layer. All filtering happens server-side via backend query
 * params — the browser never downloads bulk datasets to filter locally.
 * Only published articles are reachable (backend RLS + status filters).
 */

export const NEWS_PAGE_SIZE = 12;
export const NEWS_REVALIDATE_SECONDS = 300;
export const BREAKING_REVALIDATE_SECONDS = 60;

export type NewsFilterType = 'news' | 'breaking_news' | 'transfer' | 'match_report' | 'analysis' | 'opinion';

export const NEWS_FILTERS = [
  { key: 'latest', label: 'Latest', href: '/news' },
  { key: 'breaking_news', label: 'Breaking', href: '/breaking-news' },
  { key: 'transfer', label: 'Transfers', href: '/news?type=transfer' },
  { key: 'match_report', label: 'Match Reports', href: '/news?type=match_report' },
  { key: 'analysis', label: 'Analysis', href: '/news?type=analysis' },
] as const;

export type NewsFilterKey = (typeof NEWS_FILTERS)[number]['key'];

/** Deterministic filter URLs: breaking has its own canonical route. */
export function filterHref(filter: NewsFilterKey | 'latest'): string {
  if (filter === 'latest') return '/news';
  if (filter === 'breaking_news') return '/breaking-news';
  return `/news?type=${filter}`;
}

/**
 * Canonical URL per filter. Breaking content canonicalizes to
 * /breaking-news so /news?type=breaking_news never duplicates it.
 * Paged views canonicalize to the filter base (no ?page= dupes).
 */
export function filterCanonical(filter: NewsFilterKey | 'latest'): string {
  return `${siteConfig.siteUrl}${filterHref(filter)}`;
}

export interface NewsListResult extends PaginatedResult<Article> {
  status: 'ready' | 'empty' | 'error';
}

function toResult(result: PaginatedResult<Article>): NewsListResult {
  if (result.rows.length === 0) return { ...result, status: 'empty' };
  return { ...result, status: 'ready' };
}

/** Paginated published-article listing with backend-side filtering. */
export async function fetchNewsList(options: {
  page?: number;
  limit?: number;
  type?: string;
  breaking?: boolean;
  category?: string;
  tag?: string;
  revalidate?: number;
} = {}): Promise<NewsListResult> {
  const { page = 1, limit = NEWS_PAGE_SIZE, revalidate = NEWS_REVALIDATE_SECONDS, ...params } = options;
  try {
    const envelope = await fetchServer<Article[]>('/news', {
      page,
      limit,
      params,
      revalidate,
      tags: ['news-list'],
    });
    return toResult(toPaginated<Article>(envelope, page, limit));
  } catch {
    return {
      status: 'error',
      rows: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    };
  }
}

export type ArticleDetailStatus = 'ready' | 'not-found' | 'error';

export interface ArticleDetailResult {
  status: ArticleDetailStatus;
  article: Article | null;
}

/**
 * Canonical article fetch. Draft/review/scheduled content 404s at the API,
 * so `not-found` covers both missing and unpublished articles.
 */
export async function fetchArticleDetail(slug: string): Promise<ArticleDetailResult> {
  try {
    const envelope = await fetchServer<Article>(`/news/${slug}`, {
      revalidate: NEWS_REVALIDATE_SECONDS,
      tags: [`news-detail:${slug}`],
    });
    if (!envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
      return { status: 'not-found', article: null };
    }
    return { status: 'ready', article: envelope.data };
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 404) return { status: 'not-found', article: null };
    return { status: 'error', article: null };
  }
}

export interface RelatedLink {
  entityType: string;
  id: string;
  slug: string;
  title: string;
  url: string;
}

export interface ArticleRelations {
  related: RelatedLink[];
  entities: RelatedLink[];
}

/**
 * Related content from the SEO service (shared-entity scoring, self
 * excluded server-side). Never throws — failures yield an empty fallback.
 */
export async function fetchRelatedArticles(slug: string, limit = 5): Promise<ArticleRelations> {
  try {
    const envelope = await fetchServer<ArticleRelations>('/seo/related', {
      params: { type: 'news', slug, limit },
      revalidate: NEWS_REVALIDATE_SECONDS,
      tags: [`news-related:${slug}`],
    });
    const data = envelope.data;
    if (!data || typeof data !== 'object') return { related: [], entities: [] };
    return {
      related: Array.isArray(data.related) ? data.related : [],
      entities: Array.isArray(data.entities) ? data.entities : [],
    };
  } catch {
    return { related: [], entities: [] };
  }
}

export interface AdjacentArticles {
  newer: Article | null;
  older: Article | null;
}

/**
 * Previous/next navigation from one bounded recency query (stable
 * published_at DESC ordering). Null when the article is absent from the
 * window — navigation is omitted rather than guessed.
 */
export async function fetchAdjacentArticles(slug: string, limit = 100): Promise<AdjacentArticles | null> {
  try {
    const envelope = await fetchServer<Article[]>('/news', {
      page: 1,
      limit,
      revalidate: NEWS_REVALIDATE_SECONDS,
      tags: ['news-list'],
    });
    const rows = Array.isArray(envelope.data) ? envelope.data : [];
    const index = rows.findIndex((article) => article.slug === slug);
    if (index === -1) return null;
    return {
      newer: rows[index - 1] ?? null,
      older: rows[index + 1] ?? null,
    };
  } catch {
    return null;
  }
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
}

/** Canonical category record (active only, backend-enforced). Null when unknown. */
export async function fetchCategory(slug: string): Promise<Category | null> {
  try {
    const envelope = await fetchServer<Category>(`/categories/${slug}`, {
      revalidate: 3600,
      tags: [`news-category:${slug}`],
    });
    const data = envelope.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Canonical tag record. Null when unknown. */
export async function fetchTag(slug: string): Promise<Tag | null> {
  try {
    const envelope = await fetchServer<Tag>(`/tags/${slug}`, {
      revalidate: 3600,
      tags: [`news-tag:${slug}`],
    });
    const data = envelope.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

export type TransferRecordStatus = 'ready' | 'empty' | 'error';

export interface TransferRecordResult {
  status: TransferRecordStatus;
  items: Transfer[];
}

/**
 * Official transfer records (announced/completed only — the public API
 * never exposes rumours, so statuses are shown exactly as returned).
 */
export async function fetchTransferRecords(limit = 10): Promise<TransferRecordResult> {
  try {
    const envelope = await fetchServer<Transfer[]>('/transfers', {
      page: 1,
      limit,
      revalidate: 300,
      tags: ['transfer-records'],
    });
    const items = Array.isArray(envelope.data) ? envelope.data : [];
    return { status: items.length > 0 ? 'ready' : 'empty', items };
  } catch {
    return { status: 'error', items: [] };
  }
}

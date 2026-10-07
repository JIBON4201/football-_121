import { siteConfig } from '@/config/site';
import { createApiClient } from '@/lib/api-client';
import type { BreadcrumbItem, PaginationMeta, SeoMetadata } from '@/types/api';

function serverClient() {
  return createApiClient({ baseUrl: siteConfig.apiUrl, defaultTimeoutMs: 8000 });
}

export interface FetchPageOptions {
  page?: number;
  limit?: number;
  revalidate?: number;
  tags?: string[];
  params?: Record<string, string | number | boolean | undefined>;
  next?: { revalidate?: number; tags?: string[] };
}

/**
 * Server-side fetch helper. Uses backend SEO rules implicitly (public content
 * only) and supports Next.js cache revalidation/tags for ISR.
 */
export async function fetchServer<T>(path: string, options: FetchPageOptions & { authToken?: string } = {}) {
  const client = serverClient();
  const { page, limit, revalidate, tags, params, authToken, next } = options;
  return client.get<T>(path, {
    query: { page, limit, ...params },
    authToken,
    next: next ?? (revalidate !== undefined || (tags && tags.length > 0) ? { revalidate, tags } : undefined),
  });
}

export interface PaginatedResult<T> {
  rows: T[];
  pagination: PaginationMeta;
}

/** Extract rows + pagination from a list envelope with safe defaults. */
export function toPaginated<T>(envelope: { data: unknown; pagination?: PaginationMeta }, page: number, limit: number): PaginatedResult<T> {
  const rows = (Array.isArray(envelope.data) ? envelope.data : []) as T[];
  return {
    rows,
    pagination: envelope.pagination ?? { page, limit, total: rows.length, totalPages: rows.length === 0 ? 0 : 1 },
  };
}

export function getPageParams(searchParams: Record<string, string | string[] | undefined>): { page: number; limit: number } {
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  const page = Number(first(searchParams.page));
  const limit = Number(first(searchParams.limit));
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20,
  };
}

/** Frontend SEO bridge — consumes the backend SEO service, no local rules. */
export async function fetchSeoMetadata(entityType: string, slug: string): Promise<SeoMetadata | null> {
  try {
    const envelope = await serverClient().get<SeoMetadata>('/seo/metadata', { query: { type: entityType, slug } });
    return envelope.data;
  } catch {
    return null;
  }
}

export async function fetchBreadcrumbs(entityType: string, slug: string): Promise<BreadcrumbItem[]> {
  try {
    const envelope = await serverClient().get<BreadcrumbItem[]>('/seo/breadcrumbs', { query: { type: entityType, slug } });
    return envelope.data;
  } catch {
    return [];
  }
}

/** NewsArticle (+BreadcrumbList) JSON-LD for article pages. Null on any failure. */
export async function fetchStructuredData(entityType: string, slug: string): Promise<Array<Record<string, unknown>> | null> {
  try {
    const envelope = await serverClient().get<Array<Record<string, unknown>>>('/seo/structured', {
      query: { type: entityType, slug },
    });
    return Array.isArray(envelope.data) ? envelope.data : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a previously-published path to its new canonical destination.
 *
 * The backend records a redirect whenever a slug changes; this lets a stale
 * URL issue a permanent redirect instead of 404ing, which preserves accumulated
 * link equity and keeps already-indexed results working.
 *
 * Returns null when no redirect is recorded, when the chain loops, or when the
 * lookup itself fails — in every case the caller should fall back to a 404
 * rather than redirecting to an unknown destination.
 */
export async function fetchRedirectTarget(path: string): Promise<string | null> {
  try {
    const envelope = await serverClient().get<{ redirect: { destination: string } | null }>('/seo/redirect', {
      query: { path },
    });
    const destination = envelope.data?.redirect?.destination;
    return typeof destination === 'string' && destination.startsWith('/') ? destination : null;
  } catch {
    return null;
  }
}

/** Map backend SEO metadata onto Next.js Metadata (single mapping point). */
export function toNextMetadata(meta: SeoMetadata | null, fallbackTitle: string, fallbackCanonicalPath?: string) {
  const title = meta?.title ?? `${fallbackTitle} | ${siteConfig.name}`;
  const description = meta?.description ?? siteConfig.description;
  const canonical = meta?.canonical ?? (fallbackCanonicalPath ? `${siteConfig.siteUrl}${fallbackCanonicalPath}` : undefined);
  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    // The detail pages 404 unknown entities via notFound() (which carries its
    // own noindex), so falling back to indexable metadata here can never
    // index a soft-404 — but it must always carry the canonical. A fallback
    // without a canonical stays noindex so a future caller cannot create an
    // indexable, canonical-less page by accident.
    robots: meta?.robots ?? (canonical ? 'index,follow' : 'noindex,follow'),
    openGraph: {
      title: meta?.ogTitle ?? title,
      description: meta?.ogDescription ?? description,
      url: canonical,
      images: meta?.ogImage ? [{ url: meta.ogImage }] : undefined,
      type: 'website' as const,
    },
    twitter: {
      card: 'summary_large_image' as const,
      title: meta?.twitterTitle ?? title,
      description: meta?.twitterDescription ?? description,
      images: meta?.twitterImage ? [meta.twitterImage] : undefined,
    },
  };
}

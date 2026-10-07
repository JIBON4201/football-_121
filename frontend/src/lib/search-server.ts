import { fetchServer, toPaginated } from '@/lib/data-fetch';
import {
  isSearchableQuery,
  normalizeQuery,
  SEARCH_PAGE_SIZE,
  type SearchFilters,
} from '@/lib/search';
import type { SearchResultItem, PaginationMeta } from '@/types/api';

/**
 * Server-side search.
 *
 * The search page renders on the server so the first paint is immediate and
 * every result is present in the HTML. The request goes through the shared
 * `fetchServer` helper, which applies the backend's own cache and revalidation
 * policy — the frontend never re-implements ranking, filtering or paging.
 */

export const SEARCH_REVALIDATE_SECONDS = 30;

export type SearchResultStatus = 'ready' | 'empty' | 'invalid' | 'error';

export interface SearchResult {
  status: SearchResultStatus;
  items: SearchResultItem[];
  pagination: PaginationMeta;
  /** The query actually sent, after normalization. */
  query: string;
}

function emptyPagination(page: number): PaginationMeta {
  return { page, limit: SEARCH_PAGE_SIZE, total: 0, totalPages: 0 };
}

/**
 * Map a search page to its API query, dropping anything the API would reject.
 * The backend remains the only place filters are validated and applied.
 */
export function toSearchParams(filters: SearchFilters): Record<string, string | number> {
  const params: Record<string, string | number> = {
    q: normalizeQuery(filters.query),
    limit: SEARCH_PAGE_SIZE,
  };
  if (filters.type) params.type = filters.type;
  if (filters.competition) params.competition = filters.competition;
  if (filters.team) params.team = filters.team;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  return params;
}

export async function fetchSearchResults(filters: SearchFilters): Promise<SearchResult> {
  const query = normalizeQuery(filters.query);
  // A blank or too-short query is not an error: it is the landing state, and
  // it must never reach the API.
  if (!isSearchableQuery(query)) {
    return { status: 'invalid', items: [], pagination: emptyPagination(filters.page), query };
  }

  try {
    const envelope = await fetchServer<unknown>(
      '/search',
      {
        page: filters.page,
        limit: SEARCH_PAGE_SIZE,
        revalidate: SEARCH_REVALIDATE_SECONDS,
        params: toSearchParams(filters),
      },
    );
    const page = toPaginated<SearchResultItem>(envelope, filters.page, SEARCH_PAGE_SIZE);
    const items = page.rows.filter(isRenderableResult);
    return {
      status: items.length === 0 ? 'empty' : 'ready',
      items,
      pagination: page.pagination,
      query,
    };
  } catch {
    // A failed search must not take the page down; the route renders a retry.
    return { status: 'error', items: [], pagination: emptyPagination(filters.page), query };
  }
}

/**
 * Drop rows the renderer could not safely display (unknown type, unusable
 * slug). Rendering is best-effort: one bad row never fails the page.
 */
export function isRenderableResult(item: unknown): item is SearchResultItem {
  if (!item || typeof item !== 'object') return false;
  const row = item as Partial<SearchResultItem>;
  return (
    typeof row.entity_type === 'string' &&
    typeof row.title === 'string' &&
    typeof row.slug === 'string' &&
    typeof row.entity_id === 'string'
  );
}

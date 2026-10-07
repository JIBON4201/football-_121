import { buildSearchUrl, type SearchFilters } from '@/lib/search';
import type { PaginationMeta } from '@/types/api';

interface SearchPaginationProps {
  pagination: PaginationMeta;
  filters: SearchFilters;
  /** How many numbered pages to show either side of the current one. */
  window?: number;
}

/** Page numbers to render, always including the first and last page. */
export function pageWindow(current: number, totalPages: number, size = 2): Array<number | 'gap'> {
  if (totalPages <= 1) return totalPages === 1 ? [1] : [];
  const pages = new Set<number>([1, totalPages]);
  for (let page = current - size; page <= current + size; page += 1) {
    if (page >= 1 && page <= totalPages) pages.add(page);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) out.push('gap');
    out.push(page);
    previous = page;
  }
  return out;
}

/**
 * Server-rendered pagination.
 *
 * Links are real anchors pointing at canonical `/search?q=…&page=N` URLs, so
 * pages are shareable, crawlable via the noindex canonical strategy, and
 * work with JavaScript disabled. Ordering is the backend's: the same query
 * parameters always return the same page.
 */
export function SearchPagination({ pagination, filters, window: size = 2 }: SearchPaginationProps) {
  const { page, totalPages, total } = pagination;
  if (totalPages <= 1) return null;
  const link = (target: number) => buildSearchUrl(filters.query, { ...filters, page: target });
  const pages = pageWindow(page, totalPages, size);

  return (
    <nav className="search-pagination" aria-label="Search results pages">
      <p className="search-pagination__summary">
        Page {page} of {totalPages} ({total} result{total === 1 ? '' : 's'})
      </p>
      <ul className="search-pagination__list">
        <li>
          {page > 1 ? (
            <a href={link(page - 1)} rel="prev">
              Previous
            </a>
          ) : (
            <span aria-disabled="true">Previous</span>
          )}
        </li>
        {pages.map((entry, index) =>
          entry === 'gap' ? (
            <li key={`gap-${index}`} aria-hidden="true">
              <span>&hellip;</span>
            </li>
          ) : (
            <li key={entry}>
              {entry === page ? (
                <span aria-current="page">{entry}</span>
              ) : (
                <a href={link(entry)}>{entry}</a>
              )}
            </li>
          ),
        )}
        <li>
          {page < totalPages ? (
            <a href={link(page + 1)} rel="next">
              Next
            </a>
          ) : (
            <span aria-disabled="true">Next</span>
          )}
        </li>
      </ul>
    </nav>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  /** Base path without query (e.g. '/news'); page appends as ?page=N. */
  baseHref: string;
  /** Extra query preserved across pages (e.g. { type: 'transfer' }). */
  extraQuery?: Record<string, string>;
  window?: number;
}

export type PageItem = { kind: 'page'; page: number } | { kind: 'ellipsis'; key: string };

/**
 * Stable sliding-window page list: first, last, and `window` neighbours
 * around the current page. Clamped inputs can never duplicate or skip.
 */
export function buildPageItems(page: number, totalPages: number, window = 2): PageItem[] {
  if (totalPages <= 0) return [];
  const current = Math.min(Math.max(1, page), totalPages);
  // Seeded as a set so a single-page range cannot emit a duplicate control.
  const pages = new Set<number>([1, totalPages]);
  for (let candidate = current - window; candidate <= current + window; candidate += 1) {
    if (candidate >= 1 && candidate <= totalPages) pages.add(candidate);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const items: PageItem[] = [];
  let previous = 0;
  for (const value of sorted) {
    if (value - previous > 1) items.push({ kind: 'ellipsis', key: `gap-${previous}-${value}` });
    items.push({ kind: 'page', page: value });
    previous = value;
  }
  return items;
}

function pageHref(baseHref: string, extraQuery: Record<string, string>, page: number): string {
  const params = new URLSearchParams({ ...extraQuery, ...(page > 1 ? { page: String(page) } : {}) });
  const query = params.toString();
  return query ? `${baseHref}?${query}` : baseHref;
}

/** Server-rendered pagination: plain links, SEO-friendly, mobile-tappable. */
export function Pagination({ page, totalPages, baseHref, extraQuery = {}, window = 2 }: PaginationProps) {
  if (totalPages <= 1) return null;
  const current = Math.min(Math.max(1, page), totalPages);
  return (
    <nav aria-label="Pagination">
      <ul className="pagination">
        {current > 1 ? (
          <li>
            <a href={pageHref(baseHref, extraQuery, current - 1)} rel="prev" aria-label="Previous page">
              Previous
            </a>
          </li>
        ) : null}
        {buildPageItems(current, totalPages, window).map((item) =>
          item.kind === 'ellipsis' ? (
            <li key={item.key} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item.page}>
              <a
                href={pageHref(baseHref, extraQuery, item.page)}
                aria-current={item.page === current ? 'page' : undefined}
                aria-label={`Page ${item.page}`}
              >
                {item.page}
              </a>
            </li>
          ),
        )}
        {current < totalPages ? (
          <li>
            <a href={pageHref(baseHref, extraQuery, current + 1)} rel="next" aria-label="Next page">
              Next
            </a>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

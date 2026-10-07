'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Search + filter bar for the reference list pages.
 *
 * Filtering is server-driven: the control writes to the URL and the page
 * re-reads it, so the backend owns the query and the result is linkable and
 * bookmarkable. Deliberately no client-side filtering — that would need the full
 * dataset and would duplicate the backend's filter semantics.
 */
export function ResourceToolbar({
  basePath,
  searchPlaceholder,
  filters = [],
}: {
  basePath: string;
  /**
   * Omitted for endpoints that expose no free-text search (the backend owns
   * every filter, so offering a box the API ignores would be a silent no-op).
   */
  searchPlaceholder?: string;
  /** Select filters, e.g. active/inactive or a competition picker. */
  filters?: Array<{ param: string; label: string; options: Array<{ value: string; label: string }> }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(searchParams.get('q') ?? '');

  // Keep the box in step with back/forward navigation and filter changes.
  useEffect(() => {
    setTerm(searchParams.get('q') ?? '');
  }, [searchParams]);

  function push(next: URLSearchParams) {
    next.delete('page');
    const query = next.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  // Debounced so typing does not fire a request per keystroke. The timer is
  // rebuilt only when `term` or the URL changes, so the closure over `push` is
  // never stale in a way that matters and no dependency array is needed.
  const pushRef = useRef(push);
  pushRef.current = push;

  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (term === current) return;
    const snapshot = searchParams.toString();
    const timer = setTimeout(() => {
      const next = new URLSearchParams(snapshot);
      if (term) next.set('q', term);
      else next.delete('q');
      pushRef.current(next);
    }, 350);
    return () => clearTimeout(timer);
  }, [term, searchParams]);

  return (
    <div className="cc-filters">
      <div className="cc-filters__row">
        {searchPlaceholder ? (
          <div className="cc-field">
            <label className="cc-visually-hidden" htmlFor="cc-resource-search">
              {searchPlaceholder}
            </label>
            <input
              id="cc-resource-search"
              type="search"
              placeholder={searchPlaceholder}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
        ) : null}

        {filters.map((filter) => (
          <div className="cc-field" key={filter.param}>
            <label className="cc-visually-hidden" htmlFor={`cc-filter-${filter.param}`}>
              {filter.label}
            </label>
            <select
              id={`cc-filter-${filter.param}`}
              value={searchParams.get(filter.param) ?? ''}
              onChange={(event) => {
                const next = new URLSearchParams(searchParams.toString());
                if (event.target.value) next.set(filter.param, event.target.value);
                else next.delete(filter.param);
                push(next);
              }}
            >
              <option value="">{filter.label}: all</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
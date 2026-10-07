'use client';

import { useEffect, useRef } from 'react';
import { trackSearch } from '@/lib/analytics';

interface SearchNoResultsSignalProps {
  query: string;
  hasFilters: boolean;
}

/**
 * Records that a search returned nothing.
 *
 * Fires exactly once per distinct query/filter combination, and only in the
 * browser. The query itself is never recorded — only its length — so a reader's
 * search history cannot be reconstructed from analytics.
 */
export function SearchNoResultsSignal({ query, hasFilters }: SearchNoResultsSignalProps) {
  const fired = useRef<string | null>(null);

  useEffect(() => {
    const key = `${hasFilters ? 'filtered' : 'plain'}:${query.length}`;
    if (fired.current === key) return;
    fired.current = key;
    trackSearch('search-no-results', { query, hasFilters });
  }, [query, hasFilters]);

  return null;
}

'use client';

import { trackAttributes, trackSearch } from '@/lib/analytics';
import { canonicalResultUrl, SEARCH_TYPE_LABELS } from '@/lib/search';
import { sanitizeText } from '@/lib/validation';
import { HighlightedText } from '@/components/search/SearchResultCard';
import type { SearchResultItem } from '@/types/api';

interface SearchResultLinkProps {
  item: SearchResultItem;
  query: string;
  /** Badge or image for the entity. */
  media?: React.ReactNode;
  /** Secondary line under the title. */
  meta?: React.ReactNode;
  /** Rendered after the title, inside the link. */
  trailing?: React.ReactNode;
}

/**
 * Canonical result link.
 *
 * The href comes from the same pure helper the rest of the platform uses, so a
 * click can never reach a different or unsafe destination than the crawlable
 * link. Clicks are recorded as a shape — the query text itself is never stored.
 */
export function SearchResultLink({ item, query, media, meta, trailing }: SearchResultLinkProps) {
  const href = canonicalResultUrl(item);
  if (!href) return null;
  const title = sanitizeText(item.title, 200);
  return (
    <a
      className="search-card__link"
      href={href}
      aria-label={`${SEARCH_TYPE_LABELS[item.entity_type]}: ${title}`}
      onClick={() => trackSearch('search-result-clicked', { query, entityType: item.entity_type })}
      {...trackAttributes('search-result', item.entity_id)}
    >
      {media}
      <span className="search-card__title">
        <HighlightedText text={title} query={query} />
      </span>
      {meta}
      {trailing}
    </a>
  );
}

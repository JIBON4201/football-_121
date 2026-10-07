import { groupResultsByType } from '@/lib/search';
import { SearchResultCard } from '@/components/search/SearchResultCard';
import type { SearchResultItem } from '@/types/api';

interface SearchResultsSectionProps {
  results: SearchResultItem[];
  query: string;
}

/**
 * Grouped search results.
 *
 * A pure server-renderable component: every result is in the HTML, so results
 * are readable without JavaScript. Groups are ordered entities-first, empty
 * groups never render, and each list is labelled for assistive tech so a screen
 * reader can move between result types.
 */
export function SearchResultsSection({ results, query }: SearchResultsSectionProps) {
  const groups = groupResultsByType(results);
  if (groups.length === 0) return null;

  return (
    // `data-columns` is only consumed by a min-width media query, so the
    // single-column mobile layout is unaffected.
    <div className="search-results" data-columns="2">
      {groups.map((group) => (
        <section
          key={group.type}
          className="search-results__group"
          data-entity={group.type}
          aria-labelledby={`search-group-${group.type}`}
        >
          <h2 id={`search-group-${group.type}`} className="search-results__heading">
            {group.label}
            <span className="search-results__count"> {group.items.length}</span>
          </h2>
          <ul className="search-results__list" aria-label={`${group.label}: ${group.items.length} result${group.items.length === 1 ? '' : 's'}`}>
            {group.items.map((item) => (
              <SearchResultCard key={`${item.entity_type}-${item.entity_id}`} item={item} query={query} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

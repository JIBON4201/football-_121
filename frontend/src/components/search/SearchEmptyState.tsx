import { buildSearchUrl, broadenQuery, type SearchFilters } from '@/lib/search';
import { sanitizeText } from '@/lib/validation';
import { routeUrl } from '@/config/routes';
import { EmptyState } from '@/components/ui/Feedback';

interface SearchEmptyStateProps {
  /** The reader's query, echoed back so the context is never lost. */
  query: string;
  filters: SearchFilters;
  /** True when filters were applied, so the message can point at the cause. */
  hasFilters?: boolean;
}

/** Major sections offered when a search finds nothing. */
const SECTION_LINKS: Array<{ href: string; label: string }> = [
  { href: routeUrl('news'), label: 'Latest news' },
  { href: routeUrl('matches'), label: 'All matches' },
  { href: routeUrl('live'), label: 'Live scores' },
  { href: routeUrl('teams'), label: 'Teams' },
  { href: routeUrl('players'), label: 'Players' },
  { href: routeUrl('competitions'), label: 'Competitions' },
];

/**
 * Zero-results state.
 *
 * It restates the query, suggests genuinely broader terms derived from it, and
 * offers real navigation. It never invents "related" results, because a
 * fabricated match or team is worse than an honest empty page.
 */
export function SearchEmptyState({ query, filters, hasFilters = false }: SearchEmptyStateProps) {
  const safeQuery = sanitizeText(query, 200);
  const broader = broadenQuery(safeQuery);

  return (
    <div className="search-empty">
      <EmptyState
        title="No results found"
        description={
          safeQuery
            ? `Nothing matched “${safeQuery}”. Try a shorter or different term.`
            : 'Enter a search term to find teams, players, competitions, matches and news.'
        }
      />

      {broader.length > 0 ? (
        <section className="search-empty__broader" aria-labelledby="search-broader-heading">
          <h3 id="search-broader-heading">Try a broader search</h3>
          <ul>
            {broader.map((term) => (
              <li key={term}>
                <a href={buildSearchUrl(term, { ...filters, type: null, page: 1 })}>{sanitizeText(term, 80)}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hasFilters ? (
        <p className="search-empty__filters">
          <a href={buildSearchUrl(safeQuery, { ...filters, type: null, competition: null, team: null, from: null, to: null, page: 1 })}>
            Clear all filters and search again
          </a>
        </p>
      ) : null}

      <nav className="search-empty__sections" aria-label="Browse football sections">
        <h3>Browse instead</h3>
        <ul>
          {SECTION_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

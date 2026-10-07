import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';
import { fetchCompetitionList } from '@/lib/competitions';
import { fetchTeamList } from '@/lib/teams';
import {
  hasActiveFilters,
  isSearchableQuery,
  normalizeQuery,
  parseSearchFilters,
  SEARCH_TYPE_LABELS,
} from '@/lib/search';
import { fetchSearchResults } from '@/lib/search-server';
import { sanitizeText } from '@/lib/validation';
import { SearchEmptyState } from '@/components/search/SearchEmptyState';
import { SearchFiltersBar } from '@/components/search/SearchFiltersBar';
import { SearchInput } from '@/components/search/SearchInput';
import { SearchLandingState, type PopularEntity } from '@/components/search/SearchLandingState';
import { SearchNoResultsSignal } from '@/components/search/SearchNoResultsSignal';
import { SearchPagination } from '@/components/search/SearchPagination';
import { SearchResultsSection } from '@/components/search/SearchResultsSection';
import { PageIntro, PageLayout } from '@/components/touchline/page-components';
import { Alert } from '@/components/ui/Feedback';

interface SearchPageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

/** Results are private to the query string; the canonical URL is always /search. */
export const metadata: Metadata = {
  title: `Search | ${siteConfig.name}`,
  description: 'Search football news, teams, players, matches and competitions.',
  alternates: { canonical: `${siteConfig.siteUrl}/search` },
  robots: 'noindex,follow',
  openGraph: {
    title: `Search | ${siteConfig.name}`,
    description: 'Search football news, teams, players, matches and competitions.',
    url: `${siteConfig.siteUrl}/search`,
    siteName: siteConfig.name,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: `Search | ${siteConfig.name}`,
    description: 'Search football news, teams, players, matches and competitions.',
  },
};

const LANDING_LIMIT = 6;

function toPopular(rows: Array<{ slug: string; name: string; logo_url?: string | null; country?: { name: string } | null }>): PopularEntity[] {
  return rows.map((row) => ({
    slug: row.slug,
    name: sanitizeText(row.name, 80),
    logoUrl: row.logo_url ?? null,
    countryName: row.country?.name ? sanitizeText(row.country.name, 60) : null,
  }));
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const filters = parseSearchFilters(searchParams);
  const query = normalizeQuery(filters.query);
  const searchable = isSearchableQuery(query);

  // Only the landing state needs catalog data; a real query skips both requests.
  const [result, competitions, teams] = searchable
    ? await Promise.all([fetchSearchResults(filters), Promise.resolve(null), Promise.resolve(null)])
    : await Promise.all([
        fetchSearchResults(filters),
        fetchCompetitionList({ page: 1, limit: LANDING_LIMIT }).catch(() => null),
        fetchTeamList({ page: 1, limit: LANDING_LIMIT }).catch(() => null),
      ]);

  const popularCompetitions = toPopular(competitions?.status === 'ready' ? competitions.rows : []);
  const popularTeams = toPopular(teams?.status === 'ready' ? teams.rows : []);

  const title = searchable
    ? `Search results for ${query}`
    : 'Search';

  return (
    <PageLayout>
      <div className="page-container page-container--content search-page">
        <PageIntro
          eyebrow="Search"
          title={title}
          description="Search football news, teams, players, matches and competitions."
          breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Search' }]}
        />
        <section aria-label="Search controls and results">
      <SearchInput
        initialQuery={query}
        autoFocus
        filters={{
          type: filters.type ?? undefined,
          competition: filters.competition ?? undefined,
          team: filters.team ?? undefined,
          from: filters.from ?? undefined,
          to: filters.to ?? undefined,
        }}
      />

      {!searchable ? (
        <SearchLandingState popularCompetitions={popularCompetitions} popularTeams={popularTeams} />
      ) : null}

      {searchable ? (
        <>
          {hasActiveFilters(filters) ? (
            <p className="search-page__filters-note">
              Filtered to {filters.type ? SEARCH_TYPE_LABELS[filters.type] : 'all content types'}
              {filters.from || filters.to ? ' within the selected dates' : ''}.
            </p>
          ) : null}

          {result.status === 'error' ? (
            <Alert tone="error">
              Search is temporarily unavailable. Please try again, or browse{' '}
              <a href="/news">the latest news</a>.
            </Alert>
          ) : null}

          {result.status === 'ready' ? (
            <>
              <p className="search-page__summary" role="status">
                {result.pagination.total} result{result.pagination.total === 1 ? '' : 's'} for “{query}”
              </p>
              <SearchFiltersBar
                filters={filters}
                competitions={popularCompetitions.map((entity) => ({ slug: entity.slug, name: entity.name }))}
                teams={popularTeams.map((entity) => ({ slug: entity.slug, name: entity.name }))}
              />
              <SearchResultsSection results={result.items} query={query} />
              <SearchPagination pagination={result.pagination} filters={filters} />
            </>
          ) : null}

          {result.status === 'empty' || result.status === 'invalid' ? (
            <>
              <SearchNoResultsSignal query={query} hasFilters={hasActiveFilters(filters)} />
              <SearchEmptyState query={query} filters={filters} hasFilters={hasActiveFilters(filters)} />
            </>
          ) : null}
        </>
      ) : null}
        </section>
      </div>
    </PageLayout>
  );
}

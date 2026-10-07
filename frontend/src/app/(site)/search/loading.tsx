import { SearchFilterSkeleton, SearchResultSkeleton } from '@/components/search/SearchResultSkeleton';

/**
 * Search loading boundary.
 *
 * Reserves the search field, the filter bar and a fixed number of result slots
 * so the page does not shift when results arrive. A search field is not
 * rendered here: the field belongs to the page, and a placeholder input would be
 * unusable.
 */
export default function SearchLoading() {
  return (
    <section className="container search-page" aria-labelledby="search-loading-heading">
      <h1 id="search-loading-heading">Search</h1>
      <div className="search-input__field search-input__field--skeleton" aria-hidden="true">
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
      <SearchFilterSkeleton />
      <SearchResultSkeleton count={4} />
    </section>
  );
}

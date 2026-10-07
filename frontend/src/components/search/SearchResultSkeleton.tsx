/**
 * Result skeletons.
 *
 * Fixed-height slots mirror the real card so results do not shift the page when
 * they arrive. Everything decorative is hidden from assistive tech, with a
 * single status message so a screen reader is told once that loading is happening.
 */
export function SearchResultSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="search-skeleton" role="status" aria-label="Loading search results">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="search-card search-card--skeleton" aria-hidden="true">
          <div className="skeleton search-card__skeleton-image" />
          <div className="search-card__skeleton-body">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        </div>
      ))}
      <span className="visually-hidden">Loading search results</span>
    </div>
  );
}

/** Filter skeleton: one bar per control, so the toolbar height is stable. */
export function SearchFilterSkeleton() {
  return (
    <div className="search-filters search-filters--skeleton" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="skeleton" />
      ))}
    </div>
  );
}

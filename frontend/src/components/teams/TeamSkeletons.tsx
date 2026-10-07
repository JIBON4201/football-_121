/**
 * Route-level skeletons for the team surfaces. Each reserves a stable slot so
 * swapping in real content does not shift layout.
 */

function Rows({ count, label }: { count: number; label: string }) {
  return (
    <div role="status" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton" aria-hidden="true" />
      ))}
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

/** Team identity block placeholder. */
export function TeamProfileSkeleton() {
  return <Rows count={3} label="Loading team" />;
}

/** Squad list placeholder. */
export function SquadSkeleton({ count = 8 }: { count?: number }) {
  return <Rows count={count} label="Loading squad" />;
}

/** Fixture or result list placeholder. */
export function TeamMatchSkeleton({ count = 4 }: { count?: number }) {
  return <Rows count={count} label="Loading matches" />;
}

/** Competition list placeholder. */
export function TeamCompetitionSkeleton({ count = 3 }: { count?: number }) {
  return <Rows count={count} label="Loading competitions" />;
}

/** News list placeholder. */
export function TeamNewsSkeleton({ count = 3 }: { count?: number }) {
  return <Rows count={count} label="Loading news" />;
}

/** Aggregate statistics placeholder. */
export function TeamStatisticsSkeleton() {
  return <Rows count={2} label="Loading statistics" />;
}

/** Recent form placeholder. */
export function TeamFormSkeleton() {
  return <Rows count={1} label="Loading recent form" />;
}

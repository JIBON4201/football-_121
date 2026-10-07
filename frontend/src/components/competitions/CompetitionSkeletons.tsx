import type { ReactNode } from 'react';

/**
 * Route-level skeletons for the competition surfaces. Each reserves a stable
 * slot so swapping to real content does not shift layout.
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

/** Competition listing placeholder. */
export function CompetitionListSkeleton({ count = 8 }: { count?: number }) {
  return <Rows count={count} label="Loading competitions" />;
}

/** Competition identity block placeholder. */
export function CompetitionHeaderSkeleton() {
  return <Rows count={2} label="Loading competition" />;
}

/** League table placeholder: header row plus a handful of team rows. */
export function StandingsSkeleton({ rows = 8 }: { rows?: number }) {
  return <Rows count={rows} label="Loading standings" />;
}

/** Fixture list placeholder. */
export function MatchListSkeleton({ count = 5 }: { count?: number }) {
  return <Rows count={count} label="Loading matches" />;
}

/** Participating team list placeholder. */
export function TeamListSkeleton({ count = 6 }: { count?: number }) {
  return <Rows count={count} label="Loading teams" />;
}

/** News list placeholder. */
export function NewsSkeleton({ count = 4 }: { count?: number }) {
  return <Rows count={count} label="Loading news" />;
}

interface CompetitionSkeletonProps {
  children: ReactNode;
}

/** Generic wrapper used by the competition loading boundary. */
export function CompetitionSkeleton({ children }: CompetitionSkeletonProps) {
  return <div className="container">{children}</div>;
}

/**
 * Route-level skeletons for the player surfaces. Each reserves a stable slot so
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

/** Player identity block placeholder. */
export function PlayerProfileSkeleton() {
  return <Rows count={3} label="Loading player" />;
}

/** Statistics block placeholder. */
export function PlayerStatisticsSkeleton() {
  return <Rows count={2} label="Loading statistics" />;
}

/** Career list placeholder. */
export function CareerSkeleton({ count = 4 }: { count?: number }) {
  return <Rows count={count} label="Loading career" />;
}

/** Appearance list placeholder. */
export function PlayerMatchSkeleton({ count = 4 }: { count?: number }) {
  return <Rows count={count} label="Loading matches" />;
}

/** News list placeholder. */
export function PlayerNewsSkeleton({ count = 3 }: { count?: number }) {
  return <Rows count={count} label="Loading news" />;
}

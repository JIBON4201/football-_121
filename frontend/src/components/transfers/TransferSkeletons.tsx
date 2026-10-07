/**
 * Route-level skeletons for the transfer surfaces. Each reserves a stable slot
 * so swapping in real content does not shift layout.
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

/** Transfer record card placeholder. */
export function TransferCardSkeleton({ count = 6 }: { count?: number }) {
  return <Rows count={count} label="Loading transfers" />;
}

/** Transfer detail placeholder. */
export function TransferDetailSkeleton() {
  return <Rows count={4} label="Loading transfer" />;
}

/** Filter toolbar placeholder. */
export function TransferFilterSkeleton() {
  return <Rows count={2} label="Loading filters" />;
}

/** Transfer news placeholder. */
export function TransferNewsSkeleton({ count = 3 }: { count?: number }) {
  return <Rows count={count} label="Loading transfer news" />;
}

/** Shimmering placeholder. Pure CSS, no client JS, respects reduced motion. */
export function Skeleton({ width = '100%', height = 14 }: { width?: string | number; height?: string | number }) {
  const w = typeof width === 'number' ? `${width}px` : width;
  const h = typeof height === 'number' ? `${height}px` : height;
  return (
    <span
      className="cc-skeleton cc-skeleton--row"
      style={{ display: 'block', width: w, height: h }}
      aria-hidden="true"
    />
  );
}

/** Loading state shaped like the stat grid. */
export function StatGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="cc-stats-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="cc-skeleton--stat" />
      ))}
    </div>
  );
}

/** Loading state shaped like a panel of rows. */
export function PanelSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="cc-panel" aria-busy="true" aria-live="polite">
      <div className="cc-panel__head">
        <Skeleton width={140} height={12} />
      </div>
      <div className="cc-panel__body" style={{ display: 'grid', gap: 'var(--cc-space-3)' }}>
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} height={12} />
        ))}
      </div>
    </div>
  );
}
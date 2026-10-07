interface SkeletonProps {
  label: string;
  lines?: number;
  className?: string;
}

function Lines({ lines, label }: { lines: number; label: string }) {
  return (
    <div role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="skeleton" aria-hidden="true" />
      ))}
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

/** Route-level loading boundaries should reuse these (no layout shift: fixed slots). */
export function PageSkeleton() {
  return <Lines lines={6} label="Loading page" />;
}

export function CardSkeleton() {
  return <Lines lines={3} label="Loading card" />;
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  return <Lines lines={count} label="Loading list" />;
}

export function TableSkeleton() {
  return <Lines lines={8} label="Loading table" />;
}

export function MatchSkeleton() {
  return <Lines lines={4} label="Loading match" />;
}

/** News listing placeholder: stable card slots, no layout shift. */
export function ListingSkeleton({ count = 6 }: { count?: number }) {
  return <Lines lines={count} label="Loading articles" />;
}

/** Article detail placeholder: headline + body slots. */
export function ArticleSkeleton() {
  return <Lines lines={9} label="Loading article" />;
}

/** Live feed placeholder: one slot per live card, no layout shift on arrival. */
export function LiveMatchListSkeleton({ count = 4 }: { count?: number } = {}) {
  return (
    <div role="status" aria-label="Loading live matches" className="live-feed__skeleton">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="live-card live-card--skeleton" aria-hidden="true">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ))}
      <span className="visually-hidden">Loading live matches</span>
    </div>
  );
}

export function Skeleton({ label, lines = 3, className }: SkeletonProps) {
  return (
    <div className={className} role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="skeleton" aria-hidden="true" />
      ))}
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

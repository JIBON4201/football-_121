import type { ReactNode } from 'react';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Skeleton } from '@/components/ui/Skeleton';
import type { SectionStatus } from '@/lib/homepage';

interface SectionShellProps {
  id: string;
  title: string;
  href?: string;
  linkLabel?: string;
  status: SectionStatus;
  emptyTitle: string;
  emptyDescription?: string;
  errorDescription?: string;
  children: ReactNode;
  /** Visual identity hook. Live and breaking sections read as distinct zones. */
  tone?: 'live' | 'breaking';
}

/**
 * Consistent section frame: heading + canonical link, then ready content or
 * an honest empty/error state. One section's failure never affects others.
 */
export function SectionShell({
  id,
  title,
  href,
  linkLabel,
  status,
  emptyTitle,
  emptyDescription,
  errorDescription = 'This section is temporarily unavailable. Please try again later.',
  children,
  tone,
}: SectionShellProps) {
  return (
    <section aria-labelledby={id} className={tone ? `home-section home-section--${tone}` : 'home-section'}>
      <div className="home-section__header">
        <h2 id={id}>{title}</h2>
        {href ? (
          <a className="home-section__link" href={href}>
            {linkLabel ?? `All ${title.toLowerCase()}`}
          </a>
        ) : null}
      </div>
      {status === 'error' ? (
        <Alert tone="error">{errorDescription}</Alert>
      ) : status === 'empty' ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        children
      )}
    </section>
  );
}

/** Stable-dimension placeholder for streaming section boundaries. */
export function HomeSectionSkeleton({ label }: { label: string }) {
  return (
    <div className="home-section" aria-hidden="false">
      <Skeleton label={label} lines={4} />
    </div>
  );
}

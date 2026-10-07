import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Every Admin route opens with exactly one of these: an optional breadcrumb
 * trail, one h1, an optional supporting line, and the page's actions on the
 * right. Centralising it is what makes the sections feel like one product
 * rather than eleven separate pages.
 */

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="cc-crumbs" aria-label="Breadcrumb">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--cc-space-1)' }}>
            {index > 0 ? (
              <span className="cc-crumbs__sep" aria-hidden="true">
                /
              </span>
            ) : null}
            {crumb.href && !last ? (
              <Link href={crumb.href} className="cc-crumbs__link">
                {crumb.label}
              </Link>
            ) : (
              <span className={last ? 'cc-crumbs__current' : undefined} aria-current={last ? 'page' : undefined}>
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  /** Rendered beside the title — status badges, counts, reference ids. */
  meta?: ReactNode;
}) {
  return (
    <header className="cc-page-head">
      <div className="cc-page-head__text">
        {crumbs && crumbs.length > 0 ? <Breadcrumbs crumbs={crumbs} /> : null}
        <div className="cc-page-head__title">
          <h1 className="cc-title">{title}</h1>
          {meta}
        </div>
        {description ? <p className="cc-subtitle">{description}</p> : null}
      </div>
      {actions ? <div className="cc-page-head__actions">{actions}</div> : null}
    </header>
  );
}

/** Bordered content block with a heading row — the panel used across the panel. */
export function Panel({
  title,
  description,
  count,
  actions,
  children,
  footer,
  flush = false,
  labelledBy,
}: {
  title: string;
  description?: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  labelledBy?: string;
}) {
  const headingId = labelledBy ?? `cc-panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className="cc-panel" aria-labelledby={headingId}>
      <div className="cc-panel__head">
        <div>
          <h2 className="cc-panel__title" id={headingId}>
            {title}
          </h2>
          {description ? <p className="cc-panel__description">{description}</p> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--cc-space-2)' }}>
          {typeof count === 'number' ? <span className="cc-panel__count">{count}</span> : null}
          {actions}
        </div>
      </div>
      <div className={flush ? 'cc-panel__body cc-panel__body--flush' : 'cc-panel__body'}>{children}</div>
      {footer ? <div className="cc-panel__footer">{footer}</div> : null}
    </section>
  );
}
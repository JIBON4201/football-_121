import type { ReactNode } from 'react';

interface DashboardPanelProps {
  title: string;
  /** Count shown beside the heading (e.g. live rows in this list). */
  count?: number;
  children: ReactNode;
}

/** Frame for one dashboard list/section: heading, optional count, body. */
export function DashboardPanel({ title, count, children }: DashboardPanelProps) {
  return (
    <section className="cc-panel" aria-label={title}>
      <header className="cc-panel__head">
        <h2 className="cc-panel__title">{title}</h2>
        {typeof count === 'number' ? <span className="cc-panel__count">{count}</span> : null}
      </header>
      <div className="cc-panel__body">{children}</div>
    </section>
  );
}
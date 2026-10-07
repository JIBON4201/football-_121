import type { ReactNode } from 'react';

interface AlertProps {
  tone?: 'info' | 'warning' | 'error';
  role?: 'alert' | 'status';
  children: ReactNode;
}

/** Screen-reader-friendly alert (assertive for errors, polite otherwise). */
export function Alert({ tone = 'info', role, children }: AlertProps) {
  return (
    <div role={role ?? (tone === 'error' ? 'alert' : 'status')} data-tone={tone}>
      {children}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Friendly empty dataset state (never exposes internals).
 *
 * Deliberately a plain <div> with a <p> title rather than a <section>/<h2>:
 * an empty state is always a subordinate state inside a section that already
 * owns its heading, so emitting another landmark and a competing h2 would
 * pollute the document outline (eight extra regions on the homepage alone).
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {description ? <p className="empty-state__description">{description}</p> : null}
      {action}
    </div>
  );
}

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AdminDataTable, type AdminColumn } from './ui/AdminDataTable';
import { EmptyState } from './ui/Feedback';

/**
 * Shared list page frame for the reference modules.
 *
 * Teams, players, competitions, seasons, venues, users, roles and audit logs all
 * need the same thing: a heading, an optional "new" action, a table, an empty
 * state and pagination. Only the columns and the query differ. Before this
 * existed each of those routes was a 5 line `AdminSection` stub showing a title
 * and no data at all.
 *
 * This composes the existing `AdminDataTable` / `EmptyState` primitives rather
 * than introducing new UI; the Control Center's visual language is unchanged.
 */
export interface ResourcePageProps<T> {
  title: string;
  description: string;
  /** Anchor id so the heading is programmatically associated with the section. */
  titleId: string;
  rows: T[];
  columns: AdminColumn<T>[];
  rowKey: (row: T) => string;
  caption: string;
  emptyTitle: string;
  emptyDescription?: string;
  /** Rendered next to the heading when the admin holds the create permission. */
  action?: ReactNode;
  /** Search/filter controls rendered between the heading and the table. */
  toolbar?: ReactNode;
  pagination?: ReactNode;
  /** Inline banner above the table, e.g. a delete conflict. */
  notice?: ReactNode;
}

export function ResourcePage<T>({
  title,
  description,
  titleId,
  rows,
  columns,
  rowKey,
  caption,
  emptyTitle,
  emptyDescription,
  action,
  toolbar,
  pagination,
  notice,
}: ResourcePageProps<T>) {
  return (
    <section className="cc dashboard" aria-labelledby={titleId}>
      <div className="cc page head">
        <div>
          <h1 id={titleId} className="cc section__title">
            {title}
          </h1>
          <p className="cc muted">{description}</p>
        </div>
        {action}
      </div>

      {notice}
      {toolbar}

      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <AdminDataTable<T> columns={columns} rows={rows} caption={caption} rowKey={rowKey} count={rows.length} />
          {pagination}
        </>
      )}
    </section>
  );
}

/** "New <entity>" button shown only when the admin holds the create permission. */
export function NewEntityLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="cc-button cc-button--primary" href={href}>
      {label}
    </Link>
  );
}

/**
 * Server driven pagination. Query preservation is the point: filters live in the
 * URL, so page links must carry them forward or page 2 silently drops the filter.
 */
export function ResourcePagination({
  basePath,
  page,
  totalPages,
  total,
  noun,
  params,
}: {
  basePath: string;
  page: number;
  totalPages: number;
  total: number;
  noun: string;
  params: URLSearchParams;
}) {
  const prev = new URLSearchParams(params);
  if (page > 1) prev.set('page', String(page - 1));
  const next = new URLSearchParams(params);
  next.set('page', String(page + 1));

  return (
    <nav className="cc pagination" aria-label={`${noun} pages`}>
      {page > 1 ? (
        <Link className="cc-button cc-button--ghost cc-button--sm" href={`${basePath}?${prev.toString()}`}>
          Previous
        </Link>
      ) : (
        <span className="cc muted">Previous</span>
      )}
      <span className="cc pagination__status">
        Page {page} of {totalPages} - {total} {total === 1 ? noun.toLowerCase().replace(/s$/, '') : noun.toLowerCase()}
      </span>
      {page < totalPages ? (
        <Link className="cc-button cc-button--ghost cc-button--sm" href={`${basePath}?${next.toString()}`}>
          Next
        </Link>
      ) : (
        <span className="cc muted">Next</span>
      )}
    </nav>
  );
}
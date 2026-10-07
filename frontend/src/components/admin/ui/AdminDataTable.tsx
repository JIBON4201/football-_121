import type { ReactNode } from 'react';
import { AdminIcon } from './AdminIcon';
import { AdminButton } from './AdminButton';
import { Skeleton } from './Skeleton';

/**
 * AdminDataTable — the only table in the Control Center.
 *
 * Server-rendered and dependency-free. Three things it guarantees so no page
 * has to think about them:
 *
 *  1. Column headers carry `data-label`, which the mobile stylesheet turns into
 *     a stacked label/value record. That is why narrow screens get a readable
 *     list instead of a horizontal scrollbar.
 *  2. Columns may opt out of that via `primary`, so the entity name spans the
 *     row instead of repeating its own label.
 *  3. Loading / empty / error are states of the table itself, not of each page.
 */

export interface AdminColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Right-align and tabular-align. Use for counts, scores, fees, dates. */
  numeric?: boolean;
  /** Hide the mobile label and let the value span the row. */
  primary?: boolean;
  /** Extra class on both the header and body cells. */
  className?: string;
}

export interface AdminDataTableProps<T> {
  columns: AdminColumn<T>[];
  rows: T[];
  caption: string;
  rowKey: (row: T, index: number) => string;
  /** Row count for the panel heading. */
  count?: number;
  loading?: boolean;
  loadingRows?: number;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRetry?: () => void;
}

export function AdminDataTable<T>({
  columns,
  rows,
  caption,
  rowKey,
  count,
  loading = false,
  loadingRows = 8,
  error = null,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  emptyAction,
  onRetry,
}: AdminDataTableProps<T>) {
  return (
    <div className="cc-table-wrap">
      <table>
        <caption className="cc-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.className}
                data-numeric={column.numeric ? 'true' : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: loadingRows }, (_, rowIndex) => (
              <tr key={`skeleton-${rowIndex}`}>
                {columns.map((column) => (
                  <td key={column.key} data-primary={column.primary ? 'true' : undefined}>
                    <Skeleton width={column.primary ? '70%' : '45%'} />
                  </td>
                ))}
              </tr>
            ))
          ) : (
            rows.map((row, index) => (
              <tr key={rowKey(row, index)}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={column.className}
                    data-label={column.header}
                    data-primary={column.primary ? 'true' : undefined}
                    data-numeric={column.numeric ? 'true' : undefined}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {!loading && error ? (
        <TableFooter>
          <div className="cc-state cc-state--error" role="alert" style={{ padding: 'var(--cc-space-8) var(--cc-space-4)' }}>
            <span className="cc-state__icon">
              <AdminIcon name="alert" size={18} />
            </span>
            <p className="cc-state__title">Could not load {caption.toLowerCase()}</p>
            <p className="cc-state__message">{error}</p>
            {onRetry ? (
              <div className="cc-state__action">
                <AdminButton icon="refresh" onClick={onRetry}>
                  Try again
                </AdminButton>
              </div>
            ) : null}
          </div>
        </TableFooter>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <TableFooter>
          <div className="cc-empty">
            <span className="cc-empty__icon">
              <AdminIcon name="inbox" size={18} />
            </span>
            <p className="cc-empty__title">{emptyTitle}</p>
            {emptyDescription ? <p className="cc-empty__description">{emptyDescription}</p> : null}
            {emptyAction ? <div className="cc-empty__action">{emptyAction}</div> : null}
          </div>
        </TableFooter>
      ) : null}

      {!loading && !error && rows.length > 0 && typeof count === 'number' ? (
        <div className="cc-pagination">
          <span className="cc-pagination__status">
            {count} {count === 1 ? 'row' : 'rows'}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function TableFooter({ children }: { children: ReactNode }) {
  return <div style={{ borderTop: '1px solid var(--cc-border-subtle)' }}>{children}</div>;
}
import type { ReactNode } from 'react';
import { RefCell } from './RefCell';
import { StatusBadge } from './ui/StatusBadge';
import { formatDate } from '@/lib/dates';
import { toLabelLookup, type LabelLookup } from '@/lib/admin/options-shared';
import type { AdminColumn } from './ui/AdminDataTable';

/**
 * Column builders shared by the reference list pages.
 *
 * Keeps teams/players/competitions/seasons/venues visually consistent and stops
 * each page from re-deriving "how do I render a null country id".
 */

export { toLabelLookup, type LabelLookup };

/**
 * Render a foreign key as its resolved name, falling back to the id preview.
 *
 * Relationship columns show a name because an operator cannot act on a UUID;
 * the raw id stays in the tooltip so a wrong mapping is still diagnosable.
 */
export function RefLabel({ id, lookup }: { id: string | null; lookup?: LabelLookup }): ReactNode {
  if (!id) return <span className="cc-muted">—</span>;
  const label = lookup?.get(id);
  if (!label) return <RefCell id={id} />;
  return (
    <span className="cc-ellipsis" title={id}>
      {label}
    </span>
  );
}

/** A nullable text column that shows an em dash rather than an empty cell. */
export function textColumn<T>(key: string, header: string, pick: (row: T) => string | null | undefined): AdminColumn<T> {
  return {
    key,
    header,
    render: (row) => {
      const value = pick(row);
      return value ? <span className="cc-ellipsis">{value}</span> : <span className="cc-muted">—</span>;
    },
  };
}

/** A right-aligned numeric column. */
export function numberColumn<T>(key: string, header: string, pick: (row: T) => number | null | undefined): AdminColumn<T> {
  return {
    key,
    header,
    numeric: true,
    render: (row) => {
      const value = pick(row);
      return value === null || value === undefined ? <span className="cc-muted">—</span> : <span>{value}</span>;
    },
  };
}

/** A date column using the shared UTC-first formatter. */
export function dateColumn<T>(key: string, header: string, pick: (row: T) => string | null | undefined): AdminColumn<T> {
  return {
    key,
    header,
    numeric: true,
    render: (row) => {
      const value = pick(row);
      return value ? <span className="cc-dt">{formatDate(value)}</span> : <span className="cc-muted">—</span>;
    },
  };
}

export { StatusBadge };
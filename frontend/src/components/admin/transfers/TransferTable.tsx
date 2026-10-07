import { AdminDataTable, type AdminColumn } from '@/components/admin/ui/AdminDataTable';
import { AdminLinkButton } from '@/components/admin/ui/AdminButton';
import { StatusBadge } from '@/components/admin/ui/StatusBadge';
import { ConfirmAction } from '@/components/admin/ui/ConfirmDialog';
import { RefCell } from '@/components/admin/RefCell';
import { deleteTransferAction } from '@/app/control-center/transfers/actions';
import { formatDate } from '@/lib/dates';
import type { AdminTransferRow } from '@/types/api';

interface TransferTableProps {
  rows: AdminTransferRow[];
  permissions: string[];
}

function formatFee(fee: number | null, currency: string | null): string {
  if (fee === null) return '—';
  try {
    return `${fee.toLocaleString('en-GB')} ${currency ?? ''}`.trim();
  } catch {
    return currency ? `${fee} ${currency}` : String(fee);
  }
}

/** Server-rendered management table; only the delete control is client-side. */
export function TransferTable({ rows, permissions }: TransferTableProps) {
  const canUpdate = permissions.includes('transfers.update');
  const canDelete = permissions.includes('transfers.delete');

  const columns: AdminColumn<AdminTransferRow>[] = [
    { key: 'player', header: 'Player', primary: true, render: (t) => <RefCell id={t.player_id} /> },
    { key: 'from', header: 'From', render: (t) => <RefCell id={t.from_team_id} /> },
    { key: 'to', header: 'To', render: (t) => <RefCell id={t.to_team_id} /> },
    { key: 'window', header: 'Window', render: (t) => <RefCell id={t.window_id} /> },
    {
      key: 'effective',
      header: 'Transfer date',
      numeric: true,
      render: (t) => (t.effective_date ? <span className="cc-dt">{formatDate(t.effective_date)}</span> : <span className="cc-muted">—</span>),
    },
    { key: 'fee', header: 'Fee', numeric: true, render: (t) => <span className="cc-score">{formatFee(t.fee, t.currency)}</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
    { key: 'type', header: 'Type', render: (t) => <span className="cc-muted">{t.transfer_type.replace(/_/g, ' ')}</span> },
    {
      key: 'actions',
      header: 'Actions',
      render: (t) => (
        <span className="cc-row-actions">
          {canUpdate ? (
            <AdminLinkButton href={`/control-center/transfers/${t.id}/edit`} variant="ghost" size="sm">
              Edit
            </AdminLinkButton>
          ) : null}
          {canDelete ? (
            <ConfirmAction
              label="Delete transfer"
              message="Delete this transfer? This cannot be undone."
              action={deleteTransferAction.bind(null, t.id)}
            />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <AdminDataTable<AdminTransferRow>
      columns={columns}
      rows={rows}
      caption="Transfers"
      rowKey={(row) => row.id}
      count={rows.length}
      emptyTitle="No transfers found"
      emptyDescription="Adjust the filters, or create the first transfer."
    />
  );
}

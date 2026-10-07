import { AdminDataTable, type AdminColumn } from '@/components/admin/ui/AdminDataTable';
import { AdminLinkButton } from '@/components/admin/ui/AdminButton';
import { StatusBadge } from '@/components/admin/ui/StatusBadge';
import { ConfirmAction } from '@/components/admin/ui/ConfirmDialog';
import { RefCell } from '@/components/admin/RefCell';
import { deleteMatchAction } from '@/app/control-center/matches/actions';
import { formatDateTime } from '@/lib/dates';
import type { AdminMatchRow } from '@/types/api';

interface MatchTableProps {
  rows: AdminMatchRow[];
  permissions: string[];
}

function score(row: AdminMatchRow): string {
  return row.home_score === null || row.away_score === null ? '—' : `${row.home_score}–${row.away_score}`;
}

export function MatchTable({ rows, permissions }: MatchTableProps) {
  const canUpdate = permissions.includes('matches.update');
  const canDelete = permissions.includes('matches.delete');

  const columns: AdminColumn<AdminMatchRow>[] = [
    { key: 'home', header: 'Home', primary: true, render: (m) => <RefCell id={m.home_team_id} /> },
    { key: 'away', header: 'Away', render: (m) => <RefCell id={m.away_team_id} /> },
    { key: 'competition', header: 'Competition', render: (m) => <RefCell id={m.competition_id} /> },
    { key: 'season', header: 'Season', render: (m) => <RefCell id={m.season_id} /> },
    { key: 'venue', header: 'Venue', render: (m) => <RefCell id={m.venue_id} /> },
    { key: 'kickoff', header: 'Kickoff', numeric: true, render: (m) => <span className="cc-dt">{formatDateTime(m.scheduled_at)}</span> },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> },
    { key: 'score', header: 'Score', numeric: true, render: (m) => <span className="cc-score">{score(m)}</span> },
    {
      key: 'actions',
      header: 'Actions',
      render: (m) => (
        <span className="cc-row-actions">
          <AdminLinkButton href={`/control-center/matches/${m.id}`} variant="ghost" size="sm">View</AdminLinkButton>
          {canUpdate ? (
            <AdminLinkButton href={`/control-center/matches/${m.id}/edit`} variant="ghost" size="sm">Edit</AdminLinkButton>
          ) : null}
          {canDelete ? (
            <ConfirmAction
              label="Delete match"
              message="Delete this match? Matches with dependents (events, statistics) cannot be deleted."
              action={deleteMatchAction.bind(null, m.id)}
            />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <AdminDataTable<AdminMatchRow>
      columns={columns}
      rows={rows}
      caption="Matches"
      rowKey={(row) => row.id}
      count={rows.length}
      emptyTitle="No matches found"
      emptyDescription="Adjust the filters, or create the first match."
    />
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ConfirmDeleteButton, RowActions } from '@/components/admin/ConfirmDeleteButton';
import { NewEntityLink, ResourcePagination, ResourcePage } from '@/components/admin/ResourcePage';
import { ResourceToolbar } from '@/components/admin/ResourceToolbar';
import { RefLabel, dateColumn, toLabelLookup } from '@/components/admin/columns';
import { deleteSeasonAction } from '@/app/control-center/reference/actions';
import { readBoolean, readListQuery, readUuid, toSearchParams } from '@/lib/admin/list-query';
import { fetchOptionCompetitions } from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminSeasons } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';
import type { AdminColumn } from '@/components/admin/ui/AdminDataTable';
import type { AdminSeasonRow } from '@/types/api';

export const metadata: Metadata = { title: 'Seasons Â· Control Center', robots: { index: false, follow: false } };

const BASE = '/control-center/seasons';

export default async function SeasonsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('seasons.read')) return <AccessDenied />;

  const query = readListQuery(searchParams);
  const current = readBoolean(searchParams.current);
  const competitionId = readUuid(searchParams.competition_id);
  const listQuery: Record<string, string | number | boolean | undefined> = { page: query.page, limit: query.limit, q: query.q };
  if (current !== undefined) listQuery.current = current;
  if (competitionId) listQuery.competition_id = competitionId;

  const [result, competitions] = await Promise.all([adminSeasons.list(listQuery), fetchOptionCompetitions()]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Seasons unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result.data;
  // Seasons have a single write grant (`seasons.manage`), not read/create/update/delete.
  const canManage = session.user.permissions.includes('seasons.manage');
  const competitionLookup = toLabelLookup(competitions);

  const columns: AdminColumn<AdminSeasonRow>[] = [
    {
      key: 'name',
      header: 'Season',
      primary: true,
      render: (row) => (
        <span className="cc-cell-title">
          <span className="cc-ellipsis" title={row.name}>
            {row.name}
          </span>
          {row.is_current ? <span className="cc-badge cc-badge--breaking">Current</span> : null}
        </span>
      ),
    },
    { key: 'competition', header: 'Competition', render: (row) => <RefLabel id={row.competition_id} lookup={competitionLookup} /> },
    { key: 'start', header: 'Starts', numeric: true, render: (row) => (row.start_date ? <span className="cc-dt">{row.start_date}</span> : <span className="cc-muted">â€”</span>) },
    { key: 'end', header: 'Ends', numeric: true, render: (row) => (row.end_date ? <span className="cc-dt">{row.end_date}</span> : <span className="cc-muted">â€”</span>) },
    dateColumn('updated', 'Updated', (row) => row.updated_at),
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <RowActions>
          {canManage ? (
            <>
              <a className="cc-button cc-button--ghost cc-button--sm" href={`${BASE}/${row.id}/edit`}>
                Edit
              </a>
              <ConfirmDeleteButton
                id={row.id}
                label={`Delete ${row.name}`}
                entity="season"
                consequence="Seasons with matches, transfers or windows cannot be deleted."
                action={deleteSeasonAction.bind(null, row.id)}
              />
            </>
          ) : null}
        </RowActions>
      ),
    },
  ];

  return (
    <ResourcePage<AdminSeasonRow>
      title="Seasons"
      description="Competition seasons. A season belongs to exactly one competition."
      titleId="cc-seasons-title"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      caption="Seasons"
      emptyTitle="No seasons found"
      emptyDescription={query.q ? 'No season matches that search.' : 'Create the first season to get started.'}
      action={canManage ? <NewEntityLink href={`${BASE}/new`} label="New season" /> : null}
      toolbar={
        <ResourceToolbar
          basePath={BASE}
          searchPlaceholder="Search seasons by name"
          filters={[
            {
              param: 'competition_id',
              label: 'Competition',
              options: competitions.map((row) => ({ value: row.id, label: row.label })),
            },
            {
              param: 'current',
              label: 'Status',
              options: [
                { value: 'true', label: 'Current' },
                { value: 'false', label: 'Past / future' },
              ],
            },
          ]}
        />
      }
      pagination={
        <ResourcePagination
          basePath={BASE}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          noun="seasons"
          params={toSearchParams(searchParams)}
        />
      }
    />
  );
}
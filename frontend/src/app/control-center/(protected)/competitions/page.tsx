import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ConfirmDeleteButton, RowActions } from '@/components/admin/ConfirmDeleteButton';
import { NewEntityLink, ResourcePagination, ResourcePage } from '@/components/admin/ResourcePage';
import { ResourceToolbar } from '@/components/admin/ResourceToolbar';
import { RefLabel, dateColumn, toLabelLookup } from '@/components/admin/columns';
import { deleteCompetitionAction } from '@/app/control-center/reference/actions';
import { readBoolean, readListQuery, toSearchParams } from '@/lib/admin/list-query';
import { fetchOptionCountries } from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminCompetitions } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';
import type { AdminColumn } from '@/components/admin/ui/AdminDataTable';
import type { AdminCompetitionRow } from '@/types/api';

export const metadata: Metadata = { title: 'Competitions Â· Control Center', robots: { index: false, follow: false } };

const BASE = '/control-center/competitions';

export default async function CompetitionsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('competitions.read')) return <AccessDenied />;

  const query = readListQuery(searchParams);
  const active = readBoolean(searchParams.active);
  const listQuery: Record<string, string | number | boolean | undefined> = { page: query.page, limit: query.limit, q: query.q };
  if (active !== undefined) listQuery.active = active;

  const [result, countries] = await Promise.all([adminCompetitions.list(listQuery), fetchOptionCountries()]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Competitions unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result.data;
  const canCreate = session.user.permissions.includes('competitions.create');
  const canUpdate = session.user.permissions.includes('competitions.update');
  const canDelete = session.user.permissions.includes('competitions.delete');
  const countryLookup = toLabelLookup(countries);

  const columns: AdminColumn<AdminCompetitionRow>[] = [
    {
      key: 'name',
      header: 'Competition',
      primary: true,
      render: (row) => (
        <span className="cc-cell-title">
          <span className="cc-ellipsis" title={row.name}>
            {row.name}
          </span>
          {row.short_name ? <span className="cc-badge">{row.short_name}</span> : null}
          {!row.is_active ? <span className="cc-badge cc-badge--muted">Inactive</span> : null}
        </span>
      ),
    },
    { key: 'country', header: 'Country', render: (row) => <RefLabel id={row.country_id} lookup={countryLookup} /> },
    { key: 'type', header: 'Type', render: (row) => (row.type ? <span>{row.type}</span> : <span className="cc-muted">â€”</span>) },
    { key: 'gender', header: 'Gender', render: (row) => (row.gender ? <span>{row.gender}</span> : <span className="cc-muted">â€”</span>) },
    dateColumn('updated', 'Updated', (row) => row.updated_at),
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <RowActions>
          {canUpdate ? (
            <a className="cc-button cc-button--ghost cc-button--sm" href={`${BASE}/${row.id}/edit`}>
              Edit
            </a>
          ) : null}
          {canDelete ? (
            <ConfirmDeleteButton
              id={row.id}
              label={`Delete ${row.name}`}
              entity="competition"
              consequence="Competitions with seasons, matches or standings cannot be deleted â€” deactivate it instead."
              action={deleteCompetitionAction.bind(null, row.id)}
            />
          ) : null}
        </RowActions>
      ),
    },
  ];

  return (
    <ResourcePage<AdminCompetitionRow>
      title="Competitions"
      description="Leagues and cups, and whether they are currently listed."
      titleId="cc-competitions-title"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      caption="Competitions"
      emptyTitle="No competitions found"
      emptyDescription={query.q ? 'No competition matches that search.' : 'Create the first competition to get started.'}
      action={canCreate ? <NewEntityLink href={`${BASE}/new`} label="New competition" /> : null}
      toolbar={
        <ResourceToolbar
          basePath={BASE}
          searchPlaceholder="Search competitions by name"
          filters={[
            {
              param: 'active',
              label: 'Status',
              options: [
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
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
          noun="competitions"
          params={toSearchParams(searchParams)}
        />
      }
    />
  );
}
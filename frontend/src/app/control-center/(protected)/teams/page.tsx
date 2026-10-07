import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { NewEntityLink, ResourcePagination, ResourcePage } from '@/components/admin/ResourcePage';
import { ResourceToolbar } from '@/components/admin/ResourceToolbar';
import { DeleteTeamButton } from '@/components/admin/teams/DeleteTeamButton';
import { RefLabel, dateColumn, toLabelLookup } from '@/components/admin/columns';
import { readBoolean, readListQuery, toSearchParams } from '@/lib/admin/list-query';
import { fetchOptionCountries, fetchOptionVenues } from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminTeams } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';
import type { AdminColumn } from '@/components/admin/ui/AdminDataTable';
import type { AdminTeamRow } from '@/types/api';

export const metadata: Metadata = { title: 'Teams - Control Center', robots: { index: false, follow: false } };

const BASE = '/control-center/teams';

export default async function TeamsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('teams.read')) return <AccessDenied />;

  const query = readListQuery(searchParams, { extra: { active: searchParams.active } });
  // `active` is a backend filter: omit it entirely rather than sending "all",
  // which the zod schema would reject.
  const listQuery: Record<string, string | number | boolean | undefined> = { page: query.page, limit: query.limit, q: query.q };
  const active = readBoolean(searchParams.active);
  if (active !== undefined) listQuery.active = active;

  const [result, countries, venues] = await Promise.all([
    adminTeams.list(listQuery),
    fetchOptionCountries(),
    fetchOptionVenues(),
  ]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Teams unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result.data;
  const canCreate = session.user.permissions.includes('teams.create');
  const canUpdate = session.user.permissions.includes('teams.update');
  const canDelete = session.user.permissions.includes('teams.delete');
  const countryLookup = toLabelLookup(countries);
  const venueLookup = toLabelLookup(venues);

  const columns: AdminColumn<AdminTeamRow>[] = [
    {
      key: 'name',
      header: 'Team',
      primary: true,
      render: (row) => (
        <span className="cc cell title">
          <span className="cc ellipsis" title={row.name}>
            {row.name}
          </span>
          {row.short_name ? <span className="cc badge">{row.short_name}</span> : null}
          {!row.is_active ? <span className="cc badge cc badge--muted">Inactive</span> : null}
        </span>
      ),
    },
    { key: 'country', header: 'Country', render: (row) => <RefLabel id={row.country_id} lookup={countryLookup} /> },
    { key: 'venue', header: 'Home venue', render: (row) => <RefLabel id={row.venue_id} lookup={venueLookup} /> },
    { key: 'founded', header: 'Founded', numeric: true, render: (row) => (row.founded_year ?? <span className="cc muted"> -  - </span>) },
    dateColumn('updated', 'Updated', (row) => row.updated_at),
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <span className="cc row actions">
          {canUpdate ? (
            <a className="cc-button cc-button--ghost cc-button--sm" href={`${BASE}/${row.id}/edit`}>
              Edit
            </a>
          ) : null}
          {canDelete ? <DeleteTeamButton id={row.id} name={row.name} /> : null}
        </span>
      ),
    },
  ];

  return (
    <ResourcePage<AdminTeamRow>
      title="Teams"
      description="Clubs, their country and home ground."
      titleId="cc teams title"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      caption="Teams"
      emptyTitle="No teams found"
      emptyDescription={query.q ? 'No team matches that search.' : 'Create the first team to get started.'}
      action={canCreate ? <NewEntityLink href={`${BASE}/new`} label="New team" /> : null}
      toolbar={
        <ResourceToolbar
          basePath={BASE}
          searchPlaceholder="Search teams by name"
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
          noun="teams"
          params={toSearchParams(searchParams)}
        />
      }
    />
  );
}
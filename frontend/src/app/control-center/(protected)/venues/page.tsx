import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ConfirmDeleteButton, RowActions } from '@/components/admin/ConfirmDeleteButton';
import { NewEntityLink, ResourcePagination, ResourcePage } from '@/components/admin/ResourcePage';
import { ResourceToolbar } from '@/components/admin/ResourceToolbar';
import { RefLabel, dateColumn, toLabelLookup } from '@/components/admin/columns';
import { deleteVenueAction } from '@/app/control-center/reference/actions';
import { readListQuery, readUuid, toSearchParams } from '@/lib/admin/list-query';
import { fetchOptionCountries } from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminVenues } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';
import type { AdminColumn } from '@/components/admin/ui/AdminDataTable';
import type { AdminVenueRow } from '@/types/api';

export const metadata: Metadata = { title: 'Venues Â· Control Center', robots: { index: false, follow: false } };

const BASE = '/control-center/venues';

export default async function VenuesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('venues.read')) return <AccessDenied />;

  const query = readListQuery(searchParams);
  const countryId = readUuid(searchParams.country_id);
  const listQuery: Record<string, string | number | undefined> = { page: query.page, limit: query.limit, q: query.q };
  if (countryId) listQuery.countryId = countryId;

  const [result, countries] = await Promise.all([adminVenues.list(listQuery), fetchOptionCountries()]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Venues unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result.data;
  const canManage = session.user.permissions.includes('venues.manage');
  const countryLookup = toLabelLookup(countries);

  const columns: AdminColumn<AdminVenueRow>[] = [
    {
      key: 'name',
      header: 'Venue',
      primary: true,
      render: (row) => (
        <span className="cc-cell-title">
          <span className="cc-ellipsis" title={row.name}>
            {row.name}
          </span>
        </span>
      ),
    },
    { key: 'city', header: 'City', render: (row) => (row.city ? <span>{row.city}</span> : <span className="cc-muted">â€”</span>) },
    { key: 'country', header: 'Country', render: (row) => <RefLabel id={row.country_id} lookup={countryLookup} /> },
    { key: 'capacity', header: 'Capacity', numeric: true, render: (row) => (row.capacity ? <span>{row.capacity.toLocaleString('en-GB')}</span> : <span className="cc-muted">â€”</span>) },
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
                entity="venue"
                consequence="Venues referenced by teams or matches cannot be deleted."
                action={deleteVenueAction.bind(null, row.id)}
              />
            </>
          ) : null}
        </RowActions>
      ),
    },
  ];

  return (
    <ResourcePage<AdminVenueRow>
      title="Venues"
      description="Stadiums and grounds, with capacity and location."
      titleId="cc-venues-title"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      caption="Venues"
      emptyTitle="No venues found"
      emptyDescription={query.q ? 'No venue matches that search.' : 'Create the first venue to get started.'}
      action={canManage ? <NewEntityLink href={`${BASE}/new`} label="New venue" /> : null}
      toolbar={
        <ResourceToolbar
          basePath={BASE}
          searchPlaceholder="Search venues by name"
          filters={[
            {
              param: 'country_id',
              label: 'Country',
              options: countries.map((row) => ({ value: row.id, label: row.label })),
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
          noun="venues"
          params={toSearchParams(searchParams)}
        />
      }
    />
  );
}
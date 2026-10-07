import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ConfirmDeleteButton, RowActions } from '@/components/admin/ConfirmDeleteButton';
import { NewEntityLink, ResourcePagination, ResourcePage } from '@/components/admin/ResourcePage';
import { ResourceToolbar } from '@/components/admin/ResourceToolbar';
import { RefLabel, dateColumn, toLabelLookup } from '@/components/admin/columns';
import { deletePlayerAction } from '@/app/control-center/reference/actions';
import { readListQuery, toSearchParams } from '@/lib/admin/list-query';
import { fetchOptionCountries } from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminPlayers } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';
import type { AdminColumn } from '@/components/admin/ui/AdminDataTable';
import type { AdminPlayerRow } from '@/types/api';

export const metadata: Metadata = { title: 'Players Â· Control Center', robots: { index: false, follow: false } };

const BASE = '/control-center/players';

export default async function PlayersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('players.read')) return <AccessDenied />;

  const query = readListQuery(searchParams);
  const [result, countries] = await Promise.all([adminPlayers.list({ page: query.page, limit: query.limit, q: query.q }), fetchOptionCountries()]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Players unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result.data;
  const canCreate = session.user.permissions.includes('players.create');
  const canUpdate = session.user.permissions.includes('players.update');
  const canDelete = session.user.permissions.includes('players.delete');
  const countryLookup = toLabelLookup(countries);

  const columns: AdminColumn<AdminPlayerRow>[] = [
    {
      key: 'name',
      header: 'Player',
      primary: true,
      render: (row) => (
        <span className="cc-cell-title">
          <span className="cc-ellipsis" title={row.display_name}>
            {row.display_name}
          </span>
          {row.position ? <span className="cc-badge">{row.position}</span> : null}
        </span>
      ),
    },
    { key: 'country', header: 'Nationality', render: (row) => <RefLabel id={row.nationality_id} lookup={countryLookup} /> },
    { key: 'foot', header: 'Foot', render: (row) => (row.preferred_foot ? <span>{row.preferred_foot}</span> : <span className="cc-muted">â€”</span>) },
    { key: 'height', header: 'Height', numeric: true, render: (row) => (row.height_cm ? <span>{row.height_cm} cm</span> : <span className="cc-muted">â€”</span>) },
    { key: 'dob', header: 'Born', numeric: true, render: (row) => (row.date_of_birth ? <span className="cc-dt">{row.date_of_birth}</span> : <span className="cc-muted">â€”</span>) },
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
              label={`Delete ${row.display_name}`}
              entity="player"
              consequence="Players referenced by match events, statistics or transfers cannot be deleted."
              action={deletePlayerAction.bind(null, row.id)}
            />
          ) : null}
        </RowActions>
      ),
    },
  ];

  return (
    <ResourcePage<AdminPlayerRow>
      title="Players"
      description="Squads, positions and nationalities."
      titleId="cc-players-title"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      caption="Players"
      emptyTitle="No players found"
      emptyDescription={query.q ? 'No player matches that search.' : 'Create the first player to get started.'}
      action={canCreate ? <NewEntityLink href={`${BASE}/new`} label="New player" /> : null}
      toolbar={<ResourceToolbar basePath={BASE} searchPlaceholder="Search players by name" />}
      pagination={
        <ResourcePagination
          basePath={BASE}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          noun="players"
          params={toSearchParams(searchParams)}
        />
      }
    />
  );
}
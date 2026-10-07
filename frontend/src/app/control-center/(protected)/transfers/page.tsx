import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { TransferFilters } from '@/components/admin/transfers/TransferFilters';
import { TransferTable } from '@/components/admin/transfers/TransferTable';
import { EmptyState } from '@/components/admin/ui/Feedback';
import {
  parseTransfersQuery,
  transfersQueryToSearch,
  fetchAdminTransfers,
  fetchPublicPlayers,
  fetchPublicTeams,
  fetchPublicWindows,
  fetchAdminSeasons,
} from '@/lib/admin/transfers';
import { adminFailureMessage } from '@/lib/admin/resource';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Transfers - Control Center', robots: { index: false, follow: false } };

function Pagination({ page, totalPages, total, params }: { page: number; totalPages: number; total: number; params: URLSearchParams }) {
  const prev = new URLSearchParams(params);
  prev.set('page', String(Math.max(1, page - 1)));
  const next = new URLSearchParams(params);
  next.set('page', String(page + 1));
  return (
    <nav className="cc pagination" aria-label="Transfer pages">
      {page > 1 ? (
        <Link className="cc-button cc-button--ghost cc-button--sm" href={`/control-center/transfers?${prev.toString()}`}>
          Previous
        </Link>
      ) : (
        <span className="cc muted">Previous</span>
      )}
      <span className="cc pagination__status">
        Page {page} of {totalPages} - {total} transfer{total === 1 ? '' : 's'}
      </span>
      {page < totalPages ? (
        <Link className="cc-button cc-button--ghost cc-button--sm" href={`/control-center/transfers?${next.toString()}`}>
          Next
        </Link>
      ) : (
        <span className="cc muted">Next</span>
      )}
    </nav>
  );
}

export default async function TransfersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('transfers.read')) return <AccessDenied />;

  const query = parseTransfersQuery(searchParams);
  const [result, players, teams, windows, seasons] = await Promise.all([
    fetchAdminTransfers(query),
    fetchPublicPlayers(),
    fetchPublicTeams(),
    fetchPublicWindows(),
    fetchAdminSeasons(),
  ]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Transfers unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result;
  const canCreate = session.user.permissions.includes('transfers.create');

  return (
    <section className="cc dashboard" aria-labelledby="cc transfers title">
      <div className="cc page head">
        <h1 id="cc transfers title" className="cc section__title">Transfers</h1>
        {canCreate ? (
          <Link href="/control-center/transfers/new" className="cc-button cc-button--primary">New transfer</Link>
        ) : null}
      </div>

      <TransferFilters query={query} players={players} teams={teams} windows={windows} seasons={seasons} />

      {rows.length === 0 ? (
        <EmptyState title="No transfers found" description="Adjust the filters, or create the first transfer." />
      ) : (
        <>
          <TransferTable rows={rows} permissions={session.user.permissions} />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} params={transfersQueryToSearch(query)} />
        </>
      )}
    </section>
  );
}

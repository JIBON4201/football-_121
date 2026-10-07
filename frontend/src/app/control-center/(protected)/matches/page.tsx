import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { MatchesFilters } from '@/components/admin/matches/MatchesFilters';
import { MatchTable } from '@/components/admin/matches/MatchTable';
import { EmptyState } from '@/components/admin/ui/Feedback';
import {
  fetchAdminMatches,
  matchesQueryToSearch,
  parseMatchesQuery,
} from '@/lib/admin/matches';
import {
  fetchOptionCompetitions,
  fetchOptionSeasons,
  fetchOptionTeams,
} from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Matches - Control Center', robots: { index: false, follow: false } };

function Pagination({ page, totalPages, total, params }: { page: number; totalPages: number; total: number; params: URLSearchParams }) {
  const prev = new URLSearchParams(params);
  prev.set('page', String(Math.max(1, page - 1)));
  const next = new URLSearchParams(params);
  next.set('page', String(page + 1));
  return (
    <nav className="cc pagination" aria-label="Match pages">
      {page > 1 ? (
        <Link className="cc-button cc-button--ghost cc-button--sm" href={`/control-center/matches?${prev.toString()}`}>Previous</Link>
      ) : (
        <span className="cc muted">Previous</span>
      )}
      <span className="cc pagination__status">Page {page} of {totalPages} - {total} match{total === 1 ? '' : 'es'}</span>
      {page < totalPages ? (
        <Link className="cc-button cc-button--ghost cc-button--sm" href={`/control-center/matches?${next.toString()}`}>Next</Link>
      ) : (
        <span className="cc muted">Next</span>
      )}
    </nav>
  );
}

export default async function MatchesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('matches.read')) return <AccessDenied />;

  const query = parseMatchesQuery(searchParams);
  const [result, competitions, seasons, teams] = await Promise.all([
    fetchAdminMatches(query),
    fetchOptionCompetitions(),
    fetchOptionSeasons(),
    fetchOptionTeams(),
  ]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Matches unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result;
  const canCreate = session.user.permissions.includes('matches.create');

  return (
    <section className="cc dashboard" aria-labelledby="cc matches title">
      <div className="cc page head">
        <h1 id="cc matches title" className="cc section__title">Matches</h1>
        {canCreate ? (
          <Link href="/control-center/matches/new" className="cc-button cc-button--primary">New match</Link>
        ) : null}
      </div>

      <MatchesFilters query={query} competitions={competitions} seasons={seasons} teams={teams} />

      {rows.length === 0 ? (
        <EmptyState title="No matches found" description="Adjust the filters, or create the first match." />
      ) : (
        <>
          <MatchTable rows={rows} permissions={session.user.permissions} />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} params={matchesQueryToSearch(query)} />
        </>
      )}
    </section>
  );
}

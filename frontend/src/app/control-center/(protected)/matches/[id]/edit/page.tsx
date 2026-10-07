import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { MatchForm } from '@/components/admin/matches/MatchForm';
import { fetchAdminMatch } from '@/lib/admin/matches';
import { adminFailureMessage } from '@/lib/admin/resource';
import { fetchOptionCompetitions, fetchOptionSeasons, fetchOptionTeams, fetchOptionVenues } from '@/lib/admin/options';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Edit match Â· Control Center', robots: { index: false, follow: false } };

export default async function EditMatchPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('matches.update')) return <AccessDenied />;

  const result = await fetchAdminMatch(params.id);
  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok') return <AdminErrorState title="Match unavailable" message={adminFailureMessage(result)} />;

  const [teams, competitions, seasons, venues] = await Promise.all([
    fetchOptionTeams(),
    fetchOptionCompetitions(),
    fetchOptionSeasons(),
    fetchOptionVenues(),
  ]);

  const wasCreated = searchParams.created === '1';
  const m = result.match;

  return (
    <section className="cc-dashboard" aria-labelledby="cc-edit-match-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-edit-match-title" className="cc-section__title">Edit match</h1>
          <p className="cc-muted">
            {m.homeTeam?.name ?? 'Home'} vs {m.awayTeam?.name ?? 'Away'} Â· {m.competition?.name ?? 'â€”'} Â· {m.season?.name ?? 'â€”'}
          </p>
        </div>
        <Link href="/control-center/matches" className="cc-button cc-button--ghost">Back to list</Link>
      </div>
      <MatchForm mode="edit" id={params.id} initial={m} teams={teams} competitions={competitions} seasons={seasons} venues={venues} wasCreated={wasCreated} />
    </section>
  );
}

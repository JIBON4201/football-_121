import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { MatchForm } from '@/components/admin/matches/MatchForm';
import { fetchOptionCompetitions, fetchOptionSeasons, fetchOptionTeams, fetchOptionVenues } from '@/lib/admin/options';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'New match Â· Control Center', robots: { index: false, follow: false } };

export default async function NewMatchPage() {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('matches.create')) return <AccessDenied />;

  const [teams, competitions, seasons, venues] = await Promise.all([
    fetchOptionTeams(),
    fetchOptionCompetitions(),
    fetchOptionSeasons(),
    fetchOptionVenues(),
  ]);

  return (
    <section className="cc-dashboard" aria-labelledby="cc-new-match-title">
      <div className="cc-page-head">
        <h1 id="cc-new-match-title" className="cc-section__title">New match</h1>
        <Link href="/control-center/matches" className="cc-button cc-button--ghost">Back to list</Link>
      </div>
      <MatchForm mode="create" teams={teams} competitions={competitions} seasons={seasons} venues={venues} />
    </section>
  );
}

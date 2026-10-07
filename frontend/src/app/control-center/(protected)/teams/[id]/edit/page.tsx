import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { TeamForm } from '@/components/admin/teams/TeamForm';
import { fetchOptionCountries, fetchOptionVenues } from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminTeams } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Edit team Â· Control Center', robots: { index: false, follow: false } };

export default async function EditTeamPage({ params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('teams.update')) return <AccessDenied />;

  const [result, countries, venues] = await Promise.all([
    adminTeams.get(params.id),
    fetchOptionCountries(),
    fetchOptionVenues(),
  ]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok') return <AdminErrorState title="Team unavailable" message={adminFailureMessage(result)} />;

  const team = result.data;

  return (
    <section className="cc-dashboard" aria-labelledby="cc-edit-team-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-edit-team-title" className="cc-section__title">
            Edit {team.name}
          </h1>
          <p className="cc-muted">
            Slug: <code className="cc-ref">{team.slug}</code>
          </p>
        </div>
        <Link href="/control-center/teams" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>

      <TeamForm mode="edit" id={team.id} initial={team} countries={countries} venues={venues} />
    </section>
  );
}
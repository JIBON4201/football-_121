import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { TeamForm } from '@/components/admin/teams/TeamForm';
import { fetchOptionCountries, fetchOptionVenues } from '@/lib/admin/options';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'New team Â· Control Center', robots: { index: false, follow: false } };

export default async function NewTeamPage() {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('teams.create')) return <AccessDenied />;

  const [countries, venues] = await Promise.all([fetchOptionCountries(), fetchOptionVenues()]);

  return (
    <section className="cc-dashboard" aria-labelledby="cc-new-team-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-new-team-title" className="cc-section__title">
            New team
          </h1>
          <p className="cc-muted">Creates the club record. The public site picks it up immediately.</p>
        </div>
        <Link href="/control-center/teams" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>

      <TeamForm mode="create" countries={countries} venues={venues} />
    </section>
  );
}
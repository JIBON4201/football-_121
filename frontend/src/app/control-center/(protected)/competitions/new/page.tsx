import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { CompetitionForm } from '@/components/admin/competitions/CompetitionForm';
import { fetchOptionCountries } from '@/lib/admin/options';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'New competition Â· Control Center', robots: { index: false, follow: false } };

export default async function NewCompetitionPage() {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('competitions.create')) return <AccessDenied />;

  const countries = await fetchOptionCountries();

  return (
    <section className="cc-dashboard" aria-labelledby="cc-new-competition-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-new-competition-title" className="cc-section__title">
            New competition
          </h1>
          <p className="cc-muted">Creates the competition record. The public site picks it up immediately.</p>
        </div>
        <Link href="/control-center/competitions" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>

      <CompetitionForm mode="create" countries={countries} />
    </section>
  );
}
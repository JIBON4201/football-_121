import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { SeasonForm } from '@/components/admin/seasons/SeasonForm';
import { fetchOptionCompetitions } from '@/lib/admin/options';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'New season Â· Control Center', robots: { index: false, follow: false } };

export default async function NewSeasonPage() {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('seasons.manage')) return <AccessDenied />;

  const competitions = await fetchOptionCompetitions();

  return (
    <section className="cc-dashboard" aria-labelledby="cc-new-season-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-new-season-title" className="cc-section__title">
            New season
          </h1>
          <p className="cc-muted">Creates the season record. The public site picks it up immediately.</p>
        </div>
        <Link href="/control-center/seasons" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>

      <SeasonForm mode="create" competitions={competitions} />
    </section>
  );
}
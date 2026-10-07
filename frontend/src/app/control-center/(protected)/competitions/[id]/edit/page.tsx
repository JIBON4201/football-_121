import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { CompetitionForm } from '@/components/admin/competitions/CompetitionForm';
import { fetchOptionCountries } from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminCompetitions } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Edit competition Â· Control Center', robots: { index: false, follow: false } };

export default async function EditCompetitionPage({ params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('competitions.update')) return <AccessDenied />;

  const [result, countries] = await Promise.all([adminCompetitions.get(params.id), fetchOptionCountries()]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok') return <AdminErrorState title="Competition unavailable" message={adminFailureMessage(result)} />;

  const record = result.data;

  return (
    <section className="cc-dashboard" aria-labelledby="cc-edit-competition-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-edit-competition-title" className="cc-section__title">
            Edit {record.name}
          </h1>
          <p className="cc-muted">
            Slug: <code className="cc-ref">{record.slug}</code>
          </p>
        </div>
        <Link href="/control-center/competitions" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>

      <CompetitionForm mode="edit" id={record.id} initial={record} countries={countries} />
    </section>
  );
}
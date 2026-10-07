import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { SeasonForm } from '@/components/admin/seasons/SeasonForm';
import { fetchOptionCompetitions } from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminSeasons } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Edit season Â· Control Center', robots: { index: false, follow: false } };

export default async function EditSeasonPage({ params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('seasons.manage')) return <AccessDenied />;

  const [result, competitions] = await Promise.all([adminSeasons.get(params.id), fetchOptionCompetitions()]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok') return <AdminErrorState title="Season unavailable" message={adminFailureMessage(result)} />;

  const record = result.data;

  return (
    <section className="cc-dashboard" aria-labelledby="cc-edit-season-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-edit-season-title" className="cc-section__title">
            Edit {record.name}
          </h1>
          <p className="cc-muted">
            {record.start_date ?? 'â€”'} to {record.end_date ?? 'â€”'}
          </p>
        </div>
        <Link href="/control-center/seasons" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>

      <SeasonForm mode="edit" id={record.id} initial={record} competitions={competitions} />
    </section>
  );
}
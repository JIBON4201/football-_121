import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { VenueForm } from '@/components/admin/venues/VenueForm';
import { fetchOptionCountries } from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminVenues } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Edit venue Â· Control Center', robots: { index: false, follow: false } };

export default async function EditVenuePage({ params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('venues.manage')) return <AccessDenied />;

  const [result, countries] = await Promise.all([adminVenues.get(params.id), fetchOptionCountries()]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok') return <AdminErrorState title="Venue unavailable" message={adminFailureMessage(result)} />;

  const record = result.data;

  return (
    <section className="cc-dashboard" aria-labelledby="cc-edit-venue-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-edit-venue-title" className="cc-section__title">
            Edit {record.name}
          </h1>
          <p className="cc-muted">
            Slug: <code className="cc-ref">{record.slug}</code>
          </p>
        </div>
        <Link href="/control-center/venues" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>

      <VenueForm mode="edit" id={record.id} initial={record} countries={countries} />
    </section>
  );
}
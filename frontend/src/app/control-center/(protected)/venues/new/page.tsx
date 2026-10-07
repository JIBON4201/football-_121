import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { VenueForm } from '@/components/admin/venues/VenueForm';
import { fetchOptionCountries } from '@/lib/admin/options';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'New venue Â· Control Center', robots: { index: false, follow: false } };

export default async function NewVenuePage() {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('venues.manage')) return <AccessDenied />;

  const countries = await fetchOptionCountries();

  return (
    <section className="cc-dashboard" aria-labelledby="cc-new-venue-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-new-venue-title" className="cc-section__title">
            New venue
          </h1>
          <p className="cc-muted">Creates the venue record. The public site picks it up immediately.</p>
        </div>
        <Link href="/control-center/venues" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>

      <VenueForm mode="create" countries={countries} />
    </section>
  );
}
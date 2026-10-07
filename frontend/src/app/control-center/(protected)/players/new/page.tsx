import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { PlayerForm } from '@/components/admin/players/PlayerForm';
import { fetchOptionCountries } from '@/lib/admin/options';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'New player Â· Control Center', robots: { index: false, follow: false } };

export default async function NewPlayerPage() {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('players.create')) return <AccessDenied />;

  const countries = await fetchOptionCountries();

  return (
    <section className="cc-dashboard" aria-labelledby="cc-new-player-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-new-player-title" className="cc-section__title">
            New player
          </h1>
          <p className="cc-muted">Creates the player record. The public site picks it up immediately.</p>
        </div>
        <Link href="/control-center/players" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>

      <PlayerForm mode="create" countries={countries} />
    </section>
  );
}
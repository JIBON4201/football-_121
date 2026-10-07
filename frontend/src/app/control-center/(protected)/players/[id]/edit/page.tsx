import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { PlayerForm } from '@/components/admin/players/PlayerForm';
import { fetchOptionCountries } from '@/lib/admin/options';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminPlayers } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Edit player Â· Control Center', robots: { index: false, follow: false } };

export default async function EditPlayerPage({ params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('players.update')) return <AccessDenied />;

  const [result, countries] = await Promise.all([adminPlayers.get(params.id), fetchOptionCountries()]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok') return <AdminErrorState title="Player unavailable" message={adminFailureMessage(result)} />;

  const player = result.data;

  return (
    <section className="cc-dashboard" aria-labelledby="cc-edit-player-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-edit-player-title" className="cc-section__title">
            Edit {player.display_name}
          </h1>
          <p className="cc-muted">
            Slug: <code className="cc-ref">{player.slug}</code>
          </p>
        </div>
        <Link href="/control-center/players" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>

      <PlayerForm mode="edit" id={player.id} initial={player} countries={countries} />
    </section>
  );
}
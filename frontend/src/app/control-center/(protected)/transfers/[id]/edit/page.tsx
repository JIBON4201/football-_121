import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { TransferForm } from '@/components/admin/transfers/TransferForm';
import {
  fetchAdminTransfer,
  fetchPublicPlayers,
  fetchPublicTeams,
  fetchPublicWindows,
  fetchAdminSeasons,
} from '@/lib/admin/transfers';
import { adminFailureMessage } from '@/lib/admin/resource';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Edit transfer Â· Control Center', robots: { index: false, follow: false } };

export default async function EditTransferPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('transfers.update')) return <AccessDenied />;

  const result = await fetchAdminTransfer(params.id);
  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok') return <AdminErrorState title="Transfer unavailable" message={adminFailureMessage(result)} />;

  const [players, teams, windows, seasons] = await Promise.all([
    fetchPublicPlayers(),
    fetchPublicTeams(),
    fetchPublicWindows(),
    fetchAdminSeasons(),
  ]);

  const wasCreated = searchParams.created === '1';
  const t = result.transfer;

  return (
    <section className="cc-dashboard" aria-labelledby="cc-edit-transfer-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-edit-transfer-title" className="cc-section__title">Edit transfer</h1>
          <p className="cc-muted">
            Player: <strong>{t.player?.display_name ?? t.player?.name ?? t.player_id}</strong> Â· From: {t.fromTeam?.name ?? 'â€”'} Â· To: {t.toTeam?.name ?? 'â€”'} Â· Season: {t.season?.name ?? t.season_id}
          </p>
        </div>
        <Link href="/control-center/transfers" className="cc-button cc-button--ghost">Back to list</Link>
      </div>
      <TransferForm mode="edit" id={params.id} initial={t} players={players} teams={teams} windows={windows} seasons={seasons} wasCreated={wasCreated} />
    </section>
  );
}

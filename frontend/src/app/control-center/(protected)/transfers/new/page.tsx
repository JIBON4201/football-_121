import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { TransferForm } from '@/components/admin/transfers/TransferForm';
import { fetchPublicPlayers, fetchPublicTeams, fetchPublicWindows, fetchAdminSeasons } from '@/lib/admin/transfers';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'New transfer Â· Control Center', robots: { index: false, follow: false } };

export default async function NewTransferPage() {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('transfers.create')) return <AccessDenied />;

  const [players, teams, windows, seasons] = await Promise.all([
    fetchPublicPlayers(),
    fetchPublicTeams(),
    fetchPublicWindows(),
    fetchAdminSeasons(),
  ]);

  return (
    <section className="cc-dashboard" aria-labelledby="cc-new-transfer-title">
      <div className="cc-page-head">
        <h1 id="cc-new-transfer-title" className="cc-section__title">New transfer</h1>
        <Link href="/control-center/transfers" className="cc-button cc-button--ghost">Back to list</Link>
      </div>
      <TransferForm mode="create" players={players} teams={teams} windows={windows} seasons={seasons} />
    </section>
  );
}

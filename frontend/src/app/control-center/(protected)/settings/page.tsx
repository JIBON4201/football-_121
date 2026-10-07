import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ResourcePage } from '@/components/admin/ResourcePage';
import { SettingsEditor } from '@/components/admin/settings/SettingsEditor';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminSettings } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Settings - Control Center', robots: { index: false, follow: false } };

/**
 * Site settings editor.
 *
 * `system_settings` is a flat key/value table maintained by administrators.
 * Reads are live; each row saves independently through a server action that
 * re-checks `settings.manage`.
 */
export default async function SettingsPage() {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('settings.read')) return <AccessDenied />;

  const result = await adminSettings.list();

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Settings unavailable" message={adminFailureMessage(result)} />;

  const canManage = session.user.permissions.includes('settings.manage');

  return (
    <ResourcePage<never>
      title="Settings"
      description="Site-wide configuration maintained by administrators."
      titleId="cc-settings-title"
      rows={[]}
      columns={[]}
      rowKey={() => ''}
      caption="Settings"
      emptyTitle="No settings defined"
      emptyDescription="Settings appear here once they exist in system_settings."
      notice={<SettingsEditor settings={result.data} canManage={canManage} />}
    />
  );
}
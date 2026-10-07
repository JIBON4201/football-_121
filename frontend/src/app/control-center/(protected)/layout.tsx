import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/admin-session';
import { AdminShell } from '@/components/admin/AdminShell';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';

/**
 * Server-side gate for every Admin route except `/login`. The middleware only
 * sends anonymous visitors to the login page (UX); this layout is what
 * actually asks the backend who the caller is on each request:
 *   • no/invalid session  → redirect to /control-center/login
 *   • valid, no grant     → 403 Access denied
 *   • API unreachable/5xx → retryable error state (NOT a redirect to login:
 *                           a backend outage must not look like a logout)
 *   • valid Admin session → shell with the sidebar filtered by permissions
 */
export default async function ProtectedAdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'forbidden') return <AccessDenied />;
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  return (
    <AdminShell email={session.user.email} roles={session.user.roles} permissions={session.user.permissions}>
      {children}
    </AdminShell>
  );
}
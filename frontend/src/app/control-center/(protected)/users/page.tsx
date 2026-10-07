import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ResourcePagination, ResourcePage } from '@/components/admin/ResourcePage';
import { ResourceToolbar } from '@/components/admin/ResourceToolbar';
import { dateColumn } from '@/components/admin/columns';
import { StatusBadge } from '@/components/admin/ui/StatusBadge';
import { readListQuery, toSearchParams } from '@/lib/admin/list-query';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminUsers } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';
import type { AdminColumn } from '@/components/admin/ui/AdminDataTable';
import type { AdminUserRow } from '@/types/api';

export const metadata: Metadata = { title: 'Users - Control Center', robots: { index: false, follow: false } };

const BASE = '/control-center/users';

/**
 * Administrator accounts and their roles.
 *
 * Backed by the `admin_users` view, which only exists once migration 025 is
 * applied. On a database without it the backend answers 503 and this renders the
 * error state - deliberately not an empty table, which would read as "no users
 * exist" and hide a real infrastructure problem.
 */
export default async function UsersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('users.read')) return <AccessDenied />;

  const query = readListQuery(searchParams);
  const result = await adminUsers.list({ page: query.page, limit: query.limit, q: query.q });

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Users unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result.data;

  const columns: AdminColumn<AdminUserRow>[] = [
    {
      key: 'email',
      header: 'User',
      primary: true,
      render: (row) => (
        <span className="cc-cell-title">
          <span className="cc-ellipsis" title={row.email}>
            {row.email}
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'roles',
      header: 'Roles',
      render: (row) =>
        row.roles.length === 0 ? (
          <span className="cc-muted">No roles</span>
        ) : (
          <span>
            {row.roles.map((role) => (
              <span className="cc-badge" key={role}>
                {role}
              </span>
            ))}
          </span>
        ),
    },
    dateColumn('last_sign_in', 'Last sign-in', (row) => row.last_sign_in_at),
    dateColumn('created', 'Created', (row) => row.created_at),
  ];

  return (
    <ResourcePage<AdminUserRow>
      title="Users"
      description="Review user accounts, status and role assignments."
      titleId="cc-users-title"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      caption="Users"
      emptyTitle="No users found"
      emptyDescription="Nobody matches the current search."
      toolbar={<ResourceToolbar basePath={BASE} searchPlaceholder="Search users by email" />}
      pagination={
        <ResourcePagination
          basePath={BASE}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          noun="users"
          params={toSearchParams(searchParams)}
        />
      }
    />
  );
}
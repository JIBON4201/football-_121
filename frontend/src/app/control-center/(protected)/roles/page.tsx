import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ResourcePagination, ResourcePage } from '@/components/admin/ResourcePage';
import { dateColumn } from '@/components/admin/columns';
import { readListQuery, toSearchParams } from '@/lib/admin/list-query';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminRoles } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';
import type { AdminColumn } from '@/components/admin/ui/AdminDataTable';
import type { AdminRoleRow } from '@/types/api';

export const metadata: Metadata = { title: 'Roles - Control Center', robots: { index: false, follow: false } };

const BASE = '/control-center/roles';

/**
 * Roles and their membership.
 *
 * Read-only in this panel: the backend exposes `PUT /admin/roles/:id/permissions`
 * for grant changes, but wiring a permission matrix editor is a separate feature.
 * The list is real, and the page says plainly that grants are managed elsewhere
 * rather than implying the panel can edit them.
 */
export default async function RolesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('roles.read')) return <AccessDenied />;

  const query = readListQuery(searchParams);
  const result = await adminRoles.list({ page: query.page, limit: query.limit, q: query.q });

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Roles unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result.data;

  const columns: AdminColumn<AdminRoleRow>[] = [
    {
      key: 'name',
      header: 'Role',
      primary: true,
      render: (row) => (
        <span className="cc-cell-title">
          <span className="cc-ellipsis" title={row.name}>
            {row.name}
          </span>
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (row.description ? <span className="cc-ellipsis">{row.description}</span> : <span className="cc-muted">-</span>),
    },
    {
      key: 'members',
      header: 'Members',
      numeric: true,
      render: (row) => <span>{row.memberCount}</span>,
    },
    dateColumn('created', 'Created', (row) => row.created_at),
  ];

  return (
    <ResourcePage<AdminRoleRow>
      title="Roles"
      description="Roles, permissions and access policies."
      titleId="cc-roles-title"
      rows={rows}
      columns={columns}
      rowKey={(row) => String(row.id)}
      caption="Roles"
      emptyTitle="No roles found"
      emptyDescription="Nobody matches the current search."
      notice={
        <p className="cc-field__hint">
          Permission grants are managed through the API (<code className="cc-ref">PUT /api/v1/admin/roles/:id/permissions</code>);
          this panel lists roles read-only.
        </p>
      }
      pagination={
        <ResourcePagination
          basePath={BASE}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          noun="roles"
          params={toSearchParams(searchParams)}
        />
      }
    />
  );
}
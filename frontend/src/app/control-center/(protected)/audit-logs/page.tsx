import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ResourcePagination, ResourcePage } from '@/components/admin/ResourcePage';
import { ResourceToolbar } from '@/components/admin/ResourceToolbar';
import { dateColumn } from '@/components/admin/columns';
import { readListQuery, readUuid, toSearchParams } from '@/lib/admin/list-query';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminAuditLogs, adminUsers } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';
import type { AdminColumn } from '@/components/admin/ui/AdminDataTable';
import type { AdminAuditLogRow } from '@/types/api';

export const metadata: Metadata = { title: 'Audit log - Control Center', robots: { index: false, follow: false } };

const BASE = '/control-center/audit-logs';

/**
 * Immutable record of administrative writes.
 *
 * Read-only by design: the backend only exposes `GET` here and `writeAdminAudit`
 * never throws, so an audit write can never block or fail an admin operation.
 */
export default async function AuditLogsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('audit_logs.read')) return <AccessDenied />;

  const query = readListQuery(searchParams);
  const userId = readUuid(searchParams.user_id);
  // The audit log is append-only and the backend exposes only
  // `action`/`entity_type`/`user_id` filters - there is no free-text `q`, so the
  // toolbar offers no search box rather than one the API would silently ignore.
  const listQuery: Record<string, string | number | undefined> = { page: query.page, limit: query.limit };
  if (userId) listQuery.user_id = userId;

  const [result, usersResult] = await Promise.all([adminAuditLogs.list(listQuery), adminUsers.list({ limit: 100 })]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Audit log unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result.data;
  const actorOptions =
    usersResult.status === 'ok'
      ? usersResult.data.rows.map((u) => ({ value: u.id, label: u.email }))
      : [];

  const columns: AdminColumn<AdminAuditLogRow>[] = [
    {
      key: 'action',
      header: 'Action',
      primary: true,
      render: (row) => (
        <span className="cc-cell-title">
          <code className="cc-ref">{row.action}</code>
        </span>
      ),
    },
    { key: 'resource', header: 'Resource', render: (row) => <span>{row.resource}</span> },
    {
      key: 'resource_id',
      header: 'Record',
      render: (row) => (row.resource_id ? <code className="cc-ref">{row.resource_id.slice(0, 8)}</code> : <span className="cc-muted">-</span>),
    },
    {
      key: 'actor',
      header: 'By',
      render: (row) => (row.user_email ? <span className="cc-ellipsis">{row.user_email}</span> : <span className="cc-muted">system</span>),
    },
    dateColumn('when', 'When', (row) => row.created_at),
  ];

  return (
    <ResourcePage<AdminAuditLogRow>
      title="Audit log"
      description="Immutable record of administrative changes."
      titleId="cc-audit-title"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      caption="Audit log"
      emptyTitle="No audit entries"
      emptyDescription={userId ? 'No entries recorded by that actor.' : 'Administrative writes appear here as they happen.'}
      toolbar={
        <ResourceToolbar
          basePath={BASE}
          filters={[{ param: 'user_id', label: 'Actor', options: actorOptions }]}
        />
      }
      pagination={
        <ResourcePagination
          basePath={BASE}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          noun="entries"
          params={toSearchParams(searchParams)}
        />
      }
    />
  );
}
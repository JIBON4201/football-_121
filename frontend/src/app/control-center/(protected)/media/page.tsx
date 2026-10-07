import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ResourcePagination, ResourcePage } from '@/components/admin/ResourcePage';
import { dateColumn } from '@/components/admin/columns';
import { readListQuery, toSearchParams } from '@/lib/admin/list-query';
import { adminFailureMessage } from '@/lib/admin/resource';
import { adminMedia } from '@/lib/admin/resources';
import { getAdminSession } from '@/lib/admin-session';
import type { AdminColumn } from '@/components/admin/ui/AdminDataTable';
import type { AdminMediaRow } from '@/types/api';

export const metadata: Metadata = { title: 'Media - Control Center', robots: { index: false, follow: false } };

const BASE = '/control-center/media';

/**
 * Media library listing.
 *
 * Read-only here. Uploads go through `POST /api/v1/media/upload`, which takes a
 * base64 body and runs the magic-byte/extension/dimension validation in
 * `media.service.ts`; wiring that multipart form is a separate feature rather
 * than something to fake with a text field.
 */
export default async function MediaPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('media.read')) return <AccessDenied />;

  const query = readListQuery(searchParams);
  const result = await adminMedia.list({ page: query.page, limit: query.limit, q: query.q });

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status !== 'ok') return <AdminErrorState title="Media unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result.data;

  const columns: AdminColumn<AdminMediaRow>[] = [
    {
      key: 'filename',
      header: 'File',
      primary: true,
      render: (row) => (
        <span className="cc-cell-title">
          <span className="cc-ellipsis" title={row.filename}>
            {row.filename}
          </span>
        </span>
      ),
    },
    { key: 'mime', header: 'Type', render: (row) => <span className="cc-muted">{row.mime_type}</span> },
    {
      key: 'size',
      header: 'Size',
      numeric: true,
      render: (row) => <span>{formatBytes(row.file_size)}</span>,
    },
    {
      key: 'dimensions',
      header: 'Dimensions',
      numeric: true,
      render: (row) =>
        row.width && row.height ? (
          <span>
            {row.width} x {row.height}
          </span>
        ) : (
          <span className="cc-muted">-</span>
        ),
    },
    { key: 'alt', header: 'Alt text', render: (row) => (row.alt_text ? <span className="cc-ellipsis">{row.alt_text}</span> : <span className="cc-muted">Missing</span>) },
    dateColumn('created', 'Uploaded', (row) => row.created_at),
  ];

  return (
    <ResourcePage<AdminMediaRow>
      title="Media"
      description="Upload and organise images and video assets."
      titleId="cc-media-title"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      caption="Media"
      emptyTitle="No media yet"
      emptyDescription="Upload through POST /api/v1/media/upload; the library lists what has been stored."
      pagination={
        <ResourcePagination
          basePath={BASE}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          noun="assets"
          params={toSearchParams(searchParams)}
        />
      }
    />
  );
}

/** Binary sizes as KB/MB, matching how the rest of the panel talks about size. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
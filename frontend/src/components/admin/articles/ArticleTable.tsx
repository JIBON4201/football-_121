import { AdminDataTable, type AdminColumn } from '@/components/admin/ui/AdminDataTable';
import { AdminLinkButton } from '@/components/admin/ui/AdminButton';
import { StatusBadge } from '@/components/admin/ui/StatusBadge';
import { ConfirmAction } from '@/components/admin/ui/ConfirmDialog';
import { RefCell } from '@/components/admin/RefCell';
import { deleteArticleAction } from '@/app/control-center/articles/actions';
import { formatDate } from '@/lib/dates';
import type { AdminArticleListRow } from '@/types/api';

interface ArticleTableProps {
  rows: AdminArticleListRow[];
  /** Current admin permissions drive which actions render — backend stays authoritative. */
  permissions: string[];
}

/** Server-rendered management table; only the delete control is client-side. */
export function ArticleTable({ rows, permissions }: ArticleTableProps) {
  const canUpdate = permissions.includes('articles.update');
  const canDelete = permissions.includes('articles.delete');

  const columns: AdminColumn<AdminArticleListRow>[] = [
    {
      key: 'title',
      header: 'Title',
      primary: true,
      render: (a) => (
        <span className="cc-cell-title">
          <span className="cc-ellipsis" title={a.title}>
            {a.title}
          </span>
          {a.is_breaking ? <span className="cc-badge cc-badge--breaking">Breaking</span> : null}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
    { key: 'type', header: 'Type', render: (a) => <span className="cc-muted">{a.article_type.replace(/_/g, ' ')}</span> },
    { key: 'author', header: 'Author', render: (a) => <RefCell id={a.author_id} /> },
    {
      key: 'published',
      header: 'Published',
      numeric: true,
      render: (a) => (a.published_at ? <span className="cc-dt">{formatDate(a.published_at)}</span> : <span className="cc-muted">—</span>),
    },
    {
      key: 'updated',
      header: 'Updated',
      numeric: true,
      render: (a) => <span className="cc-dt">{formatDate(a.updated_at)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (a) => (
        <span className="cc-row-actions">
          {canUpdate ? (
            <AdminLinkButton href={`/control-center/articles/${a.id}/edit`} variant="ghost" size="sm">
              Edit
            </AdminLinkButton>
          ) : null}
          {canDelete ? (
            <ConfirmAction
              label={`Delete "${a.title}"`}
              message={`Delete “${a.title}”? This cannot be undone.`}
              action={deleteArticleAction.bind(null, a.id)}
            />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <AdminDataTable<AdminArticleListRow>
      columns={columns}
      rows={rows}
      caption="Articles"
      rowKey={(row) => row.id}
      count={rows.length}
      emptyTitle="No articles found"
      emptyDescription="Adjust the search or filters, or create the first article."
    />
  );
}

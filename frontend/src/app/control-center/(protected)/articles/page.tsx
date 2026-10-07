import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ArticleFilters } from '@/components/admin/articles/ArticleFilters';
import { ArticleTable } from '@/components/admin/articles/ArticleTable';
import { EmptyState } from '@/components/admin/ui/Feedback';
import { articlesQueryToSearch, fetchAdminArticles, fetchPublicCategories, parseArticlesQuery } from '@/lib/admin/articles';
import { adminFailureMessage } from '@/lib/admin/resource';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'News - Control Center', robots: { index: false, follow: false } };

function Pagination({ page, totalPages, total, params }: { page: number; totalPages: number; total: number; params: URLSearchParams }) {
  const prev = new URLSearchParams(params);
  if (page > 1) prev.set('page', String(page - 1));
  const next = new URLSearchParams(params);
  next.set('page', String(page + 1));
  return (
    <nav className="cc pagination" aria-label="Article pages">
      {page > 1 ? (
        <Link className="cc-button cc-button--ghost cc-button--sm" href={`/control-center/articles?${prev.toString()}`}>
          Previous
        </Link>
      ) : (
        <span className="cc muted">Previous</span>
      )}
      <span className="cc pagination__status">
        Page {page} of {totalPages} - {total} article{total === 1 ? '' : 's'}
      </span>
      {page < totalPages ? (
        <Link className="cc-button cc-button--ghost cc-button--sm" href={`/control-center/articles?${next.toString()}`}>
          Next
        </Link>
      ) : (
        <span className="cc muted">Next</span>
      )}
    </nav>
  );
}

/**
 * Admin news/articles management: filters, search, sort and pagination are all
 * server driven from the URL. The backend query layer does the filtering -  - * nothing here mocks or duplicates it.
 */
export default async function ArticlesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('articles.read')) return <AccessDenied />;

  const query = parseArticlesQuery(searchParams);
  const [result, categories] = await Promise.all([fetchAdminArticles(query), fetchPublicCategories()]);

  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  // Everything else (not found, conflict, invalid, rate limited, transport) is
  // shown as one banner rather than being mistaken for "no articles".
  if (result.status !== 'ok') return <AdminErrorState title="Articles unavailable" message={adminFailureMessage(result)} />;

  const { rows, pagination } = result;
  const canCreate = session.user.permissions.includes('articles.create');

  return (
    <section className="cc dashboard" aria-labelledby="cc articles title">
      <div className="cc page head">
        <h1 id="cc articles title" className="cc section__title">
          News
        </h1>
        {canCreate ? (
          <Link href="/control-center/articles/new" className="cc-button cc-button--primary">
            New article
          </Link>
        ) : null}
      </div>

      <ArticleFilters query={query} categories={categories} />

      {rows.length === 0 ? (
        <EmptyState title="No articles found" description="Adjust the search or filters, or create the first article." />
      ) : (
        <>
          <ArticleTable rows={rows} permissions={session.user.permissions} />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} params={articlesQueryToSearch(query)} />
        </>
      )}
    </section>
  );
}

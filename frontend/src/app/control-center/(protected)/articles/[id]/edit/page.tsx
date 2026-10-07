import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ArticleForm } from '@/components/admin/articles/ArticleForm';
import { ArticleLifecycle } from '@/components/admin/articles/ArticleLifecycle';
import { fetchAdminArticle } from '@/lib/admin/articles';
import { adminFailureMessage } from '@/lib/admin/resource';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'Edit article Â· Control Center', robots: { index: false, follow: false } };

/**
 * Edit an article. Only fields accepted by the backend PATCH are editable;
 * status and relationships are shown read-only for context.
 */
export default async function EditArticlePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('articles.update')) return <AccessDenied />;

  const result = await fetchAdminArticle(params.id);
  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok') return <AdminErrorState title="Article unavailable" message={adminFailureMessage(result)} />;

  const wasCreated = searchParams.created === '1';

  return (
    <section className="cc-dashboard" aria-labelledby="cc-edit-article-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-edit-article-title" className="cc-section__title">
            Edit article
          </h1>
          <p className="cc-muted">
            Status: <strong>{result.article.status}</strong> Â· Type: {result.article.article_type.replace('_', ' ')} Â· Author: <code>{result.article.author_id ?? 'â€”'}</code>
          </p>
        </div>
        <Link href="/control-center/articles" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>
      <ArticleLifecycle
        id={params.id}
        status={result.article.status}
        canPublish={session.user.permissions.includes('articles.publish')}
        canUpdate={session.user.permissions.includes('articles.update')}
      />
      <ArticleForm mode="edit" id={params.id} initial={result.article} categories={[]} wasCreated={wasCreated} />
    </section>
  );
}
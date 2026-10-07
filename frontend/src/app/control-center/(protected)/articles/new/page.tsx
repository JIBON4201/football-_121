import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { ArticleForm } from '@/components/admin/articles/ArticleForm';
import { fetchPublicCategories } from '@/lib/admin/articles';
import { getAdminSession } from '@/lib/admin-session';

export const metadata: Metadata = { title: 'New article Â· Control Center', robots: { index: false, follow: false } };

export default async function NewArticlePage() {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('articles.create')) return <AccessDenied />;

  const categories = await fetchPublicCategories();
  return (
    <section className="cc-dashboard" aria-labelledby="cc-new-article-title">
      <div className="cc-page-head">
        <h1 id="cc-new-article-title" className="cc-section__title">
          New article
        </h1>
        <Link href="/control-center/articles" className="cc-button cc-button--ghost">
          Back to list
        </Link>
      </div>
      <ArticleForm mode="create" categories={categories} />
    </section>
  );
}
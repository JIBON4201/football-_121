'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { ARTICLES_DEFAULT_LIMIT, articlesQueryToSearch, type AdminArticlesQuery, type PublicCategoryRow } from '@/lib/admin/article-query';

const STATUS_OPTIONS = ['draft', 'review', 'scheduled', 'published', 'archived'] as const;
const TYPE_OPTIONS = ['news', 'breaking_news', 'transfer', 'match_report', 'analysis', 'opinion'] as const;

interface ArticleFiltersProps {
  query: AdminArticlesQuery;
  categories: PublicCategoryRow[];
}

/**
 * Filter/sort form: submits by navigating to the list route with the new query
 * params (the list is server-rendered). A transition state marks pending swaps.
 */
export function ArticleFilters({ query, categories }: ArticleFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const next: AdminArticlesQuery = {
      page: 1,
      limit: ARTICLES_DEFAULT_LIMIT,
      q: String(data.get('q') ?? '').trim() || undefined,
      status: String(data.get('status') ?? '') || undefined,
      articleType: String(data.get('articleType') ?? '') || undefined,
      categoryId: String(data.get('categoryId') ?? '') || undefined,
      featured: data.get('featured') === 'true' ? true : data.get('featured') === 'false' ? false : undefined,
      sort: String(data.get('sort') ?? '') || undefined,
      order: String(data.get('order') ?? '') || undefined,
    };
    const params = articlesQueryToSearch(next);
    startTransition(() => router.push(`/control-center/articles?${params.toString()}`));
  };

  return (
    <form className="cc-filters" onSubmit={handleSubmit} aria-label="Article filters">
      <div className="cc-filters__row">
        <div className="cc-field cc-filters__search">
          <label htmlFor="articles-q">Search</label>
          <input id="articles-q" name="q" type="search" defaultValue={query.q ?? ''} placeholder="Title or slug" maxLength={200} />
        </div>

        <div className="cc-field">
          <label htmlFor="articles-status">Status</label>
          <select id="articles-status" name="status" defaultValue={query.status ?? ''}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="cc-field">
          <label htmlFor="articles-type">Type</label>
          <select id="articles-type" name="articleType" defaultValue={query.articleType ?? ''}>
            <option value="">All</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="cc-field">
          <label htmlFor="articles-category">Category</label>
          <select id="articles-category" name="categoryId" defaultValue={query.categoryId ?? ''}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="cc-field">
          <label htmlFor="articles-featured">Featured</label>
          <select id="articles-featured" name="featured" defaultValue={query.featured === true ? 'true' : query.featured === false ? 'false' : ''}>
            <option value="">All</option>
            <option value="true">Featured only</option>
            <option value="false">Not featured</option>
          </select>
        </div>

        <div className="cc-field">
          <label htmlFor="articles-sort">Sort by</label>
          <select id="articles-sort" name="sort" defaultValue={query.sort ?? 'created_at'}>
            <option value="created_at">Created</option>
            <option value="published_at">Published</option>
            <option value="updated_at">Updated</option>
          </select>
        </div>

        <div className="cc-field">
          <label htmlFor="articles-order">Order</label>
          <select id="articles-order" name="order" defaultValue={query.order ?? 'desc'}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>
      </div>

      <div className="cc-filters__actions">
        <button type="submit" className="cc-button cc-button--primary" disabled={pending} aria-busy={pending}>
          {pending ? 'Applying…' : 'Apply filters'}
        </button>
        <Link href="/control-center/articles" className="cc-button cc-button--ghost">
          Reset
        </Link>
        <RefreshButton />
      </div>
    </form>
  );
}

/** Re-runs the current server render (re-fetches the list). */
function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" className="cc-button cc-button--ghost" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? 'Refreshing…' : 'Refresh'}
    </button>
  );
}

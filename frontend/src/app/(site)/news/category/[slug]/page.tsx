import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { siteConfig } from '@/config/site';
import { routeUrl } from '@/config/routes';
import { getPageParams } from '@/lib/data-fetch';
import { fetchCategory, fetchNewsList, NEWS_REVALIDATE_SECONDS } from '@/lib/news';
import { isValidSlug, sanitizeText } from '@/lib/validation';
import { ArticleList } from '@/components/news/ArticleList';
import { Alert, EmptyState } from '@/components/ui/Feedback';

interface CategoryPageProps {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export const revalidate = NEWS_REVALIDATE_SECONDS;

/** Unknown or inactive categories 404 rather than rendering an empty shell. */
export async function generateMetadata({ params, searchParams }: CategoryPageProps): Promise<Metadata> {
  if (!isValidSlug(params.slug)) {
    return { title: `Category not found | ${siteConfig.name}`, robots: 'noindex,nofollow' };
  }
  const category = await fetchCategory(params.slug);
  if (!category) {
    return { title: `Category not found | ${siteConfig.name}`, robots: 'noindex,nofollow' };
  }
  const { page } = getPageParams((searchParams ?? {}) as Record<string, string | string[] | undefined>);
  const basePath = routeUrl('newsCategory', { slug: category.slug });
  const canonical = page > 1 ? `${siteConfig.siteUrl}${basePath}?page=${page}` : `${siteConfig.siteUrl}${basePath}`;
  const titleBase = `${sanitizeText(category.name)} news | ${siteConfig.name}`;
  const title = page > 1 ? `${sanitizeText(category.name)} news – Page ${page} | ${siteConfig.name}` : titleBase;
  const description = category.description
    ? sanitizeText(category.description, 160)
    : `Latest ${sanitizeText(category.name)} stories.`;
  // Empty categories render an EmptyState (thin content) — follow links but
  // don't index the shell. Only an explicit successful empty confirms thinness;
  // transport errors default to indexable so an outage never deindexes.
  const probe = await fetchNewsList({ page: 1, limit: 1, category: category.slug, revalidate: NEWS_REVALIDATE_SECONDS }).catch(() => null);
  const robots = probe && probe.status === 'empty' ? 'noindex,follow' : 'index,follow';
  return {
    title,
    description: page > 1 ? `${description} (Page ${page})` : description,
    alternates: { canonical },
    robots,
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: siteConfig.name,
      type: 'website',
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  if (!isValidSlug(params.slug)) notFound();
  const category = await fetchCategory(params.slug);
  if (!category) notFound();

  const { page } = getPageParams(searchParams);
  const result = await fetchNewsList({
    page,
    category: category.slug,
    revalidate: NEWS_REVALIDATE_SECONDS,
  });
  const name = sanitizeText(category.name);

  return (
    <section aria-labelledby="category-heading" className="container">
      <h1 id="category-heading">{name}</h1>
      {category.description ? <p>{sanitizeText(category.description, 280)}</p> : null}
      {result.status === 'error' ? (
        <Alert tone="error">Stories in this category are temporarily unavailable. Please try again shortly.</Alert>
      ) : result.status === 'empty' ? (
        <EmptyState
          title="No stories yet"
          description={`There are no published ${name.toLowerCase()} stories yet.`}
          action={<a href={routeUrl('news')}>Browse all news</a>}
        />
      ) : (
        <ArticleList
          articles={result.rows}
          pagination={result.pagination}
          baseHref={routeUrl('newsCategory', { slug: category.slug })}
          listLabel={`${name} stories`}
        />
      )}
    </section>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { siteConfig } from '@/config/site';
import { routeUrl } from '@/config/routes';
import { getPageParams } from '@/lib/data-fetch';
import { fetchNewsList, fetchTag, NEWS_REVALIDATE_SECONDS } from '@/lib/news';
import { isValidSlug, sanitizeText } from '@/lib/validation';
import { ArticleList } from '@/components/news/ArticleList';
import { Alert, EmptyState } from '@/components/ui/Feedback';

interface TagPageProps {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export const revalidate = NEWS_REVALIDATE_SECONDS;

/** Unknown tags 404 rather than rendering an empty shell. */
export async function generateMetadata({ params, searchParams }: TagPageProps): Promise<Metadata> {
  if (!isValidSlug(params.slug)) {
    return { title: `Tag not found | ${siteConfig.name}`, robots: 'noindex,nofollow' };
  }
  const tag = await fetchTag(params.slug);
  if (!tag) {
    return { title: `Tag not found | ${siteConfig.name}`, robots: 'noindex,nofollow' };
  }
  const { page } = getPageParams((searchParams ?? {}) as Record<string, string | string[] | undefined>);
  const basePath = routeUrl('newsTag', { slug: tag.slug });
  const canonical = page > 1 ? `${siteConfig.siteUrl}${basePath}?page=${page}` : `${siteConfig.siteUrl}${basePath}`;
  const name = sanitizeText(tag.name);
  const title = page > 1 ? `${name} – Page ${page} | ${siteConfig.name}` : `${name} | ${siteConfig.name}`;
  const description = `Football news stories tagged ${name}.`;
  const probe = await fetchNewsList({ page: 1, limit: 1, tag: tag.slug, revalidate: NEWS_REVALIDATE_SECONDS }).catch(() => null);
  const robots = probe && probe.status === 'empty' ? 'noindex,follow' : 'index,follow';
  return {
    title,
    description: page > 1 ? `${description} (Page ${page})` : description,
    alternates: { canonical },
    robots,
    openGraph: { title, description, url: canonical, siteName: siteConfig.name, type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function TagPage({ params, searchParams }: TagPageProps) {
  if (!isValidSlug(params.slug)) notFound();
  const tag = await fetchTag(params.slug);
  if (!tag) notFound();

  const { page } = getPageParams(searchParams);
  const result = await fetchNewsList({ page, tag: tag.slug, revalidate: NEWS_REVALIDATE_SECONDS });
  const name = sanitizeText(tag.name);

  return (
    <section aria-labelledby="tag-heading" className="container">
      <h1 id="tag-heading">Tagged {name}</h1>
      {result.status === 'error' ? (
        <Alert tone="error">Stories for this tag are temporarily unavailable. Please try again shortly.</Alert>
      ) : result.status === 'empty' ? (
        <EmptyState
          title="No tagged stories"
          description={`There are no published stories tagged ${name.toLowerCase()} yet.`}
          action={<a href={routeUrl('news')}>Browse all news</a>}
        />
      ) : (
        <ArticleList
          articles={result.rows}
          pagination={result.pagination}
          baseHref={routeUrl('newsTag', { slug: tag.slug })}
          listLabel={`Stories tagged ${name}`}
        />
      )}
    </section>
  );
}

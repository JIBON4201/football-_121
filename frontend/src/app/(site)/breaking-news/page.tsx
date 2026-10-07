import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/touchline/seo';
import { getFootballSiteData } from '@/lib/touchline/site-data';
import { BreadcrumbStructuredData, PageLayout, PageIntro, StructuredData } from '@/components/touchline/page-components';
import { NewsExplorer } from '@/components/touchline/directory-explorer';

const TITLE = 'Breaking football news';
const DESCRIPTION = 'Breaking football news and official updates as they are published.';

export const metadata: Metadata = buildPageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/breaking-news',
});

export const revalidate = 60;

export default async function BreakingNewsPage() {
  const data = await getFootballSiteData();
  const stories = data.allNews.filter((story) => story.category.toLowerCase() === 'breaking');
  const { siteConfig } = await import('@/config/site');
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: stories.slice(0, 30).map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: new URL(s.href, siteConfig.siteUrl).toString(),
      name: s.title,
    })),
  };

  return (
    <PageLayout>
      <BreadcrumbStructuredData items={[{ label: 'Home', href: '/' }, { label: 'Breaking news' }]} />
      {stories.length > 0 && <StructuredData data={itemListJsonLd} />}
      <div className="page-container page-container--content news-page">
        <PageIntro eyebrow="Breaking" title={TITLE} breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Breaking news' }]} />
        <NewsExplorer stories={stories} initialCategory="Breaking" />
      </div>
    </PageLayout>
  );
}

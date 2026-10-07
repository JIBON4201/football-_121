import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';
import { JsonLd } from '@/components/seo/JsonLd';
import { FootballHomepage } from '@/components/touchline/homepage';
import { getHomepageData } from '@/lib/touchline/homepage-data';

const HOMEPAGE_TITLE = `${siteConfig.name} — Football, in focus`;
const HOMEPAGE_DESCRIPTION =
  'Global football news, live scores, fixtures, transfer updates and thoughtful analysis from across the game.';

/**
 * Live scores and fixtures come from the Football API on a short revalidation
 * window, so the homepage cannot be served purely as a build-time snapshot.
 */
export const revalidate = 30;

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: { absolute: HOMEPAGE_TITLE },
  description: HOMEPAGE_DESCRIPTION,
  alternates: { canonical: siteConfig.siteUrl },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: siteConfig.name,
    title: HOMEPAGE_TITLE,
    description: HOMEPAGE_DESCRIPTION,
    images: [{ url: siteConfig.defaultImage, width: 1200, height: 630, alt: siteConfig.name }],
  },
  twitter: {
    card: 'summary_large_image',
    title: HOMEPAGE_TITLE,
    description: HOMEPAGE_DESCRIPTION,
    images: [siteConfig.defaultImage],
  },
  robots: 'index,follow',
};

export default async function HomePage() {
  const data = await getHomepageData();

  return (
    <>
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: siteConfig.name,
            url: siteConfig.siteUrl,
            description: HOMEPAGE_DESCRIPTION,
            potentialAction: {
              '@type': 'SearchAction',
              target: {
                '@type': 'EntryPoint',
                urlTemplate: `${siteConfig.siteUrl}/search?q={search_term_string}`,
              },
              'query-input': 'required name=search_term_string',
            },
          },
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: siteConfig.name,
            url: siteConfig.siteUrl,
            logo: `${siteConfig.siteUrl}/brand-mark.svg`,
          },
        ]}
      />
      <h1 className="sr-only">Football news, live scores, fixtures and results</h1>
      <FootballHomepage data={data} />
    </>
  );
}
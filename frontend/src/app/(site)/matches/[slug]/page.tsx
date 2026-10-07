import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { siteConfig } from '@/config/site';
import { fetchBreadcrumbs, fetchSeoMetadata, fetchStructuredData, toNextMetadata } from '@/lib/data-fetch';
import { fetchMatchDetail, fetchRelatedMatchNews } from '@/lib/matches';
import { isValidSlug } from '@/lib/validation';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { JsonLd } from '@/components/seo/JsonLd';
import { MatchDetailView } from '@/components/matches/MatchDetailView';

interface MatchPageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: MatchPageProps): Promise<Metadata> {
  if (!isValidSlug(params.slug)) {
    return { title: `Match not found | ${siteConfig.name}`, robots: 'noindex,follow' };
  }
  const meta = await fetchSeoMetadata('match', params.slug);
  return toNextMetadata(meta, 'Match report', `/matches/${params.slug}`);
}

export default async function MatchPage({ params }: MatchPageProps) {
  // An invalid slug must 404 without ever reaching the API.
  if (!isValidSlug(params.slug)) notFound();

  // Breadcrumbs, structured data and related coverage are supplementary: they
  // resolve independently so one failure never blanks the match report.
  const [result, crumbs, structuredData, relatedNews] = await Promise.all([
    fetchMatchDetail(params.slug),
    fetchBreadcrumbs('match', params.slug),
    fetchStructuredData('match', params.slug),
    fetchRelatedMatchNews(params.slug),
  ]);

  if (result.status === 'not-found') notFound();

  if (!result.details) {
    // Transport/aggregation failure: surface a real 500 via the error
    // boundary rather than an indexable 200 empty shell (soft-404 risk).
    throw new Error(`Match details unavailable for ${params.slug}`);
  }

  const { homeTeam, awayTeam } = result.details;

  return (
    <div className="container">
      {structuredData && structuredData.length > 0 ? <JsonLd data={structuredData} /> : null}
      <Breadcrumbs items={crumbs} />
      <article aria-labelledby="match-heading">
        <h1 className="visually-hidden">{`${homeTeam.name} versus ${awayTeam.name}`}</h1>
        <MatchDetailView details={result.details} relatedNews={relatedNews} serverTime={new Date().toISOString()} />
      </article>
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { siteConfig } from '@/config/site';
import { routeUrl } from '@/config/routes';
import { fetchBreadcrumbs, fetchSeoMetadata, fetchStructuredData, toNextMetadata } from '@/lib/data-fetch';
import {
  fetchPlayerTransferNews,
  fetchTransferDetail,
  TRANSFER_REVALIDATE,
  transferUrl,
} from '@/lib/transfers';
import { sanitizeText } from '@/lib/validation';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { JsonLd } from '@/components/seo/JsonLd';
import { TransferDetailView } from '@/components/transfers/TransferCard';
import { TransferNewsSection } from '@/components/transfers/TransferSections';
import { entityUrl } from '@/config/routes';

interface TransferDetailPageProps {
  params: { id: string };
}

export const revalidate = TRANSFER_REVALIDATE.detail;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Metadata comes from the existing SEO service, which already understands the
 * `transfer` entity and produces a canonical, OG and Twitter set with honest
 * fallbacks. No second SEO implementation is introduced here, and the canonical
 * URL is always the bare transfer path.
 */
export async function generateMetadata({ params }: TransferDetailPageProps): Promise<Metadata> {
  if (!UUID.test(params.id)) {
    return { title: `Transfer not found | ${siteConfig.name}`, robots: 'noindex,nofollow' };
  }
  const meta = await fetchSeoMetadata('transfer', params.id);
  if (!meta) {
    return toNextMetadata(null, 'Transfer', transferUrl(params.id));
  }
  return toNextMetadata(meta, 'Transfer');
}

export default async function TransferDetailPage({ params }: TransferDetailPageProps) {
  // An invalid id 404s before any request is made.
  if (!UUID.test(params.id)) notFound();

  const [result, crumbs, structuredData] = await Promise.all([
    fetchTransferDetail(params.id),
    fetchBreadcrumbs('transfer', params.id),
    // The SEO service emits Organization/WebSite plus BreadcrumbList for a
    // transfer. No transfer-specific schema is invented.
    fetchStructuredData('transfer', params.id),
  ]);

  if (result.status === 'not-found') notFound();

  if (!result.detail) {
    // Transport failure: real 500 via the error boundary, never an
    // indexable 200 empty shell.
    throw new Error(`Transfer details unavailable for ${params.id}`);
  }

  const { detail } = result;
  const player = detail.player;
  // Related coverage is optional and degrades on its own.
  const news = player ? await fetchPlayerTransferNews(player.slug) : { items: [], status: 'error' as const };

  const heading = player
    ? `${player.display_name} transfer`
    : 'Transfer record';

  return (
    <div className="container">
      {structuredData && structuredData.length > 0 ? <JsonLd data={structuredData} /> : null}
      <Breadcrumbs items={crumbs} />
      <article aria-labelledby="transfer-heading">
        <header className="transfer-header">
          <h1 id="transfer-heading">{sanitizeText(heading)}</h1>
          {player ? (
            <p className="transfer-header__player">
              <a href={entityUrl('player', player.slug)}>{sanitizeText(player.display_name)} profile</a>
            </p>
          ) : null}
        </header>
        <TransferDetailView detail={detail} />
      </article>
      {player ? <TransferNewsSection articles={news.items} status={news.status} /> : null}
      <p className="transfer-detail__back">
        <a href={routeUrl('transfers')}>Back to the transfer centre</a>
        {' · '}
        <a href={transferUrl(detail.transfer.id)}>Permalink</a>
      </p>
    </div>
  );
}

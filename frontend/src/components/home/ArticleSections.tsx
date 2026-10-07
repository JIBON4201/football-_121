import { entityUrl } from '@/config/routes';
import { HOMEPAGE_LIMITS, loadBreakingNews, loadLatestNews } from '@/lib/homepage';
import { fetchTransferList, type TransferFilters, type TransferListItem } from '@/lib/transfers';
import { ArticleCard } from '@/components/news/ArticleCard';
import { NewsCard } from '@/components/domain/NewsCard';
import { TransferCard } from '@/components/transfers/TransferCard';
import { HomeSectionSkeleton, SectionShell } from '@/components/home/SectionShell';
import type { Article } from '@/types/api';

function ArticleList({ articles, listLabel }: { articles: Article[]; listLabel: string }) {
  return (
    <ul className="grid-cards" aria-label={listLabel}>
      {articles.map((article) => (
        <li key={article.id}>
          <ArticleCard article={article} href={entityUrl('news', article.slug)} />
        </li>
      ))}
    </ul>
  );
}

export function BreakingNewsView({ articles }: { articles: Article[] }) {
  return <ArticleList articles={articles} listLabel="Breaking news" />;
}

export async function BreakingNewsSection() {
  const section = await loadBreakingNews().catch(() => ({ status: 'error' as const, items: [] }));
  return (
    <SectionShell
      id="home-breaking-heading"
      title="Breaking News"
      href="/breaking-news"
      linkLabel="View all"
      tone="breaking"
      status={section.status}
      emptyTitle="No breaking news"
      emptyDescription="There is no breaking news right now."
    >
      <BreakingNewsView articles={section.items} />
    </SectionShell>
  );
}

export function LatestNewsView({ articles }: { articles: Article[] }) {
  return <ArticleList articles={articles} listLabel="Latest news" />;
}

export async function LatestNewsSection() {
  const section = await loadLatestNews().catch(() => ({ status: 'error' as const, items: [] }));
  return (
    <SectionShell
      id="home-latest-heading"
      title="Latest News"
      href="/news"
      linkLabel="View all"
      status={section.status}
      emptyTitle="No latest stories available"
      emptyDescription="Published stories will appear here."
    >
      <LatestNewsView articles={section.items} />
    </SectionShell>
  );
}

/**
 * Kept for compatibility: the transfer article stream. The homepage transfer
 * section below leads with real transfer records instead.
 */
export function TransferNewsView({ articles }: { articles: Article[] }) {
  return (
    <ul className="grid-cards" aria-label="Transfer news">
      {articles.map((article) => (
        <li key={article.id}>
          <NewsCard article={article} href={entityUrl('news', article.slug)} />
        </li>
      ))}
    </ul>
  );
}

/** Confirmed-only records for the homepage. Rumours stay on /transfers. */
const HOME_TRANSFER_FILTERS: TransferFilters = {
  page: 1,
  limit: HOMEPAGE_LIMITS.transfers,
  status: null,
  type: null,
  player: null,
  team: null,
  fromTeam: null,
  toTeam: null,
  season: null,
  window: null,
  includeUnconfirmed: false,
  sort: 'desc',
  sortField: 'effective_date',
};

export function TransferRecordsView({ items }: { items: TransferListItem[] }) {
  return (
    <ul className="home-transfer-list" aria-label="Latest transfers">
      {items.map((item) => (
        <li key={item.transfer.id}>
          <TransferCard item={item} />
        </li>
      ))}
    </ul>
  );
}

export async function TransferNewsSection() {
  const records = await fetchTransferList(HOME_TRANSFER_FILTERS).catch(() => ({
    status: 'error' as const,
    rows: [],
  }));
  return (
    <SectionShell
      id="home-transfers-heading"
      title="Transfer News"
      href="/transfers"
      linkLabel="View all"
      status={records.status}
      emptyTitle="No transfer updates available"
      emptyDescription="Confirmed transfers will appear here once announced."
    >
      <TransferRecordsView items={records.rows} />
    </SectionShell>
  );
}

export function NewsSectionsSkeleton() {
  return <HomeSectionSkeleton label="Loading news" />;
}

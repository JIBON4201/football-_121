import type { Metadata } from "next";
import { BreadcrumbStructuredData, Breadcrumbs, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { IndexHero } from "@/components/touchline/index-shell";
import { TransferHub, type EnrichedTransfer } from "@/components/touchline/transfer-hub";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getFootballSiteData } from "@/lib/touchline/site-data";
import { getPageParams } from "@/lib/data-fetch";
import { siteConfig } from "@/config/site";
import type { TransferItem } from "@/lib/touchline/homepage-types";

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams?: SearchParams }): Promise<Metadata> {
  const { page } = getPageParams(searchParams ?? {});
  const base = buildPageMetadata({
    title: "Transfer News & Rumours",
    description: "Follow transfer news, reported interest, negotiations and confirmed moves from across world football.",
    path: "/transfers",
  });
  if (page <= 1) return base;
  return {
    ...base,
    title: `Transfer News & Rumours – Page ${page} | ${siteConfig.name}`,
    description: `Follow transfer news and confirmed moves, page ${page}.`,
    alternates: { canonical: `${siteConfig.siteUrl}/transfers?page=${page}` },
  };
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

/**
 * Resolves a transfer entry to its player profile using existing records only.
 * Matches on the full name, or on initial + surname (e.g. "L. Moretti").
 */
function matchesPlayer(transferName: string, playerName: string) {
  const t = normalizeName(transferName);
  const p = normalizeName(playerName);
  if (!t || !p) return false;
  if (t === p) return true;
  const tParts = t.split(" ");
  const pParts = p.split(" ");
  if (tParts[tParts.length - 1] !== pParts[pParts.length - 1]) return false;
  return tParts[0][0] === pParts[0][0];
}

export default async function TransfersPage({ searchParams }: { searchParams?: SearchParams }) {
  const { page } = getPageParams(searchParams ?? {});
  const data = await getFootballSiteData();
  // Merge the full backend transfer list so every /transfers/:id in the sitemap
  // is linked from the centre, not just the 6-item homepage slice.
  let backendItems: TransferItem[] = [];
  let totalPages = 1;
  try {
    const { fetchTransferList, parseTransferFilters } = await import("@/lib/transfers");
    const filters = parseTransferFilters({ page: String(page) });
    const list = await fetchTransferList(filters);
    totalPages = list.pagination.totalPages || 1;
    backendItems = (list.rows ?? [])
      .filter((row) => row.player && row.fromTeam && row.toTeam && row.player.slug && row.fromTeam.slug && row.toTeam.slug)
      .map((row) => ({
        id: row.transfer.id,
        playerName: row.player!.display_name,
        fromTeam: { id: row.fromTeam!.slug, name: row.fromTeam!.name, shortName: row.fromTeam!.short_name?.trim() || row.fromTeam!.name, abbreviation: (row.fromTeam!.short_name?.trim() || row.fromTeam!.name).slice(0, 3).toUpperCase() },
        toTeam: { id: row.toTeam!.slug, name: row.toTeam!.name, shortName: row.toTeam!.short_name?.trim() || row.toTeam!.name, abbreviation: (row.toTeam!.short_name?.trim() || row.toTeam!.name).slice(0, 3).toUpperCase() },
        status: "Official" as const,
        updatedAt: row.transfer.announcement_date ?? row.transfer.effective_date ?? "",
        href: `/transfers/${row.transfer.id}`,
      }));
  } catch {
    backendItems = [];
  }
  const seen = new Set(data.transfers.map((t) => t.id));
  const merged = [...data.transfers, ...backendItems.filter((t) => !seen.has(t.id))];
  const transfers: EnrichedTransfer[] = merged.map((transfer) => {
    const player = data.players.find((item) => matchesPlayer(transfer.playerName, item.name));
    if (!player) return transfer;
    return {
      ...transfer,
      playerImage: transfer.playerImage ?? player.image,
      playerHref: player.href,
      playerPosition: player.position,
    };
  });

  return (
    <PageLayout isDemo={data.isDemo}>
      <BreadcrumbStructuredData items={[{ label: "Home", href: "/" }, { label: "Transfers" }]} />
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: transfers.slice(0, 30).map((t, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: new URL(t.href, siteConfig.siteUrl).toString(),
            name: `${t.playerName} transfer`,
          })),
        }}
      />
      <div className="page-container page-container--content hub-page hub-page--transfers transfers-page">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Transfers" }]} />
        <IndexHero
          eyebrow="Transfers"
          title="Transfer centre"
          figures={[
            { value: String(transfers.length).padStart(2, "0"), label: transfers.length === 1 ? "move" : "moves" },
          ]}
        />

        <div className="hub-body">
          <TransferHub transfers={transfers} stories={data.transferStories} />
          {totalPages > 1 && (
            <nav aria-label="Transfer pages" style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
              {page > 1 && <a className="filter-chip" rel="prev" href={page === 2 ? "/transfers" : `/transfers?page=${page - 1}`}>← Previous</a>}
              <span aria-current="page">Page {page} of {totalPages}</span>
              {page < totalPages && <a className="filter-chip" rel="next" href={`/transfers?page=${page + 1}`}>Next →</a>}
            </nav>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

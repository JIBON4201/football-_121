import type { Metadata } from "next";
import { DirectoryExplorer } from "@/components/touchline/directory-explorer";
import { BreadcrumbStructuredData, PageIntro, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getPlayersPageData } from "@/lib/touchline/site-data";
import { getPageParams } from "@/lib/data-fetch";
import { siteConfig } from "@/config/site";

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams?: SearchParams }): Promise<Metadata> {
  const { page } = getPageParams(searchParams ?? {});
  const base = buildPageMetadata({
    title: `${siteConfig.name} Players`,
    description: "Explore player profiles, positions, current clubs and coverage from across world football.",
    path: "/players",
  });
  if (page <= 1) return base;
  return {
    ...base,
    title: `Players – Page ${page} | ${siteConfig.name}`,
    description: `Browse football player profiles, page ${page}.`,
    alternates: { canonical: `${siteConfig.siteUrl}/players?page=${page}` },
  };
}

export default async function PlayersPage({ searchParams }: { searchParams?: SearchParams }) {
  const { page } = getPageParams(searchParams ?? {});
  // One feed: the paginated player list. The directory renders no matches, clubs,
  // competitions or coverage, so none of those are read.
  const { players: items, totalPages, isDemo } = await getPlayersPageData(page);
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: "Players" }];
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.slice(0, 30).map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: new URL(p.href, siteConfig.siteUrl).toString(),
      name: p.name,
    })),
  };
  return <PageLayout isDemo={isDemo}><BreadcrumbStructuredData items={breadcrumbItems} /><StructuredData data={itemListJsonLd} /><div className="page-container page-container--content players-directory-page">
    <PageIntro eyebrow="Players" title="Player profiles" breadcrumbs={[{ label: "Home", href: "/" }, { label: "Players" }]} />
    <DirectoryExplorer kind="players" items={items} />
    {totalPages > 1 && (
      <nav aria-label="Players pages" style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {page > 1 && <a className="filter-chip" href={page === 2 ? "/players" : `/players?page=${page - 1}`}>← Previous</a>}
        <span aria-current="page">Page {page} of {totalPages}</span>
        {page < totalPages && <a className="filter-chip" href={`/players?page=${page + 1}`}>Next →</a>}
      </nav>
    )}
  </div></PageLayout>;
}

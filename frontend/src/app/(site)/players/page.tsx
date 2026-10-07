import type { Metadata } from "next";
import { DirectoryExplorer } from "@/components/touchline/directory-explorer";
import { BreadcrumbStructuredData, PageIntro, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getFootballSiteData } from "@/lib/touchline/site-data";
import { getPageParams } from "@/lib/data-fetch";
import { fetchPlayerList, PLAYER_PAGE_SIZE } from "@/lib/players";
import { siteConfig } from "@/config/site";
import type { PlayerProfile } from "@/lib/touchline/homepage-types";

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
  const [list, data] = await Promise.all([
    fetchPlayerList({ page, limit: PLAYER_PAGE_SIZE }),
    getFootballSiteData(),
  ]);
  const poolById = new Map(data.players.map((p) => [p.id, p]));
  const profiles: PlayerProfile[] = list.rows.map((row) => poolById.get(row.slug) ?? {
    id: row.slug,
    name: row.display_name,
    position: row.position ?? "",
    href: `/players/${row.slug}`,
    ...(row.photo_url ? { image: { src: row.photo_url, alt: row.display_name } } : {}),
  });
  const items = profiles.length > 0 ? profiles : data.players;
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
  return <PageLayout isDemo={data.isDemo}><BreadcrumbStructuredData items={breadcrumbItems} /><StructuredData data={itemListJsonLd} /><div className="page-container page-container--content players-directory-page">
    <PageIntro eyebrow="Players" title="Player profiles" breadcrumbs={[{ label: "Home", href: "/" }, { label: "Players" }]} />
    <DirectoryExplorer kind="players" items={items} />
    {list.pagination.totalPages > 1 && (
      <nav aria-label="Players pages" style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {page > 1 && <a className="filter-chip" href={page === 2 ? "/players" : `/players?page=${page - 1}`}>← Previous</a>}
        <span aria-current="page">Page {page} of {list.pagination.totalPages}</span>
        {page < list.pagination.totalPages && <a className="filter-chip" href={`/players?page=${page + 1}`}>Next →</a>}
      </nav>
    )}
  </div></PageLayout>;
}

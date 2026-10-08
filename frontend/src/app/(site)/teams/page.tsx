import type { Metadata } from "next";
import { BreadcrumbStructuredData, Breadcrumbs, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { IndexHero } from "@/components/touchline/index-shell";
import { TeamIndex } from "@/components/touchline/team-index";
import { buildTeamDirectory } from "@/lib/touchline/directory-data";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getTeamsPageData } from "@/lib/touchline/site-data";
import { getPageParams } from "@/lib/data-fetch";
import { siteConfig } from "@/config/site";

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams?: SearchParams }): Promise<Metadata> {
  const { page } = getPageParams(searchParams ?? {});
  const base = buildPageMetadata({
    title: `${siteConfig.name} Teams & Clubs`,
    description: "Discover football clubs and national sides from across the global game and explore their team profiles.",
    path: "/teams",
  });
  if (page <= 1) return base;
  const canonical = `${siteConfig.siteUrl}/teams?page=${page}`;
  return {
    ...base,
    title: `Teams & Clubs – Page ${page} | ${siteConfig.name}`,
    description: `Browse football clubs, page ${page}.`,
    alternates: { canonical },
  };
}

export default async function TeamsPage({ searchParams }: { searchParams?: SearchParams }) {
  const { page } = getPageParams(searchParams ?? {});
  // The paginated club list plus the match phases the directory counts coverage
  // from. The club pool, newsroom, transfer tracker and player list are not read.
  const { teams, matches, totalPages, isDemo } = await getTeamsPageData(page);
  const directory = buildTeamDirectory(teams, matches);
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: "Teams" }];
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: teams.slice(0, 30).map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: new URL(t.href, siteConfig.siteUrl).toString(),
      name: t.name,
    })),
  };

  return (
    <PageLayout isDemo={isDemo}>
      <BreadcrumbStructuredData items={breadcrumbItems} />
      <StructuredData data={itemListJsonLd} />
      <div className="page-container page-container--content hub-page hub-page--teams">
        <Breadcrumbs items={breadcrumbItems} />
        <IndexHero
          eyebrow="Teams"
          title="Clubs"
          figures={[
            { value: String(directory.totals.teams).padStart(2, "0"), label: directory.totals.teams === 1 ? "club" : "clubs" },
          ]}
        />

        <div className="hub-body">
          <TeamIndex directory={directory} />
          {totalPages > 1 && (
            <nav aria-label="Teams pages" style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              {page > 1 && <a className="filter-chip" href={page === 2 ? "/teams" : `/teams?page=${page - 1}`}>← Previous</a>}
              <span aria-current="page">Page {page} of {totalPages}</span>
              {page < totalPages && <a className="filter-chip" href={`/teams?page=${page + 1}`}>Next →</a>}
            </nav>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

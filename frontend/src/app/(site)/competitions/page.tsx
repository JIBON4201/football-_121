import type { Metadata } from "next";
import { BreadcrumbStructuredData, Breadcrumbs, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { IndexHero } from "@/components/touchline/index-shell";
import { CompetitionIndex } from "@/components/touchline/competition-index";
import { buildCompetitionDirectory } from "@/lib/touchline/directory-data";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getCompetitionsPageData } from "@/lib/touchline/site-data";
import { getPageParams } from "@/lib/data-fetch";
import { siteConfig } from "@/config/site";

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams?: SearchParams }): Promise<Metadata> {
  const { page } = getPageParams(searchParams ?? {});
  const base = buildPageMetadata({
    title: `${siteConfig.name} Competitions`,
    description: "Explore football leagues and tournaments, with dedicated competition pages, fixtures and coverage.",
    path: "/competitions",
  });
  if (page <= 1) return base;
  return {
    ...base,
    title: `Competitions – Page ${page} | ${siteConfig.name}`,
    description: `Browse football leagues and tournaments, page ${page}.`,
    alternates: { canonical: `${siteConfig.siteUrl}/competitions?page=${page}` },
  };
}

export default async function CompetitionsPage({ searchParams }: { searchParams?: SearchParams }) {
  const { page } = getPageParams(searchParams ?? {});
  // The paginated competition list plus the match phases the directory counts
  // fixtures from. No club, player, news or transfer feeds are read.
  const { competitions, matches, totalPages, isDemo } = await getCompetitionsPageData(page);
  const directory = buildCompetitionDirectory(competitions, matches);
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: "Competitions" }];
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: competitions.slice(0, 30).map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: new URL(c.href, siteConfig.siteUrl).toString(),
      name: c.name,
    })),
  };

  return (
    <PageLayout isDemo={isDemo}>
      <BreadcrumbStructuredData items={breadcrumbItems} />
      <StructuredData data={itemListJsonLd} />
      <div className="page-container page-container--content hub-page hub-page--competitions">
        <Breadcrumbs items={breadcrumbItems} />
        <IndexHero
          eyebrow="Competitions"
          title="Leagues & tournaments"
          figures={[
            { value: String(directory.totals.competitions).padStart(2, "0"), label: directory.totals.competitions === 1 ? "competition" : "competitions" },
          ]}
        />

        <div className="hub-body">
          <CompetitionIndex directory={directory} />
          {totalPages > 1 && (
            <nav aria-label="Competitions pages" style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              {page > 1 && <a className="filter-chip" href={page === 2 ? "/competitions" : `/competitions?page=${page - 1}`}>← Previous</a>}
              <span aria-current="page">Page {page} of {totalPages}</span>
              {page < totalPages && <a className="filter-chip" href={`/competitions?page=${page + 1}`}>Next →</a>}
            </nav>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

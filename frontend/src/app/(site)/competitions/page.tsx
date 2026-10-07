import type { Metadata } from "next";
import { BreadcrumbStructuredData, Breadcrumbs, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { IndexHero } from "@/components/touchline/index-shell";
import { CompetitionIndex } from "@/components/touchline/competition-index";
import { buildCompetitionDirectory } from "@/lib/touchline/directory-data";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getFootballSiteData } from "@/lib/touchline/site-data";
import { getPageParams } from "@/lib/data-fetch";
import { fetchCompetitionList, COMPETITION_PAGE_SIZE } from "@/lib/competitions";
import { siteConfig } from "@/config/site";
import type { CompetitionRef } from "@/lib/touchline/homepage-types";

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
  const [list, data] = await Promise.all([
    fetchCompetitionList({ page, limit: COMPETITION_PAGE_SIZE }),
    getFootballSiteData(),
  ]);
  const poolById = new Map(data.competitions.map((c) => [c.id, c]));
  const refs: CompetitionRef[] = list.rows.map((row) => poolById.get(row.slug) ?? {
    id: row.slug,
    name: row.name,
    abbreviation: (row.short_name?.trim() || row.name).slice(0, 3).toUpperCase(),
    logoUrl: row.logo_url ?? undefined,
    href: `/competitions/${row.slug}`,
    type: row.type ?? undefined,
    region: row.country?.name ?? undefined,
  });
  const competitions = refs.length > 0 ? refs : data.competitions;
  const directory = buildCompetitionDirectory(competitions, data.allMatches);
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
    <PageLayout isDemo={data.isDemo}>
      <BreadcrumbStructuredData items={breadcrumbItems} />
      <StructuredData data={itemListJsonLd} />
      <div className="page-container page-container--content hub-page hub-page--competitions">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Competitions" }]} />
        <IndexHero
          eyebrow="Competitions"
          title="Leagues & tournaments"
          figures={[
            { value: String(directory.totals.competitions).padStart(2, "0"), label: directory.totals.competitions === 1 ? "competition" : "competitions" },
          ]}
        />

        <div className="hub-body">
          <CompetitionIndex directory={directory} />
          {list.pagination.totalPages > 1 && (
            <nav aria-label="Competitions pages" style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              {page > 1 && <a className="filter-chip" href={page === 2 ? "/competitions" : `/competitions?page=${page - 1}`}>← Previous</a>}
              <span aria-current="page">Page {page} of {list.pagination.totalPages}</span>
              {page < list.pagination.totalPages && <a className="filter-chip" href={`/competitions?page=${page + 1}`}>Next →</a>}
            </nav>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

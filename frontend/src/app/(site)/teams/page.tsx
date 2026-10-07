import type { Metadata } from "next";
import { BreadcrumbStructuredData, Breadcrumbs, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { IndexHero } from "@/components/touchline/index-shell";
import { TeamIndex } from "@/components/touchline/team-index";
import { buildTeamDirectory } from "@/lib/touchline/directory-data";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getFootballSiteData } from "@/lib/touchline/site-data";
import { getPageParams } from "@/lib/data-fetch";
import { fetchTeamList, TEAM_PAGE_SIZE } from "@/lib/teams";
import { siteConfig } from "@/config/site";
import type { TeamProfile } from "@/lib/touchline/homepage-types";

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

function toTeamProfile(row: { slug: string; name: string; short_name?: string | null; logo_url?: string | null; country?: { name?: string } | null }): TeamProfile {
  const short = row.short_name?.trim() || row.name;
  const abbr = short.slice(0, 3).toUpperCase();
  return {
    id: row.slug,
    name: row.name,
    shortName: short,
    abbreviation: abbr,
    country: row.country?.name ?? undefined,
    logoUrl: row.logo_url ?? undefined,
    href: `/teams/${row.slug}`,
  };
}

export default async function TeamsPage({ searchParams }: { searchParams?: SearchParams }) {
  const { page } = getPageParams(searchParams ?? {});
  const [list, data] = await Promise.all([
    fetchTeamList({ page, limit: TEAM_PAGE_SIZE }),
    getFootballSiteData(),
  ]);
  // Full paginated backend list first (every team crawlable), merged with the
  // homepage pool for richer cards when available. No team is invented.
  const poolById = new Map(data.teams.map((t) => [t.id, t]));
  const profiles: TeamProfile[] = list.rows.map((row) => poolById.get(row.slug) ?? toTeamProfile(row));
  // When the backend list is empty due to an outage, fall back to the pool so
  // the page still renders crawlable links instead of an empty shell.
  const teams = profiles.length > 0 ? profiles : data.teams;
  const directory = buildTeamDirectory(teams, data.allMatches);
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
    <PageLayout isDemo={data.isDemo}>
      <BreadcrumbStructuredData items={breadcrumbItems} />
      <StructuredData data={itemListJsonLd} />
      <div className="page-container page-container--content hub-page hub-page--teams">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Teams" }]} />
        <IndexHero
          eyebrow="Teams"
          title="Clubs"
          figures={[
            { value: String(directory.totals.teams).padStart(2, "0"), label: directory.totals.teams === 1 ? "club" : "clubs" },
          ]}
        />

        <div className="hub-body">
          <TeamIndex directory={directory} />
          {list.pagination.totalPages > 1 && (
            <nav aria-label="Teams pages" style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              {page > 1 && <a className="filter-chip" href={page === 2 ? "/teams" : `/teams?page=${page - 1}`}>← Previous</a>}
              <span aria-current="page">Page {page} of {list.pagination.totalPages}</span>
              {page < list.pagination.totalPages && <a className="filter-chip" href={`/teams?page=${page + 1}`}>Next →</a>}
            </nav>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

import type { Metadata } from "next";
import { EmptyState, ErrorState } from "@/components/touchline/empty-state";
import { LiveMatchCard, MatchDayGroups } from "@/components/touchline/match-cards";
import { BreadcrumbStructuredData, ContentSection, PageIntro, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getMatchCentreData } from "@/lib/touchline/site-data";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = buildPageMetadata({
  title: `${siteConfig.name} Fixtures & Results`,
  description: "Browse upcoming football fixtures, recent results and live scores from leagues and tournaments worldwide.",
  path: "/matches",
});

export default async function MatchesPage() {
  // Fixtures and results only. Live has its own page at /live.
  const { upcoming, live, results, upcomingFailed, liveFailed, resultsFailed } = await getMatchCentreData();
  const { siteConfig } = await import("@/config/site");
  const all = [...live, ...upcoming, ...results].slice(0, 30);
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: all.map((m, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: new URL(m.href, siteConfig.siteUrl).toString(),
      name: `${m.homeTeam.name} vs ${m.awayTeam.name}`,
    })),
  };

  return (
    <PageLayout>
      <BreadcrumbStructuredData items={[{ label: "Home", href: "/" }, { label: "Matches" }]} />
      {all.length > 0 && <StructuredData data={itemListJsonLd} />}
      <div className="page-container page-container--content matches-page">
        <PageIntro eyebrow="Matches" title="Fixtures & results" description="Kick-off times in UTC unless stated." breadcrumbs={[{ label: "Home", href: "/" }, { label: "Matches" }]} />
        <nav className="match-centre-nav" aria-label="Match centre sections">
          <a href="#upcoming"><span className="match-centre-nav__label">Upcoming</span><strong>{upcoming.length}</strong></a>
          <a href="#live"><span className="match-centre-nav__label"><span className="live-dot" aria-hidden="true" />Live</span><strong>{live.length}</strong></a>
          <a href="#results"><span className="match-centre-nav__label">Results</span><strong>{results.length}</strong></a>
        </nav>
        <div id="upcoming"><ContentSection eyebrow="Upcoming" title="Fixtures">
          {upcoming.length
            ? <MatchDayGroups matches={upcoming} kind="upcoming" />
            : upcomingFailed
              ? <ErrorState title="Fixtures unavailable" description="We could not reach the fixtures feed. Please try again in a moment." />
              : <EmptyState title="No upcoming fixtures" description="Check back soon." />}
        </ContentSection></div>
        <div id="live"><ContentSection eyebrow="Live" title="Live scores">
          {live.length
            ? <div className="live-match-grid">{live.map((match) => <LiveMatchCard match={match} key={match.id} />)}</div>
            : liveFailed
              ? <ErrorState title="Live scores unavailable" description="We could not reach the live feed. Please try again in a moment." />
              : <EmptyState title="No live matches" description="Check back at kick-off." />}
        </ContentSection></div>
        <div id="results"><ContentSection eyebrow="Results" title="Recent results">
          {results.length
            ? <MatchDayGroups matches={results} kind="results" />
            : resultsFailed
              ? <ErrorState title="Results unavailable" description="We could not reach the results feed. Please try again in a moment." />
              : <EmptyState title="No recent results" description="Check back soon." />}
        </ContentSection></div>
      </div>
    </PageLayout>
  );
}

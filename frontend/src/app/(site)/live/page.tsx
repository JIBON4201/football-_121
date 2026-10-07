import type { Metadata } from "next";
import { EmptyState, ErrorState } from "@/components/touchline/empty-state";
import { LiveMatchCard, UpcomingMatchCard } from "@/components/touchline/match-cards";
import { BreadcrumbStructuredData, PageIntro, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getLivePageData } from "@/lib/touchline/site-data";

export const metadata: Metadata = buildPageMetadata({
  title: "Live Football Scores",
  description: "Follow live football scores, match status and upcoming fixtures from competitions around the world.",
  path: "/live",
});

export default async function LivePage() {
  // Only the two match feeds this page renders: what is in play, and what is next.
  const { live, upcoming, liveFailed, upcomingFailed } = await getLivePageData();

  // Grouped by competition so a busy Saturday reads as a set of leagues rather
  // than one undifferentiated list.
  const byCompetition = new Map<string, { name: string; matches: typeof live }>();
  for (const m of live) {
    const g = byCompetition.get(m.competition.id) ?? { name: m.competition.name, matches: [] };
    g.matches.push(m);
    byCompetition.set(m.competition.id, g);
  }
  const groups = [...byCompetition.values()];
  const { siteConfig } = await import("@/config/site");
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: [...live, ...upcoming].slice(0, 30).map((m, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: new URL(m.href, siteConfig.siteUrl).toString(),
      name: `${m.homeTeam.name} vs ${m.awayTeam.name}`,
    })),
  };

  return (
    <PageLayout>
      <BreadcrumbStructuredData items={[{ label: "Home", href: "/" }, { label: "Live" }]} />
      {[...live, ...upcoming].length > 0 && <StructuredData data={itemListJsonLd} />}
      <div className="page-container page-container--content live-page">
        <PageIntro eyebrow="Live" title="Live scores" breadcrumbs={[{ label: "Home", href: "/" }, { label: "Live" }]} />
        <section className="live-page-panel" aria-labelledby="live-now-heading">
          <div className="live-page-panel__heading"><span className="live-page-panel__pulse" aria-hidden="true" /><div><p className="eyebrow">Live now</p><h2 id="live-now-heading">{live.length ? `${live.length} in play` : "Matches in play"}</h2></div></div>
          {live.length ? (
            <div style={{ display: "grid", gap: 22 }}>
              {groups.map((g) => (
                <div key={g.name}>
                  <p className="eyebrow" style={{ color: "var(--color-lime)", marginBottom: 10 }}>{g.name}</p>
                  <div className="live-match-grid">{g.matches.map((match) => <LiveMatchCard match={match} key={match.id} />)}</div>
                </div>
              ))}
            </div>
          ) : liveFailed ? (
            <ErrorState title="Live scores unavailable" description="We could not reach the live feed. Please try again in a moment." />
          ) : (
            <EmptyState title="No matches live" description="Check back at kick-off." />
          )}
        </section>
        <div id="upcoming-live">
          <section className="page-content-section" aria-label="Up next">
            <div className="page-content-section__heading">
              <div><p className="eyebrow">Next</p><h2>Up next</h2></div>
              <a className="text-link" href="/matches">All fixtures <span aria-hidden="true">→</span></a>
            </div>
            {upcoming.length ? (
              <div className="upcoming-grid">{upcoming.slice(0, 4).map((match) => <UpcomingMatchCard match={match} key={match.id} />)}</div>
            ) : upcomingFailed ? (
              <ErrorState title="Fixtures unavailable" description="We could not reach the fixtures feed. Please try again in a moment." compact />
            ) : (
              <EmptyState title="No fixtures" description="Check back soon." compact />
            )}
          </section>
        </div>
      </div>
    </PageLayout>
  );
}

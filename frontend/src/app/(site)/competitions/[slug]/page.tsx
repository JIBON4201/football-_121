import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/touchline/empty-state";
import { NewsCard } from "@/components/touchline/news-card";
import { LiveMatchCard, UpcomingMatchCard, ResultMatchCard } from "@/components/touchline/match-cards";
import { TeamCard } from "@/components/touchline/discovery-cards";
import { BreadcrumbStructuredData, Breadcrumbs, ContentSection, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { buildPageMetadata } from "@/lib/touchline/seo";
import type { TeamProfile } from "@/lib/touchline/homepage-types";
import { getCompetitionBySlug, getCompetitionDetailPageData, getRelatedStories, getSiteUrl } from "@/lib/touchline/site-data";

type RouteProps = { params: { slug: string } };

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = params;
  const competition = await getCompetitionBySlug(slug);
  if (!competition) return buildPageMetadata({ title: "Competition not found", description: "This football competition could not be found.", path: `/competitions/${slug}`, noIndex: true });
  return buildPageMetadata({ title: competition.name, description: `Follow ${competition.name}: fixtures, recent results, standings and related football coverage.`, path: `/competitions/${slug}` });
}

export default async function CompetitionDetailPage({ params }: RouteProps) {
  const { slug } = params;
  // The competition record, the match phases this page tabulates and the
  // newsroom pool for related coverage. Participating clubs come from the
  // fixtures themselves, so no club, player or transfer feed is read.
  const { competition, matches, stories, isDemo } = await getCompetitionDetailPageData(slug);
  if (!competition) notFound();
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: "Competitions", href: "/competitions" }, { label: competition.name, href: `/competitions/${slug}` }];
  const competitionMatches = matches.filter((match) => match.competition.id === competition.id);
  const live = competitionMatches.filter((match) => match.status === "live");
  const upcoming = competitionMatches.filter((match) => match.status === "scheduled").slice().sort((a, b) => new Date(a.kickoffAt ?? 0).getTime() - new Date(b.kickoffAt ?? 0).getTime());
  const recent = competitionMatches.filter((match) => match.status === "finished").slice().sort((a, b) => new Date(b.kickoffAt ?? 0).getTime() - new Date(a.kickoffAt ?? 0).getTime());
  const teamsById = new Map<string, TeamProfile>();
  for (const match of competitionMatches) {
    for (const teamRef of [match.homeTeam, match.awayTeam]) {
      if (!teamsById.has(teamRef.id)) teamsById.set(teamRef.id, { ...teamRef, href: `/teams/${teamRef.id}` });
    }
  }
  const matchTeamIds = new Set(competitionMatches.flatMap((match) => [match.homeTeam.id, match.awayTeam.id]));
  const selectedTeamIds = new Set([...(competition.teamIds ?? []), ...matchTeamIds]);
  const competitionTeams = [...teamsById.values()].filter((team) => selectedTeamIds.has(team.id));
  const related = getRelatedStories(stories, [competition.name, competition.abbreviation]).slice(0, 3);
  const entityJsonLd = { "@context": "https://schema.org", "@type": "SportsOrganization", name: competition.name, sport: "Soccer", url: new URL(`/competitions/${slug}`, getSiteUrl()).toString(), description: `${competition.name} competition coverage on Touchline.` };
  return (
    <PageLayout isDemo={isDemo}>
      <BreadcrumbStructuredData items={breadcrumbItems} /><StructuredData data={entityJsonLd} />
      <div className="page-container page-container--content">
        <Breadcrumbs items={breadcrumbItems} />
        <header className="entity-hero entity-hero--competition" id="overview">
          <span className="entity-hero__mark" style={{ "--entity-accent": competition.accent ?? "#0d1f14" } as CSSProperties}>{competition.logoUrl ? <img src={competition.logoUrl} alt={`${competition.name} logo`} /> : <span>{competition.abbreviation}</span>}</span>
          <div className="entity-hero__copy"><p className="eyebrow">Competition · {competition.region}</p><h1>{competition.name}</h1><p>{competition.type ?? "Competition"} · {competitionMatches.length ? `${competitionMatches.length} ${competitionMatches.length === 1 ? "fixture" : "fixtures"} tracked` : "Fixtures, results, standings and news"}</p></div>
          <a className="button button--dark" href="#fixtures">View fixtures</a>
        </header>
        <div className="entity-facts entity-facts--competition">
          <div><span>Region</span><strong>{competition.region}</strong></div>
          {competition.type && <div><span>Format</span><strong>{competition.type}</strong></div>}
          <div><span>Live now</span><strong>{live.length ? `${live.length} in play` : "None in play"}</strong></div>
          {competitionTeams.length > 0 && <div><span>Teams tracked</span><strong>{competitionTeams.length}</strong></div>}
        </div>
        <nav className="entity-section-nav" aria-label={`${competition.name} sections`}><a href="#fixtures">Fixtures</a><a href="#standings">Standings</a><a href="#participating-teams">Teams</a><a href="#coverage">News</a></nav>
        <div className="competition-detail-layout">
          <div id="fixtures" className="competition-detail-layout__schedule entity-section-anchor">
            {live.length > 0 && (
              <ContentSection eyebrow="Live now" title="Matches in play" description={`${live.length} ${live.length === 1 ? "match" : "matches"} currently in play.`}>
                <div className="live-match-grid">{live.map((match) => <LiveMatchCard match={match} key={match.id} />)}</div>
              </ContentSection>
            )}
            <ContentSection eyebrow="On the schedule" title="Upcoming fixtures" description={upcoming.length ? `${upcoming.length} scheduled ${upcoming.length === 1 ? "fixture" : "fixtures"}.` : undefined}>
              {upcoming.length ? <div className="upcoming-grid">{upcoming.slice(0, 6).map((match) => <UpcomingMatchCard match={match} key={match.id} />)}</div> : <EmptyState title="No fixtures" description="Check back soon." compact />}
            </ContentSection>
            <ContentSection eyebrow="Full time" title="Recent results" description={recent.length ? "Most recent results first." : undefined}>
              {recent.length ? <div className="result-match-grid">{recent.slice(0, 6).map((match) => <ResultMatchCard match={match} key={match.id} />)}</div> : <EmptyState title="No results" description="Check back soon." compact />}
            </ContentSection>
          </div>
          <section id="standings" className="competition-detail-layout__standings entity-section-anchor">
            <ContentSection eyebrow="Table" title="Standings">
              {competition.standings?.length ? (
                <div className="standings-table-wrap" role="region" aria-label={`${competition.name} standings table`} tabIndex={0}>
                  <table className="standings-table">
                    <caption className="sr-only">{competition.name} standings</caption>
                    <thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col">GD</th><th scope="col">Pts</th></tr></thead>
                    <tbody>{competition.standings.slice().sort((a, b) => a.position - b.position).map((standing) => {
                      const team = teamsById.get(standing.teamId);
                      return <tr key={standing.teamId}>
                        <td>{standing.position}</td>
                        <td>{team ? <a className="standings-table__team" href={team.href}><span>{team.abbreviation}</span>{team.name}</a> : <span className="standings-table__team">Team information unavailable</span>}</td>
                        <td>{standing.played}</td><td>{standing.won}</td><td>{standing.drawn}</td><td>{standing.lost}</td>
                        <td>{standing.goalDifference > 0 ? `+${standing.goalDifference}` : standing.goalDifference}</td><td><strong>{standing.points}</strong></td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              ) : <EmptyState title="No standings" description="Check back soon." compact />}
            </ContentSection>
          </section>
        </div>
        <section id="participating-teams" className="entity-section-anchor">
          <ContentSection eyebrow="Squads" title={`Teams`}>
            {competitionTeams.length ? <div className="team-grid">{competitionTeams.map((team) => <TeamCard team={team} key={team.id} />)}</div> : <EmptyState title="No teams" description="Check back soon." compact />}
          </ContentSection>
        </section>
        <div id="coverage" className="entity-section-anchor"><ContentSection eyebrow="News" title="Related coverage">
          {related.length ? <div className="editorial-card-grid">{related.map((story) => <NewsCard story={story} key={story.id} />)}</div> : <EmptyState title="No related stories" description="Check back soon." compact />}
        </ContentSection></div>
      </div>
    </PageLayout>
  );
}

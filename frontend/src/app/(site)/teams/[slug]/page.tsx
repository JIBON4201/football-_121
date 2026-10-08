import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/touchline/empty-state";
import { NewsCard } from "@/components/touchline/news-card";
import { LiveMatchCard, TeamCrest } from "@/components/touchline/match-cards";
import { PlayerCard } from "@/components/touchline/discovery-cards";
import { BreadcrumbStructuredData, Breadcrumbs, ContentSection, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getRelatedStories, getSiteUrl, getTeamDetailPageData, getTeamBySlug } from "@/lib/touchline/site-data";
import type { FootballMatch } from "@/lib/touchline/homepage-types";

type RouteProps = { params: { slug: string } };

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = params;
  const team = await getTeamBySlug(slug);
  if (!team) return buildPageMetadata({ title: "Team not found", description: "This football team could not be found.", path: `/teams/${slug}`, noIndex: true });
  return buildPageMetadata({ title: team.name, description: `Follow ${team.name}: fixtures, results, squad and the latest club coverage.`, path: `/teams/${slug}` });
}

function isHomeSide(match: FootballMatch, teamId: string) {
  return match.homeTeam.id === teamId;
}

function opponentOf(match: FootballMatch, teamId: string) {
  return isHomeSide(match, teamId) ? match.awayTeam : match.homeTeam;
}

function teamResult(match: FootballMatch, teamId: string): "W" | "D" | "L" | null {
  if (match.homeScore === undefined || match.awayScore === undefined) return null;
  const mine = isHomeSide(match, teamId) ? match.homeScore : match.awayScore;
  const theirs = isHomeSide(match, teamId) ? match.awayScore : match.homeScore;
  if (mine > theirs) return "W";
  if (mine < theirs) return "L";
  return "D";
}

function formatDate(kickoffAt: string | undefined, timeZone: string) {
  if (!kickoffAt) return "TBC";
  const date = new Date(kickoffAt);
  if (Number.isNaN(date.getTime())) return "TBC";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(date);
}

function formatTime(kickoffAt: string | undefined, timeZone: string) {
  if (!kickoffAt) return "TBC";
  const date = new Date(kickoffAt);
  if (Number.isNaN(date.getTime())) return "TBC";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
}

function UpcomingRows({ matches, teamId }: { matches: FootballMatch[]; teamId: string }) {
  return (
    <div className="tx-table-wrap">
      <table className="tx-table">
        <caption className="sr-only">Upcoming fixtures.</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Competition</th>
            <th scope="col">Opponent</th>
            <th scope="col">Venue</th>
            <th scope="col">Kick-off</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => {
            const opponent = opponentOf(match, teamId);
            const venue = isHomeSide(match, teamId) ? "Home" : "Away";
            const zone = match.timeZone ?? "UTC";
            return (
              <tr className="tx-row" key={match.id}>
                <td className="tx-cell">{formatDate(match.kickoffAt, zone)}</td>
                <td className="tx-cell">{match.competition.name}</td>
                <td className="tx-cell tx-cell--club">
                  <a className="tx-club" href={`/teams/${opponent.id}`}>
                    <TeamCrest team={opponent} size="sm" />
                    <span className="tx-club__name">{opponent.name}</span>
                  </a>
                </td>
                <td className="tx-cell"><span className="venue-tag">{venue}</span></td>
                <td className="tx-cell tx-cell--fee">{formatTime(match.kickoffAt, zone)} <span className="tx-player__meta">{match.timeZoneLabel ?? "UTC"}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultRows({ matches, teamId }: { matches: FootballMatch[]; teamId: string }) {
  return (
    <div className="tx-table-wrap">
      <table className="tx-table">
        <caption className="sr-only">Recent results.</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Competition</th>
            <th scope="col">Opponent</th>
            <th scope="col">Venue</th>
            <th scope="col">Score</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => {
            const opponent = opponentOf(match, teamId);
            const venue = isHomeSide(match, teamId) ? "Home" : "Away";
            const zone = match.timeZone ?? "UTC";
            const result = teamResult(match, teamId);
            return (
              <tr className="tx-row" key={match.id}>
                <td className="tx-cell">{formatDate(match.kickoffAt, zone)}</td>
                <td className="tx-cell">{match.competition.name}</td>
                <td className="tx-cell tx-cell--club">
                  <a className="tx-club" href={`/teams/${opponent.id}`}>
                    <TeamCrest team={opponent} size="sm" />
                    <span className="tx-club__name">{opponent.name}</span>
                  </a>
                </td>
                <td className="tx-cell"><span className="venue-tag">{venue}</span></td>
                <td className="tx-cell tx-cell--fee">{match.homeScore ?? "–"} – {match.awayScore ?? "–"}</td>
                <td className="tx-cell">{result ? <span className={`result-badge result-badge--${result.toLowerCase()}`}>{result}</span> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function managerInitials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default async function TeamDetailPage({ params }: RouteProps) {
  const { slug } = params;
  // The club record, the match phases this page tabulates and the newsroom pool
  // its coverage links are matched against — no transfer tracker, player
  // directory, competition directory or club pool.
  const { team, matches, stories, isDemo } = await getTeamDetailPageData(slug);
  if (!team) notFound();
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: "Teams", href: "/teams" }, { label: team.name, href: `/teams/${slug}` }];
  const teamMatches = matches.filter((match) => match.homeTeam.id === team.id || match.awayTeam.id === team.id);
  const live = teamMatches.filter((match) => match.status === "live");
  const upcoming = teamMatches.filter((match) => match.status === "scheduled").slice().sort((a, b) => new Date(a.kickoffAt ?? 0).getTime() - new Date(b.kickoffAt ?? 0).getTime());
  const recent = teamMatches.filter((match) => match.status === "finished").slice().sort((a, b) => new Date(b.kickoffAt ?? 0).getTime() - new Date(a.kickoffAt ?? 0).getTime());
  const related = getRelatedStories(stories, [team.name, team.shortName]).slice(0, 3);
  // The squad comes from the club record itself. The player directory carries no
  // club name, so the previous pool-based squad fallback could only ever be empty.
  const squad = team.squad ?? [];
  const squadByPosition = new Map<string, typeof squad>();
  for (const p of squad) {
    const g = squadByPosition.get(p.position) ?? [];
    g.push(p);
    squadByPosition.set(p.position, g);
  }
  const form = recent.map((m) => teamResult(m, team.id)).filter((r): r is "W" | "D" | "L" => r !== null).slice(0, 5);
  const teamFacts = [
    team.country ? { label: "Country", value: team.country } : null,
    team.competitionName ? { label: "Competition", value: team.competitionName } : null,
    team.managerName ? { label: "Manager", value: team.managerName } : null,
    team.abbreviation ? { label: "Club code", value: team.abbreviation } : null,
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact));
  const entityJsonLd = { "@context": "https://schema.org", "@type": "SportsTeam", name: team.name, sport: "Soccer", url: new URL(`/teams/${slug}`, getSiteUrl()).toString() };
  const nextMatch = upcoming[0];
  return (
    <PageLayout isDemo={isDemo}>
      <BreadcrumbStructuredData items={breadcrumbItems} /><StructuredData data={entityJsonLd} />
      <div className="page-container page-container--content">
        <Breadcrumbs items={breadcrumbItems} />
        <header className="entity-hero entity-hero--team" id="overview">
          <span className="entity-hero__team-crest"><TeamCrest team={team} size="lg" /></span>
          <div className="entity-hero__copy"><p className="eyebrow">Club profile{team.country ? ` · ${team.country}` : ""}</p><h1>{team.name}</h1><p>{team.competitionName ?? "Fixtures, results, squad and the latest club coverage"}{form.length > 0 ? ` · Form: ${form.join(" ")}` : ""}</p></div>
          <a className="button button--dark" href="#fixtures">Team fixtures</a>
        </header>
        {teamFacts.length > 0 && <div className="entity-facts entity-facts--team">{teamFacts.map((fact) => <div key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}</div>}
        {team.managerName && (
          <div className="manager-strip">
            <span className="manager-strip__avatar" aria-hidden="true">{managerInitials(team.managerName)}</span>
            <div><strong>{team.managerName}</strong><span>Manager · {team.name}</span></div>
          </div>
        )}
        {nextMatch && (
          <p className="entity-inline-note"><span className="entity-inline-note__marker" aria-hidden="true" />Next: {nextMatch.homeTeam.shortName} v {nextMatch.awayTeam.shortName} — {formatDate(nextMatch.kickoffAt, nextMatch.timeZone ?? "UTC")}, {formatTime(nextMatch.kickoffAt, nextMatch.timeZone ?? "UTC")} ({nextMatch.competition.name})</p>
        )}
        <nav className="entity-section-nav" aria-label={`${team.name} sections`}>{live.length > 0 && <a href="#live">Live</a>}<a href="#fixtures">Fixtures</a><a href="#results">Results</a><a href="#squad">Squad{squad.length ? ` (${squad.length})` : ""}</a><a href="#team-news">News</a></nav>
        {live.length > 0 && (
          <div id="live" className="entity-section-anchor">
            <ContentSection eyebrow="Live" title="In play">
              <div className="live-match-grid">{live.map((match) => <LiveMatchCard match={match} key={match.id} />)}</div>
            </ContentSection>
          </div>
        )}
        <div id="fixtures" className="entity-section-anchor">
          <ContentSection eyebrow="Fixtures" title="Upcoming">
            {upcoming.length ? <UpcomingRows matches={upcoming} teamId={team.id} /> : <EmptyState title="No fixtures" description="Check back soon." compact />}
          </ContentSection>
        </div>
        <div id="results" className="entity-section-anchor"><ContentSection eyebrow="Results" title="Previous matches" description={form.length ? `Recent form: ${form.join(" · ")}.` : undefined}>
          {recent.length ? <ResultRows matches={recent} teamId={team.id} /> : <EmptyState title="No results" description="Check back soon." compact />}
        </ContentSection></div>
        <div id="squad" className="entity-section-anchor"><ContentSection eyebrow="Squad" title="Players" description={squad.length ? `${squad.length} ${squad.length === 1 ? "player" : "players"}. Select a player for the full profile.` : undefined}>
          {squad.length ? (
            <div style={{ display: "grid", gap: 22 }}>
              {[...squadByPosition.entries()].map(([pos, players]) => (
                <div key={pos}>
                  <p className="eyebrow" style={{ marginBottom: 10 }}>{pos} · {players.length}</p>
                  <div className="player-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>{players.map((player) => <PlayerCard player={player} key={player.id} />)}</div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No squad listed" description="Check back soon." compact />}
        </ContentSection></div>
        <div id="team-news" className="entity-section-anchor"><ContentSection eyebrow="News" title="Coverage">
          {related.length ? <div className="editorial-card-grid">{related.map((story) => <NewsCard story={story} key={story.id} />)}</div> : <EmptyState title="No related stories" description="Check back soon." compact />}
        </ContentSection></div>
      </div>
    </PageLayout>
  );
}

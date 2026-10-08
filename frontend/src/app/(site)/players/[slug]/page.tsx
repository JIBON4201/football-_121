import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/touchline/empty-state";
import { NewsCard } from "@/components/touchline/news-card";
import { TeamCrest } from "@/components/touchline/match-cards";
import { BreadcrumbStructuredData, Breadcrumbs, ContentSection, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { readFee, statusSlug } from "@/lib/touchline/directory-data";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getPlayerBySlug, getPlayerDetailPageData, getRelatedStories, getSiteUrl } from "@/lib/touchline/site-data";

 type RouteProps = { params: { slug: string } };

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = params;
  const player = await getPlayerBySlug(slug);
  if (!player) return buildPageMetadata({ title: "Player not found", description: "This football player profile could not be found.", path: `/players/${slug}`, noIndex: true });
  return buildPageMetadata({ title: player.name, description: `${player.name} player profile: position, nationality, current team and related football coverage.`, path: `/players/${slug}`, image: player.image?.src });
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

/** Matches tracked transfers to this player using existing records only. */
function transferMatchesPlayer(transferName: string, playerName: string) {
  const t = normalizeName(transferName);
  const p = normalizeName(playerName);
  if (!t || !p) return false;
  if (t === p) return true;
  const tParts = t.split(" ");
  const pParts = p.split(" ");
  if (tParts[tParts.length - 1] !== pParts[pParts.length - 1]) return false;
  return tParts[0][0] === pParts[0][0];
}

export default async function PlayerProfilePage({ params }: RouteProps) {
  const { slug } = params;
  // The profile, the club pool that resolves its current side, the newsroom pool
  // for coverage links and the tracked-move pool for career history. No match
  // feeds, no competition directory.
  const { player, teams, stories, transfers, isDemo } = await getPlayerDetailPageData(slug);
  if (!player) notFound();
  const teamName = player.teamName;
  // The player list endpoint returns no club name, so team resolution is skipped
  // entirely when the record carries none.
  const team = teamName ? teams.find((item) => item.name.toLocaleLowerCase() === teamName.toLocaleLowerCase()) : undefined;
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: "Players", href: "/players" }, { label: player.name, href: `/players/${slug}` }];
  const related = getRelatedStories(stories, [player.name]).slice(0, 3);
  const teamNews = teamName ? getRelatedStories(stories.filter((s) => !related.some((r) => r.href === s.href)), [teamName]).slice(0, 3) : [];
  const transferHistory = transfers.filter((transfer) => transferMatchesPlayer(transfer.playerName, player.name));
  const previousClubs = transferHistory
    .flatMap((transfer) => [transfer.fromTeam, transfer.toTeam])
    .filter((club, index, list) => list.findIndex((item) => item.id === club.id) === index)
    .filter((club) => !teamName || club.name.toLocaleLowerCase() !== teamName.toLocaleLowerCase());
  const showFee = transferHistory.some((transfer) => readFee(transfer.fee));
  const seasonStats = [
    { label: "Appearances", value: player.seasonStats?.appearances },
    { label: "Goals", value: player.seasonStats?.goals },
    { label: "Assists", value: player.seasonStats?.assists },
    { label: "Minutes", value: player.seasonStats?.minutes },
    { label: "Clean sheets", value: player.seasonStats?.cleanSheets },
    { label: "Yellow cards", value: player.seasonStats?.yellowCards },
    { label: "Red cards", value: player.seasonStats?.redCards },
  ].filter((item): item is { label: string; value: number } => typeof item.value === "number");
  const entityJsonLd = { "@context": "https://schema.org", "@type": "Person", name: player.name, jobTitle: "Footballer", nationality: player.country, image: player.image?.src, affiliation: team ? { "@type": "SportsTeam", name: team.name } : { "@type": "SportsTeam", name: player.teamName }, url: new URL(`/players/${slug}`, getSiteUrl()).toString() };
  return (
    <PageLayout isDemo={isDemo}>
      <BreadcrumbStructuredData items={breadcrumbItems} /><StructuredData data={entityJsonLd} />
      <div className="page-container page-container--content player-detail-page">
        <Breadcrumbs items={breadcrumbItems} />
        <header className="player-profile-hero" id="overview">
          <div className="player-profile-hero__image">{player.image ? <img src={player.image.src} srcSet={player.image.srcSet} sizes="(max-width: 680px) 40vw, 320px" alt={player.image.alt} fetchPriority="high" /> : <span aria-hidden="true">{player.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>}</div>
          <div className="player-profile-hero__copy">
            <p className="eyebrow">Player profile · {player.position}</p>
            <h1>{player.name}</h1>
            <p className="player-profile-hero__team">{team && <TeamCrest team={team} size="sm" />}{player.teamName} · {player.country}</p>
            <div className="player-profile-facts">
              <div><span>Position</span><strong>{player.position}</strong></div>
              <div><span>Nationality</span><strong>{player.country}</strong></div>
              <div><span>Current team</span><strong>{player.teamName}</strong></div>
            </div>
            {team && <a className="text-link" href={team.href}>View {team.name} profile <span aria-hidden="true">→</span></a>}
          </div>
        </header>
        <nav className="entity-section-nav player-section-nav" aria-label={`${player.name} sections`}><a href="#player-stats">Statistics</a>{transferHistory.length > 0 && <a href="#player-transfers">Transfers</a>}<a href="#player-news">News &amp; analysis</a>{team && <a href={team.href}>Club profile →</a>}</nav>
        <section id="player-stats" className="entity-section-anchor"><ContentSection eyebrow={player.seasonStats?.season ?? "Stats"} title="Season statistics">
          {seasonStats.length ? <div className="player-stat-grid">{seasonStats.map((stat) => <div className="player-stat" key={stat.label}><span>{stat.label}</span><strong>{stat.value.toLocaleString("en-GB")}</strong></div>)}</div> : <EmptyState title="No statistics" description="Check back soon." compact />}
        </ContentSection></section>
        {transferHistory.length > 0 && (
          <section id="player-transfers" className="entity-section-anchor"><ContentSection eyebrow="Career" title="Transfer history">
            <div className="tx-table-wrap">
              <table className="tx-table">
                <caption className="sr-only">{player.name} transfer history.</caption>
                <thead>
                  <tr>
                    <th scope="col">From</th>
                    <th scope="col"><span className="sr-only">To</span></th>
                    <th scope="col">To</th>
                    <th scope="col">Status</th>
                    {showFee && <th scope="col">Fee</th>}
                  </tr>
                </thead>
                <tbody>
                  {transferHistory.map((transfer) => (
                    <tr className="tx-row" key={transfer.id}>
                      <td className="tx-cell tx-cell--club"><a className="tx-club" href={`/teams/${transfer.fromTeam.id}`}><span className="tx-club__name">{transfer.fromTeam.shortName}</span></a></td>
                      <td className="tx-cell tx-cell--arrow" aria-hidden="true"><span className="tx-arrow">→</span></td>
                      <td className="tx-cell tx-cell--club"><a className="tx-club" href={`/teams/${transfer.toTeam.id}`}><span className="tx-club__name">{transfer.toTeam.shortName}</span></a></td>
                      <td className="tx-cell tx-cell--status"><span className={`tx-status tx-status--${statusSlug(transfer.status)}`}>{transfer.status}</span></td>
                      {showFee && <td className="tx-cell tx-cell--fee">{readFee(transfer.fee) ?? null}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previousClubs.length > 0 && (
              <p className="tx-table-meta" style={{ marginTop: 12 }}>Previous clubs: {previousClubs.map((club, index) => (
                <span key={club.id}><a className="text-link" style={{ minHeight: 0 }} href={`/teams/${club.id}`}>{club.name}</a>{index < previousClubs.length - 1 ? " · " : ""}</span>
              ))}</p>
            )}
          </ContentSection></section>
        )}
        <section id="player-news" className="entity-section-anchor"><ContentSection eyebrow="News" title={`Coverage`}>
          {related.length ? <div className="editorial-card-grid">{related.map((story) => <NewsCard story={story} key={story.id} />)}</div> : <EmptyState title="No related stories" description="Check back soon." compact />}
        </ContentSection>
        {teamNews.length > 0 && <ContentSection eyebrow="Club" title={`More on ${player.teamName}`}><div className="editorial-card-grid">{teamNews.map((story) => <NewsCard story={story} key={story.id} />)}</div></ContentSection>}
        </section>
      </div>
    </PageLayout>
  );
}

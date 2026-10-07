import type { HomepageData } from "@/lib/touchline/homepage-types";
import { SectionHeading } from "./section-heading";
import { EmptyState } from "./empty-state";
import { FeaturedStories } from "./featured-stories";
import { NewsCard } from "./news-card";
import { LiveMatchCard, UpcomingMatchCard } from "./match-cards";
import { TransferCard } from "./transfer-card";
import { CompetitionCard, PlayerCard, TeamCard } from "./discovery-cards";
import { Icon } from "./icons";

function LiveStrip({ data }: { data: HomepageData }) {
  if (!data.liveMatches.length) return null;
  return (
    <section className="home-score-strip" aria-labelledby="home-live-heading">
      <div className="page-container home-score-strip__inner">
        <div className="home-score-strip__label">
          <p className="eyebrow">Live now</p>
          <h2 id="home-live-heading">{data.liveMatches.length} in play</h2>
        </div>
        <div className="home-score-strip__scroll">
          {data.liveMatches.map((m) => (
            <a className="mini-score" href={m.href} key={m.id} aria-label={`${m.homeTeam.name} ${m.homeScore ?? "–"}, ${m.awayTeam.name} ${m.awayScore ?? "–"}`}>
              <span className="mini-score__comp">{m.competition.name} · <span className="mini-score__min">{m.minute}</span></span>
              <span className="mini-score__row">{m.homeTeam.shortName}<strong>{m.homeScore ?? "–"}</strong></span>
              <span className="mini-score__row">{m.awayTeam.shortName}<strong>{m.awayScore ?? "–"}</strong></span>
            </a>
          ))}
        </div>
        <a className="home-score-strip__all" href="/live">Live centre <span aria-hidden="true">→</span></a>
      </div>
    </section>
  );
}

/**
 * The site chrome (header, mobile nav, footer, bottom tab bar) is rendered once by
 * the root layout, so this component renders page content only.
 */
export function FootballHomepage({ data }: { data: HomepageData }) {
  const latestLead = data.latestNews[0];
  const latestSecondary = data.latestNews.slice(1, 4);
  const latestRest = data.latestNews.slice(4);

  return (
    <>
      <div className="home-page">
        <FeaturedStories featuredStory={data.featuredStory} supportingStories={data.supportingStories} />
        <LiveStrip data={data} />

        {data.breakingNews.length > 0 && (
          <section className="breaking-section" id="breaking" aria-labelledby="breaking-heading">
            <div className="page-container breaking-section__inner">
              <div className="breaking-section__label"><span className="breaking-pulse" aria-hidden="true" /> <h2 id="breaking-heading">Breaking</h2></div>
              <div className="breaking-section__items">
                {data.breakingNews.slice(0, 3).map((item) => <article className="breaking-item" key={item.id}><a href={item.href}>{item.headline}</a><time>{item.publishedAt}</time></article>)}
              </div>
              <a className="breaking-section__all" href="/breaking-news" aria-label="All breaking news"><Icon name="arrow-up-right" size={17} /></a>
            </div>
          </section>
        )}

        <section className="section section--live" id="live" aria-labelledby="live-heading">
          <div className="page-container">
            <SectionHeading id="live-heading" eyebrow="Live now" title="Live matches" actionHref="/live" actionLabel="All live matches" live />
            {data.liveMatches.length ? <div className="live-match-grid">{data.liveMatches.map((match) => <LiveMatchCard match={match} key={match.id} />)}</div> : <EmptyState title="No matches live right now" description="Check back at kick-off." compact />}
          </div>
        </section>

        <section className="section" id="news" aria-labelledby="latest-heading" style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-line)" }}>
          <div className="page-container">
            <SectionHeading id="latest-heading" eyebrow="Newsroom" title="Latest news & analysis" actionHref="/news" actionLabel="More news" />
            {latestLead ? (
              <div className="home-split">
                <div>
                  <NewsCard story={latestLead} variant="standard" />
                  <div className="home-latest-secondary">
                    {latestSecondary.map((story) => <NewsCard story={story} variant="compact" key={story.id} />)}
                  </div>
                </div>
                <aside className="home-rail" aria-label="Fixtures and most read">
                  <div className="home-rail__heading"><h2>Coming up</h2><a className="text-link" href="/matches" style={{ minHeight: 0 }}>All fixtures <Icon name="arrow-right" size={14} /></a></div>
                  {data.upcomingMatches.length ? (
                    <ul className="fixture-list">
                      {data.upcomingMatches.slice(0, 5).map((m) => (
                        <li key={m.id}>
                          <time>{m.kickoffAt ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: m.timeZone ?? "UTC" }).format(new Date(m.kickoffAt)) : "TBC"}</time>
                          <span className="fixture-list__teams"><a href={m.href}>{m.homeTeam.shortName} v {m.awayTeam.shortName}</a></span>
                          <span className="fixture-list__comp">{m.competition.abbreviation}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="home-rail__heading" style={{ marginTop: 18 }}><h2>Most read</h2></div>
                  {data.latestNews.slice(0, 3).map((s, i) => (
                    <div key={s.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: "1px solid var(--color-line)" }}>
                      <span style={{ fontSize: 22, fontWeight: 850, color: "var(--color-line-strong)", minWidth: 26 }}>{i + 1}</span>
                      <div><a href={s.href} style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.4 }}>{s.title}</a><div className="meta-line" style={{ marginTop: 3 }}><span>{s.category}</span><span aria-hidden="true">·</span><time>{s.publishedAt}</time></div></div>
                    </div>
                  ))}
                </aside>
              </div>
            ) : <EmptyState title="No stories yet" description="Check back soon." />}
            {latestRest.length > 0 && (
              <div className="editorial-card-grid" style={{ marginTop: 28 }}>
                {latestRest.slice(0, 3).map((story) => <NewsCard story={story} variant="standard" key={story.id} />)}
              </div>
            )}
          </div>
        </section>

        <section className="section section--upcoming" id="matches" aria-labelledby="upcoming-heading">
          <div className="page-container">
            <SectionHeading id="upcoming-heading" eyebrow="Fixtures" title="Upcoming matches" actionHref="/matches" actionLabel="Full fixture list" />
            {data.upcomingMatches.length ? <div className="upcoming-grid">{data.upcomingMatches.slice(0, 4).map((match) => <UpcomingMatchCard match={match} key={match.id} />)}</div> : <EmptyState title="No upcoming fixtures" description="Check back soon." compact />}
          </div>
        </section>

        <section className="section section--transfers" id="transfers" aria-labelledby="transfers-heading">
          <div className="page-container">
            <SectionHeading id="transfers-heading" eyebrow="The market" title="Transfer centre" actionHref="/transfers" actionLabel="All transfer news" inverse />
            <div className="transfers-layout">
              <div className="transfers-layout__list">
                {data.transfers.length ? data.transfers.slice(0, 4).map((transfer) => <TransferCard transfer={transfer} key={transfer.id} />) : <EmptyState title="No transfer updates" description="Check back soon." compact />}
              </div>
              <aside className="transfer-briefing">
                <div className="transfer-briefing__top"><span className="eyebrow">Analysis</span></div>
                <h3>Transfers, in context.</h3>
                <p>Squad needs, scouting and fees.</p>
                <a href="/transfers">Transfer centre <Icon name="arrow-right" size={15} /></a>
                <div className="transfer-briefing__stories">
                  {data.transferStories.slice(0, 2).map((story) => <a className="transfer-briefing__story" href={story.href} key={story.id}><span>{story.category} <span aria-hidden="true">·</span> {story.publishedAt}</span><strong>{story.title}</strong><Icon name="arrow-up-right" size={15} /></a>)}
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section className="section section--discovery" id="competitions" aria-labelledby="competitions-heading">
          <div className="page-container">
            <SectionHeading id="competitions-heading" eyebrow="Competitions" title="Follow the race" actionHref="/competitions" actionLabel="All competitions" />
            {data.competitions.length ? <div className="competition-grid">{data.competitions.slice(0, 6).map((competition) => <CompetitionCard competition={competition} key={competition.id} />)}</div> : <EmptyState title="No competitions yet" description="Check back soon." compact />}
          </div>
        </section>

        <section className="section section--teams" id="teams" aria-labelledby="teams-heading">
          <div className="page-container">
            <SectionHeading id="teams-heading" eyebrow="Clubs" title="Teams to follow" actionHref="/teams" actionLabel="Explore teams" />
            {data.teams.length ? <div className="team-grid">{data.teams.slice(0, 6).map((team) => <TeamCard team={team} key={team.id} />)}</div> : <EmptyState title="No teams yet" description="Check back soon." compact />}
          </div>
        </section>

        <section className="section section--players" id="players" aria-labelledby="players-heading">
          <div className="page-container">
            <SectionHeading id="players-heading" eyebrow="Players" title="Players in focus" actionHref="/players" actionLabel="All players" />
            {data.players.length ? <div className="player-grid">{data.players.slice(0, 5).map((player) => <PlayerCard player={player} key={player.id} />)}</div> : <EmptyState title="No players yet" description="Check back soon." compact />}
          </div>
        </section>
      </div>
    </>
  );
}

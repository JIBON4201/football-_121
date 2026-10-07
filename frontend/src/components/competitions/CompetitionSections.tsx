import { entityUrl, routeUrl } from '@/config/routes';
import { competitionTypeLabel } from '@/components/competitions/CompetitionHeader';
import { ArticleCard } from '@/components/news/ArticleCard';
import { TeamBadge } from '@/components/domain/Badges';
import { sanitizeText } from '@/lib/validation';
import {
  COMPETITION_CANONICAL,
  type Article,
  type CompetitionRecord,
  type Country,
  type Season,
  type StandingTeam,
} from '@/lib/competitions';

// ---------------------------------------------------------------------------
// Participating teams
// ---------------------------------------------------------------------------

interface CompetitionTeamsProps {
  teams: StandingTeam[];
  /** Rendered heading level so the section nests correctly. */
  headingLevel?: 2 | 3;
  id?: string;
}

/** Teams taking part, each linking to its canonical team page. */
export function CompetitionTeams({ teams, headingLevel = 2, id = 'competition-teams' }: CompetitionTeamsProps) {
  if (teams.length === 0) return null;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="competition-teams" aria-labelledby={`${id}-heading`} id={id}>
      <Heading id={`${id}-heading`}>Participating teams</Heading>
      <ul className="competition-teams__list">
        {teams.map((team) => (
          <li key={team.id}>
            <a className="competition-teams__team" href={entityUrl('team', team.slug)}>
              <TeamBadge name={team.name} logoUrl={team.logo_url} size={32} />
              <span>{sanitizeText(team.name)}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="competition-teams__count">
        {teams.length} {teams.length === 1 ? 'team' : 'teams'}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Competition news
// ---------------------------------------------------------------------------

interface CompetitionNewsProps {
  articles: Article[];
  /** 'unavailable' is an error; 'empty' simply has no coverage yet. */
  status: 'ready' | 'empty' | 'error';
  headingLevel?: 2 | 3;
  id?: string;
}

/** Published coverage linked to the competition. */
export function CompetitionNews({ articles, status, headingLevel = 2, id = 'competition-news' }: CompetitionNewsProps) {
  if (status === 'error') {
    return (
      <section className="competition-news" aria-labelledby={`${id}-heading`} id={id}>
        <Heading level={headingLevel} id={`${id}-heading`}>
          Latest news
        </Heading>
        <p role="status">Competition news is temporarily unavailable.</p>
      </section>
    );
  }
  if (status === 'empty' || articles.length === 0) {
    return (
      <section className="competition-news" aria-labelledby={`${id}-heading`} id={id}>
        <Heading level={headingLevel} id={`${id}-heading`}>
          Latest news
        </Heading>
        <p>No published stories are linked to this competition yet.</p>
      </section>
    );
  }
  return (
    <section className="competition-news" aria-labelledby={`${id}-heading`} id={id}>
      <Heading level={headingLevel} id={`${id}-heading`}>
        Latest news
      </Heading>
      <ul className="grid-cards">
        {articles.map((article) => (
          <li key={article.id}>
            <ArticleCard article={article} href={routeUrl('newsDetail', { slug: article.slug })} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Heading({ level, id, children }: { level: 2 | 3; id: string; children: React.ReactNode }) {
  return level === 2 ? <h2 id={id}>{children}</h2> : <h3 id={id}>{children}</h3>;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

interface CompetitionOverviewProps {
  competition: CompetitionRecord;
  season: Season | null;
  teams: StandingTeam[];
  recentMatches: React.ReactNode;
  upcomingMatches: React.ReactNode;
  news: React.ReactNode;
  /** Rendered as a link to the standings view when a table is available. */
  standingsHref?: string;
  /** Region label, shown only when the record carries one. */
  country?: Country | null;
}

/**
 * Reusable overview: identity, current season, participating teams and the
 * supplied match/news sections. Every child renders independently, so a
 * failure in one never blanks the overview.
 */
export function CompetitionOverview({
  competition,
  season,
  teams,
  recentMatches,
  upcomingMatches,
  news,
  standingsHref,
  country,
}: CompetitionOverviewProps) {
  const type = competitionTypeLabel(competition.type);
  return (
    <div className="competition-overview">
      <section className="competition-overview__summary" aria-labelledby="competition-summary-heading">
        <h2 id="competition-summary-heading">At a glance</h2>
        <dl className="competition-overview__facts">
          <div>
            <dt>Competition</dt>
            <dd>{sanitizeText(competition.name)}</dd>
          </div>
          {competition.short_name ? (
            <div>
              <dt>Short name</dt>
              <dd>{sanitizeText(competition.short_name)}</dd>
            </div>
          ) : null}
          {type ? (
            <div>
              <dt>Type</dt>
              <dd>{type}</dd>
            </div>
          ) : null}
          {country ? (
            <div>
              <dt>Region</dt>
              <dd>{sanitizeText(country.name)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Current season</dt>
            <dd>{season ? sanitizeText(season.name) : 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Participating teams</dt>
            <dd>{teams.length}</dd>
          </div>
        </dl>
        <p className="competition-overview__links">
          <a href={COMPETITION_CANONICAL}>All competitions</a>
          {standingsHref ? (
            <>
              {' · '}
              <a href={standingsHref}>Season standings</a>
            </>
          ) : null}
        </p>
      </section>

      <CompetitionTeams teams={teams} headingLevel={2} id="competition-overview-teams" />
      <section className="competition-overview__matches" aria-labelledby="competition-overview-matches">
        <h2 id="competition-overview-matches">Matches</h2>
        <div className="competition-overview__block">
          <h3>Recent results</h3>
          {recentMatches}
        </div>
        <div className="competition-overview__block">
          <h3>Upcoming fixtures</h3>
          {upcomingMatches}
        </div>
      </section>
      {news}
    </div>
  );
}

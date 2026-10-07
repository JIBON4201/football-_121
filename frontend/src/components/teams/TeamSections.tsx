import { entityUrl, routeUrl } from '@/config/routes';
import { MatchCard } from '@/components/matches/MatchCard';
import { Pagination } from '@/components/news/Pagination';
import { ArticleCard } from '@/components/news/ArticleCard';
import { CompetitionBadge, PlayerAvatar } from '@/components/domain/Badges';
import { sanitizeText } from '@/lib/validation';
import { teamHref, type Article, type MatchWindow, type SquadPlayer, type TeamCompetitionEntry, type TeamSelection } from '@/lib/teams';
import type { MatchListItem } from '@/lib/matches';

// ---------------------------------------------------------------------------
// Fixtures and results
// ---------------------------------------------------------------------------

const WINDOW_LABELS: Record<MatchWindow, string> = {
  all: 'All matches',
  upcoming: 'Upcoming',
  results: 'Results',
};

interface TeamMatchesProps {
  slug: string;
  selection: TeamSelection;
  items: MatchListItem[];
  status: 'ready' | 'empty' | 'error';
  pagination?: { page: number; totalPages: number };
}

/** Fixture window filter; every option keeps the canonical team path. */
function MatchWindowNav({ slug, selection }: { slug: string; selection: TeamSelection }) {
  const windows: MatchWindow[] = ['all', 'upcoming', 'results'];
  return (
    <nav className="team-matches__windows" aria-label="Match window">
      {windows.map((window) => (
        <a
          key={window}
          href={teamHref(slug, { ...selection, view: 'matches', window, page: 1 })}
          aria-current={selection.window === window ? 'true' : undefined}
        >
          {WINDOW_LABELS[window]}
        </a>
      ))}
    </nav>
  );
}

/** Team fixtures or results, reusing the shared match card. */
export function TeamMatches({ slug, selection, items, status, pagination }: TeamMatchesProps) {
  return (
    <section className="team-matches" aria-labelledby="team-matches-heading">
      <h2 id="team-matches-heading">Matches</h2>
      <MatchWindowNav slug={slug} selection={selection} />
      {status === 'error' ? (
        <div role="alert">
          <p>Fixtures and results are temporarily unavailable. Please try again shortly.</p>
        </div>
      ) : items.length === 0 ? (
        <p>No matches are available for this selection.</p>
      ) : (
        <>
          <ul className="match-day__list" aria-label="Team matches">
            {items.map((item) => (
              <li key={item.match.id}>
                <MatchCard item={item} />
              </li>
            ))}
          </ul>
          {pagination ? (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              baseHref={routeUrl('teamDetail', { slug })}
              extraQuery={{
                view: 'matches',
                ...(selection.window !== 'all' ? { window: selection.window } : {}),
                ...(selection.seasonId ? { season: selection.seasonId } : {}),
                ...(selection.competition ? { competition: selection.competition } : {}),
              }}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------

interface TeamCompetitionsProps {
  entries: TeamCompetitionEntry[];
  status: 'ready' | 'empty' | 'error';
}

/** Competitions the team competes in, resolved through the participation link. */
export function TeamCompetitions({ entries, status }: TeamCompetitionsProps) {
  return (
    <section className="team-competitions" aria-labelledby="team-competitions-heading">
      <h2 id="team-competitions-heading">Competitions</h2>
      {status === 'error' ? (
        <div role="alert">
          <p>Team competitions are temporarily unavailable. Please try again shortly.</p>
        </div>
      ) : entries.length === 0 ? (
        <p>This team is not currently recorded as competing in any competition.</p>
      ) : (
        <ul className="team-competitions__list">
          {entries.map(({ competition, seasons }) => (
            <li key={competition.id}>
              <a className="team-competitions__link" href={entityUrl('competition', competition.slug)}>
                <CompetitionBadge name={competition.name} logoUrl={competition.logo_url} size={40} />
                <span className="team-competitions__name">{sanitizeText(competition.name)}</span>
              </a>
              {seasons.length > 0 ? (
                <ul className="team-competitions__seasons">
                  {seasons.map((season) => (
                    <li key={season.id}>
                      {sanitizeText(season.name)}
                      {season.is_current ? <span className="team-competitions__current"> · current</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

interface TeamNewsProps {
  articles: Article[];
  status: 'ready' | 'empty' | 'error';
  headingLevel?: 2 | 3;
  id?: string;
}

/** Published coverage linked to the team, most recent first. */
export function TeamNews({ articles, status, headingLevel = 2, id = 'team-news' }: TeamNewsProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="team-news" aria-labelledby={`${id}-heading`} id={id}>
      <Heading id={`${id}-heading`}>News</Heading>
      {status === 'error' ? (
        <p role="status">Team news is temporarily unavailable.</p>
      ) : articles.length === 0 ? (
        <p>No published stories are linked to this team yet.</p>
      ) : (
        <ul className="grid-cards">
          {articles.map((article) => (
            <li key={article.id}>
              <ArticleCard article={article} href={routeUrl('newsDetail', { slug: article.slug })} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Squad preview
// ---------------------------------------------------------------------------

interface SquadPreviewProps {
  squad: SquadPlayer[];
  slug: string;
}

/** A short named list of current players with a link to the full squad. */
export function SquadPreview({ squad, slug }: SquadPreviewProps) {
  const named = squad.filter((row): row is SquadPlayer & { player: NonNullable<SquadPlayer['player']> } => row.player !== null);
  if (named.length === 0) return null;
  return (
    <section className="team-squad-preview" aria-labelledby="team-squad-preview-heading">
      <h2 id="team-squad-preview-heading">Squad</h2>
      <ul className="team-squad-preview__list">
        {named.slice(0, 10).map((row) => (
          <li key={row.player.id}>
            <a className="team-squad-preview__player" href={entityUrl('player', row.player.slug)}>
              <PlayerAvatar name={row.player.display_name} photoUrl={row.player.photo_url} size={24} />
              <span>{sanitizeText(row.player.display_name)}</span>
            </a>
          </li>
        ))}
      </ul>
      <p>
        <a href={teamHref(slug, { view: 'squad' })}>View the full squad</a>
      </p>
    </section>
  );
}

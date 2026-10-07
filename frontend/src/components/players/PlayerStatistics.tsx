import { entityUrl, routeUrl } from '@/config/routes';
import { DateTimeDisplay } from '@/components/domain/DateTimeDisplay';
import { ArticleCard } from '@/components/news/ArticleCard';
import { sanitizeText } from '@/lib/validation';
import {
  formatPlayerStat,
  playerHref,
  PLAYER_STAT_FIELDS,
  PLAYER_STAT_LABELS,
  SCOPE_LABELS,
  type Article,
  type PlayerAppearance,
  type PlayerSelection,
  type PlayerStatisticsPayload,
  type Season,
} from '@/lib/players';

/**
 * Player statistics.
 *
 * Every figure comes from the server-side aggregation. A statistic the API did
 * not report renders as an em dash — never a zero — and the scope of the
 * numbers is always stated so a career total is never mistaken for a
 * single-season one.
 */

const OUTCOME_LABELS: Record<'win' | 'draw' | 'loss', string> = {
  win: 'Win',
  draw: 'Draw',
  loss: 'Loss',
};

/** Aggregate figures with their availability made explicit. */
function TotalsGrid({ payload }: { payload: PlayerStatisticsPayload }) {
  const { totals } = payload;
  return (
    <>
      <dl className="player-stats__totals">
        <div className="player-stats__total">
          <dt>Appearances</dt>
          <dd>{totals.appearances}</dd>
        </div>
        {PLAYER_STAT_FIELDS.map((field) => {
          const value = totals.values[field];
          const partial = totals.partial.includes(field);
          return (
            <div className="player-stats__total" key={field}>
              <dt>
                {PLAYER_STAT_LABELS[field]}
                {partial ? <span className="visually-hidden"> (partially reported)</span> : null}
              </dt>
              <dd title={partial ? 'Some appearances did not report this statistic' : undefined}>
                {formatPlayerStat(value, field)}
              </dd>
            </div>
          );
        })}
      </dl>
      {totals.unavailable.length > 0 || totals.partial.length > 0 ? (
        <p className="player-stats__coverage">
          {totals.unavailable.length > 0
            ? `${totals.unavailable.length} statistic${totals.unavailable.length === 1 ? '' : 's'} were not reported for these appearances`
            : `${totals.partial.length} statistic${totals.partial.length === 1 ? '' : 's'} were only reported for some appearances`}
          . Unreported values are shown as “—” rather than zero.
        </p>
      ) : null}
      {payload.truncated ? (
        <p className="player-stats__coverage">Only the most recent appearances are included, so these totals are a subset.</p>
      ) : null}
    </>
  );
}

function AppearanceRow({ appearance }: { appearance: PlayerAppearance }) {
  return (
    <tr>
      <th scope="row" className="player-appearances__match">
        <a href={routeUrl('matchDetail', { slug: appearance.match_slug })}>
          {appearance.team && appearance.opponent
            ? `${sanitizeText(appearance.team.name)} v ${sanitizeText(appearance.opponent.name)}`
            : sanitizeText(appearance.match_slug)}
        </a>
      </th>
      <td data-label="Competition">
        {appearance.competition ? (
          <a href={entityUrl('competition', appearance.competition.slug)}>
            {sanitizeText(appearance.competition.name)}
          </a>
        ) : (
          '—'
        )}
      </td>
      <td data-label="Date">
        <DateTimeDisplay iso={appearance.scheduled_at} />
      </td>
      <td data-label="Venue">{appearance.is_home ? 'Home' : 'Away'}</td>
      <td data-label="Minutes">{formatPlayerStat(appearance.stats.minutes, 'minutes')}</td>
      <td data-label="Goals">{formatPlayerStat(appearance.stats.goals, 'goals')}</td>
      <td data-label="Assists">{formatPlayerStat(appearance.stats.assists, 'assists')}</td>
      <td data-label="Rating">{formatPlayerStat(appearance.stats.rating, 'rating')}</td>
    </tr>
  );
}

/** Per-appearance table inside a scrollable, keyboard-reachable region. */
function AppearanceTable({ appearances }: { appearances: PlayerAppearance[] }) {
  return (
    <div className="player-appearances__scroll" role="region" aria-label="Player appearances" tabIndex={0}>
      <table className="player-appearances">
        <caption>Recent recorded appearances</caption>
        <thead>
          <tr>
            <th scope="col">Match</th>
            <th scope="col">Competition</th>
            <th scope="col">Date</th>
            <th scope="col">Venue</th>
            <th scope="col">Min</th>
            <th scope="col">Goals</th>
            <th scope="col">Assists</th>
            <th scope="col">Rating</th>
          </tr>
        </thead>
        <tbody>
          {appearances.map((appearance) => (
            <AppearanceRow key={appearance.match_slug} appearance={appearance} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PlayerStatisticsViewProps {
  result: { status: 'ready' | 'unavailable'; payload: PlayerStatisticsPayload | null };
  seasons: Season[];
  selection: PlayerSelection;
  slug: string;
  /** Renders the per-appearance table; the overview uses a compact list. */
  showAppearances?: boolean;
  headingLevel?: 2 | 3;
  id?: string;
}

/** Statistics filter; both scopes are applied by the backend. */
function StatsFilters({ seasons, selection, slug }: { seasons: Season[]; selection: PlayerSelection; slug: string }) {
  return (
    <form className="player-stats__filters" method="get" action={routeUrl('playerDetail', { slug })}>
      <input type="hidden" name="view" value="statistics" />
      <p className="player-stats__field">
        <label htmlFor="player-stats-season">Season</label>
        <select id="player-stats-season" name="season" defaultValue={selection.seasonId ?? ''}>
          <option value="">All seasons</option>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {sanitizeText(season.name)}
            </option>
          ))}
        </select>
      </p>
      <button type="submit">Apply scope</button>
      {selection.seasonId || selection.competition ? (
        <a className="player-stats__reset" href={playerHref(slug, { view: 'statistics' })}>
          Clear scope
        </a>
      ) : null}
    </form>
  );
}

/** Player statistics, with the scope of every figure made explicit. */
export function PlayerStatisticsView({
  result,
  seasons,
  selection,
  slug,
  showAppearances = true,
  headingLevel = 2,
  id = 'player-statistics',
}: PlayerStatisticsViewProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  if (result.status === 'unavailable' || !result.payload) {
    return (
      <section className="player-stats" aria-labelledby={`${id}-heading`} id={id}>
        <Heading id={`${id}-heading`}>Statistics</Heading>
        <div role="alert">
          <p>Player statistics are temporarily unavailable. Please try again shortly.</p>
        </div>
      </section>
    );
  }

  const payload = result.payload;

  return (
    <section className="player-stats" aria-labelledby={`${id}-heading`} id={id}>
      <Heading id={`${id}-heading`}>Statistics</Heading>
      <p className="player-stats__scope">
        Scope: {SCOPE_LABELS[payload.scope]}
        {payload.competition_slug ? ` (${sanitizeText(payload.competition_slug)})` : ''}
      </p>
      <StatsFilters seasons={seasons} selection={selection} slug={slug} />

      {payload.state === 'empty' ? (
        <p>No recorded appearances match this scope yet.</p>
      ) : (
        <>
          <TotalsGrid payload={payload} />
          {showAppearances ? (
            payload.appearances.length === 0 ? (
              <p>No per-match statistics are available for this scope.</p>
            ) : (
              <AppearanceTable appearances={payload.appearances} />
            )
          ) : null}
        </>
      )}
    </section>
  );
}

interface PlayerMatchesProps {
  appearances: PlayerAppearance[];
  status: 'ready' | 'empty' | 'error';
  headingLevel?: 2 | 3;
  id?: string;
}

/** Compact recent-appearances list used by the overview. */
export function PlayerMatches({
  appearances,
  status,
  headingLevel = 2,
  id = 'player-matches',
}: PlayerMatchesProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="player-matches" aria-labelledby={`${id}-heading`} id={id}>
      <Heading id={`${id}-heading`}>Recent matches</Heading>
      {status === 'error' ? (
        <p role="status">Recent matches are temporarily unavailable.</p>
      ) : appearances.length === 0 ? (
        <p>No recorded appearances yet.</p>
      ) : (
        <ul className="player-matches__list">
          {appearances.map((appearance) => (
            <li key={appearance.match_slug}>
              <a href={routeUrl('matchDetail', { slug: appearance.match_slug })}>
                {appearance.team && appearance.opponent
                  ? `${sanitizeText(appearance.team.name)} v ${sanitizeText(appearance.opponent.name)}`
                  : sanitizeText(appearance.match_slug)}
              </a>
              <span className="player-matches__meta">
                <DateTimeDisplay iso={appearance.scheduled_at} />
                {appearance.competition ? <span> · {sanitizeText(appearance.competition.name)}</span> : null}
                <span> · {appearance.is_home ? 'Home' : 'Away'}</span>
                <span>
                  {' · '}
                  {formatPlayerStat(appearance.stats.minutes, 'minutes')} min,{' '}
                  {formatPlayerStat(appearance.stats.goals, 'goals')} goals,{' '}
                  {formatPlayerStat(appearance.stats.assists, 'assists')} assists
                </span>
                {appearance.outcome ? (
                  <span className="player-matches__outcome" data-outcome={appearance.outcome}>
                    {' · '}
                    {OUTCOME_LABELS[appearance.outcome]}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface PlayerNewsProps {
  articles: Article[];
  status: 'ready' | 'empty' | 'error';
  headingLevel?: 2 | 3;
  id?: string;
}

/** Published coverage linked to the player, most recent first. */
export function PlayerNews({ articles, status, headingLevel = 2, id = 'player-news' }: PlayerNewsProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="player-news" aria-labelledby={`${id}-heading`} id={id}>
      <Heading id={`${id}-heading`}>News</Heading>
      {status === 'error' ? (
        <p role="status">Player news is temporarily unavailable.</p>
      ) : articles.length === 0 ? (
        <p>No published stories are linked to this player yet.</p>
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

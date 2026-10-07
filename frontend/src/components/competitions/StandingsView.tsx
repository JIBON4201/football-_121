import { StandingsTable } from '@/components/competitions/StandingsTable';
import { StandingsSkeleton } from '@/components/competitions/CompetitionSkeletons';
import { sanitizeText } from '@/lib/validation';
import type { Season, StandingsResult, StandingsState } from '@/lib/competitions';

interface StandingsViewProps {
  result: StandingsResult;
  season: Season | null;
  /** Rendered when a table exists, so the overview can deep-link into it. */
  isCurrentSeason: boolean;
}

/** Copy for each distinct state, so an empty table is never mistaken for an error. */
const STATE_MESSAGES: Record<StandingsState, { title: string; description: string }> = {
  ready: { title: '', description: '' },
  empty: {
    title: 'No standings yet',
    description: 'No finished matches have been recorded for this season, so there is no table to show.',
  },
  incomplete: {
    title: 'Standings are incomplete',
    description:
      'Some finished matches are missing a result, so this table does not yet reflect every fixture. Treat it as provisional.',
  },
  not_applicable: {
    title: 'No league table',
    description: 'This competition is played as a knockout, so it does not have a league table.',
  },
};

/**
 * Standings surface.
 *
 * An API failure renders an explicit "unavailable" state, which is deliberately
 * different from a competition that genuinely has no results yet. Live updates
 * are out of scope for this step — the table is server-rendered and cached.
 */
export function StandingsView({ result, season, isCurrentSeason }: StandingsViewProps) {
  const heading = season ? `${sanitizeText(season.name)} standings` : 'Standings';

  if (result.status === 'unavailable' || !result.payload) {
    return (
      <section className="standings" aria-labelledby="standings-heading">
        <h2 id="standings-heading">{heading}</h2>
        <div role="alert">
          <p>Standings are temporarily unavailable. Please try again shortly.</p>
        </div>
      </section>
    );
  }

  const { state, standings } = result.payload;
  const copy = STATE_MESSAGES[state];
  const considered = standings.matches_considered;
  const matchWord = considered === 1 ? 'match' : 'matches';
  const hasTable = state === 'ready' || state === 'incomplete';

  return (
    <section className="standings" aria-labelledby="standings-heading">
      <h2 id="standings-heading">{heading}</h2>
      {season ? (
        <p className="standings__season">
          {sanitizeText(season.name)}
          {season.is_current ? ' · current season' : ' · historical season'}
        </p>
      ) : null}

      {copy.title ? (
        <div className="standings__message" role="status">
          <h3>{copy.title}</h3>
          <p>{copy.description}</p>
        </div>
      ) : null}

      {hasTable ? (
        <StandingsTable
          rows={standings.rows}
          teamsById={result.teamsById}
          caption={`${heading}. Based on ${considered} completed ${matchWord}.`}
          isCurrentSeason={isCurrentSeason}
        />
      ) : null}

      <p className="standings__footnote">
        Based on {considered} completed {matchWord}
        {standings.matches_skipped > 0
          ? `; ${standings.matches_skipped} could not be included because a result is missing.`
          : '.'}
      </p>
    </section>
  );
}

/** Placeholder used by the route's loading boundary. */
export function StandingsViewSkeleton() {
  return (
    <section className="standings" aria-labelledby="standings-heading">
      <h2 id="standings-heading">Standings</h2>
      <StandingsSkeleton />
    </section>
  );
}

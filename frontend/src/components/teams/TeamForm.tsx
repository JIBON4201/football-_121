import { entityUrl } from '@/config/routes';
import { sanitizeText } from '@/lib/validation';
import type { TeamFormResult, TeamOutcome, TeamStatisticsPayload, TeamTotals } from '@/lib/teams';

/**
 * Team form and aggregate statistics.
 *
 * Both are rendered from the server-side calculation. Form is a record of
 * completed matches only — there is no prediction or projected result anywhere
 * in this module.
 */

const OUTCOME_LABELS: Record<TeamOutcome, string> = {
  win: 'Win',
  draw: 'Draw',
  loss: 'Loss',
};

/** A resolved opponent, so a form entry can link by canonical slug. */
export interface TeamFormOpponent {
  name: string;
  slug: string;
}

interface TeamFormProps {
  form: TeamFormResult[];
  /** Resolved opponents by team id, so a result is readable and linkable. */
  opponents: Map<string, TeamFormOpponent>;
}

function resultLabel(outcome: TeamOutcome, goalsFor: number, goalsAgainst: number): string {
  return `${OUTCOME_LABELS[outcome]} ${goalsFor}–${goalsAgainst}`;
}

/**
 * Recent results as text, never colour alone: each entry carries a visible
 * letter plus a written outcome, so the information never depends on colour.
 */
export function TeamForm({ form, opponents }: TeamFormProps) {
  if (form.length === 0) return null;
  return (
    <section className="team-form" aria-labelledby="team-form-heading">
      <h2 className="team-form__heading" id="team-form-heading">Recent form</h2>
      <p className="team-form__note">Results of the most recent completed matches.</p>
      <ol className="team-form__list">
        {form.map((result, index) => {
          const opponent = result.opponent_id ? opponents.get(result.opponent_id) : undefined;
          return (
            <li key={`${result.scheduled_at}-${index}`} className="team-form__item" data-outcome={result.outcome}>
              <span className="team-form__badge">
                <span aria-hidden="true">{result.outcome === 'win' ? 'W' : result.outcome === 'draw' ? 'D' : 'L'}</span>
                <span className="visually-hidden">{OUTCOME_LABELS[result.outcome]}</span>
              </span>
              <span className="team-form__score">
                {result.goals_for}–{result.goals_against}
              </span>
              <span className="team-form__opponent">
                {opponent ? (
                  <a href={entityUrl('team', opponent.slug)}>{sanitizeText(opponent.name)}</a>
                ) : (
                  <span className="team-form__opponent-unknown">Opponent not identified</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden">
        {`Summary of the last ${form.length} completed ${form.length === 1 ? 'match' : 'matches'}: `}
        {form
          .map((result, index) => {
            const opponent = result.opponent_id ? opponents.get(result.opponent_id) : undefined;
            return `${resultLabel(result.outcome, result.goals_for, result.goals_against)} against ${
              opponent ? opponent.name : 'an unidentified opponent'
            }${index < form.length - 1 ? '; ' : '.'}`;
          })
          .join('')}
      </p>
    </section>
  );
}

interface StatDefinition {
  label: string;
  description: string;
  value: (totals: TeamTotals) => number;
}

const STAT_DEFINITIONS: StatDefinition[] = [
  { label: 'P', description: 'Matches played', value: (t) => t.played },
  { label: 'W', description: 'Matches won', value: (t) => t.won },
  { label: 'D', description: 'Matches drawn', value: (t) => t.drawn },
  { label: 'L', description: 'Matches lost', value: (t) => t.lost },
  { label: 'GF', description: 'Goals scored', value: (t) => t.goals_for },
  { label: 'GA', description: 'Goals conceded', value: (t) => t.goals_against },
  { label: 'GD', description: 'Goal difference', value: (t) => t.goal_difference },
  { label: 'CS', description: 'Clean sheets', value: (t) => t.clean_sheets },
];

interface TeamStatisticsProps {
  result: { status: 'ready' | 'unavailable'; payload: TeamStatisticsPayload | null };
}

/**
 * Aggregate statistics. Every figure comes from the backend calculation, and a
 * failure is reported as unavailable — an all-zero table is never shown as if
 * it were real data.
 */
export function TeamStatistics({ result }: TeamStatisticsProps) {
  if (result.status === 'unavailable' || !result.payload) {
    return (
      <section className="team-statistics" aria-labelledby="team-statistics-heading">
        <h2 className="team-statistics__heading" id="team-statistics-heading">Statistics</h2>
        <div role="alert">
          <p>Team statistics are temporarily unavailable. Please try again shortly.</p>
        </div>
      </section>
    );
  }

  const { totals, state, matches_considered: considered, matches_skipped: skipped } = result.payload;

  if (state === 'empty') {
    return (
      <section className="team-statistics" aria-labelledby="team-statistics-heading">
        <h2 className="team-statistics__heading" id="team-statistics-heading">Statistics</h2>
        <p>No completed matches have been recorded yet, so there is nothing to summarise.</p>
      </section>
    );
  }

  return (
    <section className="team-statistics" aria-labelledby="team-statistics-heading">
      <h2 className="team-statistics__heading" id="team-statistics-heading">Statistics</h2>
      {state === 'incomplete' ? (
        <p className="team-statistics__warning" role="status">
          Based on {skipped} completed {skipped === 1 ? 'match' : 'matches'} that {skipped === 1 ? 'is' : 'are'} missing a
          result, so this record is provisional.
        </p>
      ) : null}
      <dl className="team-statistics__grid">
        {STAT_DEFINITIONS.map((definition) => (
          <div className="team-statistics__item" key={definition.label}>
            <dt>
              <abbr title={definition.description}>{definition.label}</abbr>
            </dt>
            <dd>{definition.value(totals)}</dd>
          </div>
        ))}
      </dl>
      <p className="team-statistics__footnote">
        Based on {considered} completed {considered === 1 ? 'match' : 'matches'}.
      </p>
    </section>
  );
}

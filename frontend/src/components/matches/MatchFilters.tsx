import { routeUrl } from '@/config/routes';
import { MATCH_PHASES, type MatchFilters, type MatchPhase, toQueryString } from '@/lib/matches';
import { sanitizeText } from '@/lib/validation';
import type { Competition, Team } from '@/types/api';

const PHASE_LABELS: Record<MatchPhase, string> = {
  upcoming: 'Upcoming',
  live: 'In play',
  finished: 'Finished',
};

const SORT_LABELS: Record<'default' | 'asc' | 'desc', string> = {
  default: 'Default',
  asc: 'Earliest first',
  desc: 'Latest first',
};

interface MatchFilterFormProps {
  filters: MatchFilters;
  competitions: Competition[];
  teams: Team[];
  /** Results the current selection produced, used to hide a pointless toolbar. */
  resultCount: number;
}

/**
 * Filter toolbar. A plain GET form: every filter is resolved by the backend,
 * so the page works with or without JavaScript and never filters client-side.
 */
export function MatchFilterForm({ filters, competitions, teams, resultCount }: MatchFilterFormProps) {
  return (
    <form className="match-filters" method="get" action={routeUrl('matches')}>
      <div className="match-filters__grid">
        <p className="match-filters__field">
          <label htmlFor="match-filter-phase">Status</label>
          <select id="match-filter-phase" name="phase" defaultValue={filters.phase ?? ''}>
            <option value="">All matches</option>
            {MATCH_PHASES.map((phase) => (
              <option key={phase} value={phase}>
                {PHASE_LABELS[phase]}
              </option>
            ))}
          </select>
        </p>

        <p className="match-filters__field">
          <label htmlFor="match-filter-competition">Competition</label>
          <select id="match-filter-competition" name="competition" defaultValue={filters.competition ?? ''}>
            <option value="">All competitions</option>
            {competitions.map((competition) => (
              <option key={competition.id} value={competition.slug}>
                {sanitizeText(competition.name)}
              </option>
            ))}
          </select>
        </p>

        <p className="match-filters__field">
          <label htmlFor="match-filter-team">Team</label>
          <select id="match-filter-team" name="team" defaultValue={filters.team ?? ''}>
            <option value="">All teams</option>
            {teams.map((team) => (
              <option key={team.id} value={team.slug}>
                {sanitizeText(team.name)}
              </option>
            ))}
          </select>
        </p>

        <p className="match-filters__field">
          <label htmlFor="match-filter-from">From date</label>
          <input id="match-filter-from" type="date" name="from" defaultValue={filters.from ?? ''} />
        </p>

        <p className="match-filters__field">
          <label htmlFor="match-filter-to">To date</label>
          <input id="match-filter-to" type="date" name="to" defaultValue={filters.to ?? ''} />
        </p>

        <p className="match-filters__field">
          <label htmlFor="match-filter-sort">Order</label>
          <select id="match-filter-sort" name="sort" defaultValue={filters.sort ?? ''}>
            <option value="">{SORT_LABELS.default}</option>
            <option value="asc">{SORT_LABELS.asc}</option>
            <option value="desc">{SORT_LABELS.desc}</option>
          </select>
        </p>
      </div>

      <p className="match-filters__actions">
        <button type="submit">Apply filters</button>
        {resultCount > 0 || filters.phase || filters.competition || filters.team || filters.from || filters.to || filters.sort ? (
          <a className="match-filters__reset" href={routeUrl('matches')}>
            Clear all filters
          </a>
        ) : null}
      </p>
    </form>
  );
}

/**
 * Day navigation. Keeps the active filters and only swaps the date window, so
 * stepping through a competition's fixtures never loses the other selections.
 */
export function MatchDateNav({ filters }: { filters: MatchFilters }) {
  const active = filters.from ?? filters.to;
  if (!active) return null;

  const hrefFor = (dateKey: string | null): string => {
    if (!dateKey) return routeUrl('matches');
    const next: MatchFilters = { ...filters, page: 1, from: dateKey, to: dateKey };
    return `${routeUrl('matches')}${toQueryString(next)}`;
  };

  const shift = (days: number): string | null => {
    const date = new Date(`${active}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  return (
    <nav className="match-date-nav" aria-label="Match date">
      <a href={hrefFor(shift(-1))} rel="prev">
        Previous day
      </a>
      <a className="match-date-nav__today" href={routeUrl('matches')}>
        Clear date
      </a>
      <a href={hrefFor(shift(1))} rel="next">
        Next day
      </a>
    </nav>
  );
}

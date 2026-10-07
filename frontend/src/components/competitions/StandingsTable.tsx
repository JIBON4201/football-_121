import { entityUrl } from '@/config/routes';
import { sanitizeText } from '@/lib/validation';
import { TeamBadge } from '@/components/domain/Badges';
import type { StandingRow, StandingTeam } from '@/lib/competitions';

/**
 * Generic league table.
 *
 * Column set and labels are supplied by the caller so the same component can
 * render a league table, a group table or a future competition-specific table.
 * The component never computes a single figure: every value comes from the
 * server-side standings calculation.
 */

export interface StandingColumn {
  key: string;
  header: string;
  /** Accessible description, e.g. "Wins". */
  description?: string;
  render: (row: StandingRow) => string;
}

export const STANDING_COLUMNS: StandingColumn[] = [
  { key: 'played', header: 'P', description: 'Played', render: (row) => String(row.played) },
  { key: 'won', header: 'W', description: 'Won', render: (row) => String(row.won) },
  { key: 'drawn', header: 'D', description: 'Drawn', render: (row) => String(row.drawn) },
  { key: 'lost', header: 'L', description: 'Lost', render: (row) => String(row.lost) },
  { key: 'goals_for', header: 'GF', description: 'Goals for', render: (row) => String(row.goals_for) },
  { key: 'goals_against', header: 'GA', description: 'Goals against', render: (row) => String(row.goals_against) },
  { key: 'goal_difference', header: 'GD', description: 'Goal difference', render: (row) => String(row.goal_difference) },
  { key: 'points', header: 'Pts', description: 'Points', render: (row) => String(row.points) },
];

interface StandingsTableProps {
  rows: StandingRow[];
  teamsById: Map<string, StandingTeam>;
  caption: string;
  columns?: StandingColumn[];
  /** Rows that have not played yet are de-emphasised, not hidden. */
  isCurrentSeason?: boolean;
}

/** Accessible one-line summary for a single row. */
function rowSummary(row: StandingRow, team: StandingTeam | undefined, columns: StandingColumn[]): string {
  const name = team ? team.name : 'Team details unavailable';
  const figures = columns
    .map((column) => `${column.description ?? column.header} ${column.render(row)}`)
    .join(', ');
  return `Position ${row.position}, ${name}, ${figures}`;
}

/**
 * Semantic table inside a focusable scroll region. On narrow screens the region
 * scrolls horizontally while position and team stay visible, so the most
 * important information is never lost off-screen.
 */
export function StandingsTable({
  rows,
  teamsById,
  caption,
  columns = STANDING_COLUMNS,
  isCurrentSeason = true,
}: StandingsTableProps) {
  if (rows.length === 0) return null;

  return (
    <div className="standings-table__scroll" role="region" aria-label={caption} tabIndex={0}>
      <table className="standings-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="standings-table__position">
              <abbr title="Position">Pos</abbr>
            </th>
            <th scope="col" className="standings-table__team-col">
              Team
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" abbr={column.description ?? column.header}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const team = teamsById.get(row.team_id);
            const unplayed = row.played === 0;
            return (
              <tr
                key={row.team_id}
                className={unplayed || !isCurrentSeason ? 'standings-table__row standings-table__row--muted' : 'standings-table__row'}
              >
                <td className="standings-table__position">{row.position}</td>
                <th scope="row" className="standings-table__team-col">
                  {team ? (
                    <a className="standings-table__team" href={entityUrl('team', team.slug)}>
                      <TeamBadge name={team.name} logoUrl={team.logo_url} size={24} />
                      <span>{sanitizeText(team.name)}</span>
                    </a>
                  ) : (
                    <span className="standings-table__team standings-table__team--unknown">Team details unavailable</span>
                  )}
                  {/* Keeps the row grid intact while giving screen readers the figures. */}
                  <span className="visually-hidden">{rowSummary(row, team, columns)}</span>
                </th>
                {columns.map((column) => (
                  <td key={column.key} data-label={column.description ?? column.header}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

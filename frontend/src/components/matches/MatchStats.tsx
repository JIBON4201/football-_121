import { entityUrl } from '@/config/routes';
import {
  compareTeamStats,
  enrichPlayerStats,
  formatStatValue,
  teamForSide,
  type MatchDetails,
} from '@/lib/matches';
import { sanitizeText } from '@/lib/validation';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import type { EnrichedPlayerStat } from '@/lib/matches';

/** Side-by-side team metrics. Missing values render as an em dash, never 0. */
function TeamStatistics({ details }: { details: MatchDetails }) {
  const stats = compareTeamStats(details);
  if (stats.length === 0) {
    return <p className="match-team-stats__empty">No team statistics are available for this match.</p>;
  }
  return (
    <table className="match-team-stats">
      <caption>Team statistics</caption>
      <thead>
        <tr>
          <th scope="col">{sanitizeText(details.homeTeam.name)}</th>
          <th scope="col">Statistic</th>
          <th scope="col">{sanitizeText(details.awayTeam.name)}</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((row) => (
          <tr key={row.label}>
            <td className="stat-row__value stat-row__value--home">{formatStatValue(row.home, row.suffix)}</td>
            <th scope="row">{row.label}</th>
            <td className="stat-row__value stat-row__value--away">{formatStatValue(row.away, row.suffix)}</td>
          </tr>
        ))}
        {stats
          .filter((row) => row.homeShare !== null && row.awayShare !== null)
          .map((row) => (
            <tr key={`${row.label}-share`}>
              <td colSpan={3}>
                <div
                  className="stat-row"
                  role="img"
                  aria-label={`${row.label} share: home ${row.homeShare}%, away ${row.awayShare}%`}
                >
                  <span className="stat-row__bar" style={{ width: `${row.homeShare ?? 0}%` }} />
                  <span className="stat-row__bar stat-row__bar--away" style={{ width: `${row.awayShare ?? 0}%` }} />
                </div>
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

/** Per-player statistics. Unknown players are labelled, never identified by id. */
function PlayerStatistics({ details }: { details: MatchDetails }) {
  const rows = enrichPlayerStats(details);
  if (rows.length === 0) {
    return <p className="match-player-stats__empty">No player statistics are available for this match.</p>;
  }

  const playerCell = (row: EnrichedPlayerStat) => {
    const team = teamForSide(details, row.side);
    const name = row.player ? (
      <a href={entityUrl('player', row.player.slug)}>{sanitizeText(row.player.display_name)}</a>
    ) : (
      <span className="match-player-stats__unknown">Player details unavailable</span>
    );
    return (
      <>
        {name}
        {team ? <span className="match-player-stats__team"> ({sanitizeText(team.name)})</span> : null}
      </>
    );
  };

  const columns: DataTableColumn<EnrichedPlayerStat>[] = [
    { key: 'player', header: 'Player', render: playerCell },
    { key: 'minutes', header: 'Min', render: (row) => formatStatValue(row.minutes, '') },
    { key: 'goals', header: 'Goals', render: (row) => formatStatValue(row.goals, '') },
    { key: 'assists', header: 'Assists', render: (row) => formatStatValue(row.assists, '') },
    { key: 'shots', header: 'Shots', render: (row) => formatStatValue(row.shots, '') },
    { key: 'passes', header: 'Passes', render: (row) => formatStatValue(row.passes, '') },
    { key: 'tackles', header: 'Tackles', render: (row) => formatStatValue(row.tackles, '') },
    {
      key: 'cards',
      header: 'Cards',
      render: (row) =>
        row.yellow_cards === null && row.red_cards === null ? '—' : `${row.yellow_cards ?? 0}Y / ${row.red_cards ?? 0}R`,
    },
    { key: 'rating', header: 'Rating', render: (row) => formatStatValue(row.rating, '') },
  ];

  return <DataTable columns={columns} rows={rows} caption="Player statistics" rowKey={(row) => row.id} />;
}

/** Full statistics block: team comparison plus a player table. */
export function MatchStats({ details }: { details: MatchDetails }) {
  return (
    <div className="match-stats">
      <TeamStatistics details={details} />
      <PlayerStatistics details={details} />
    </div>
  );
}

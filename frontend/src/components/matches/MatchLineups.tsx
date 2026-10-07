import { entityUrl } from '@/config/routes';
import { lineupsBySide, resolveSide, teamForSide, type LineupRecord, type MatchDetails } from '@/lib/matches';
import { sanitizeText } from '@/lib/validation';
import { TeamBadge } from '@/components/domain/Badges';

/** A lineup row. An unresolved player is described, never printed as an id. */
function PlayerRow({ row }: { row: LineupRecord['players'][number] }) {
  const name = row.player ? sanitizeText(row.player.display_name) : 'Player details unavailable';
  const number = row.shirt_number !== null ? row.shirt_number : null;
  return (
    <li className={row.substitute ? 'match-lineup__player substitute' : 'match-lineup__player'}>
      <span className="match-lineup__number" aria-hidden="true">
        {number ?? ''}
      </span>
      {row.player ? (
        <a className="match-lineup__player-name" href={entityUrl('player', row.player.slug)}>
          {name}
        </a>
      ) : (
        <span className="match-lineup__player-name match-lineup__player-name--unknown">{name}</span>
      )}
      {row.captain ? (
        <abbr title="Captain" className="match-lineup__captain">
          C
        </abbr>
      ) : null}
      {row.position ? <span className="match-lineup__position">{sanitizeText(row.position)}</span> : null}
      {row.minutes_played !== null ? (
        <span className="match-lineup__minutes">{row.minutes_played}&apos;</span>
      ) : null}
    </li>
  );
}

/** Starting eleven and substitutes for one side. */
function TeamLineup({ details, lineup }: { details: MatchDetails; lineup: LineupRecord }) {
  const team = teamForSide(details, resolveSide(lineup.team_id, details.match.home_team_id, details.match.away_team_id));
  const starters = lineup.players.filter((row) => !row.substitute);
  const substitutes = lineup.players.filter((row) => row.substitute);

  return (
    <section className="match-lineup" aria-label={team ? `${team.name} lineup` : 'Team lineup'}>
      <header className="match-lineup__header">
        <h3>
          {team ? (
            <a href={entityUrl('team', team.slug)}>
              <TeamBadge name={team.name} logoUrl={team.logo_url} size={32} />
              {sanitizeText(team.name)}
            </a>
          ) : (
            'Lineup'
          )}
        </h3>
        {lineup.formation ? <p className="match-lineup__formation">{sanitizeText(lineup.formation)}</p> : null}
        {lineup.coach_name ? (
          <p className="match-lineup__coach">Coach: {sanitizeText(lineup.coach_name)}</p>
        ) : null}
      </header>

      {starters.length > 0 ? (
        <>
          <h4>Starting eleven</h4>
          <ul className="match-lineup__players">
            {starters.map((row) => (
              <PlayerRow key={row.id} row={row} />
            ))}
          </ul>
        </>
      ) : null}

      {substitutes.length > 0 ? (
        <>
          <h4>Substitutes</h4>
          <ul className="match-lineup__players">
            {substitutes.map((row) => (
              <PlayerRow key={row.id} row={row} />
            ))}
          </ul>
        </>
      ) : null}

      {lineup.players.length === 0 ? <p>No players have been listed for this team.</p> : null}
    </section>
  );
}

/** Both team lineups, home first. Renders nothing when no lineup exists. */
export function MatchLineups({ details }: { details: MatchDetails }) {
  const lineups = lineupsBySide(details);
  if (lineups.length === 0) {
    return <p className="match-lineups__empty">No lineups have been confirmed for this match yet.</p>;
  }
  return (
    <div className="match-lineups">
      {lineups.map(({ lineup }) => (
        <TeamLineup key={lineup.id} details={details} lineup={lineup} />
      ))}
    </div>
  );
}

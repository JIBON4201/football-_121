import { entityUrl } from '@/config/routes';
import { PlayerAvatar } from '@/components/domain/Badges';
import { sanitizeText } from '@/lib/validation';
import { groupSquad, unresolvedSquad, type SquadGroup, type SquadPlayer } from '@/lib/teams';

/**
 * Squad presentation.
 *
 * `player_team_history` supplies the membership row (shirt number, current
 * flag); the player record supplies the canonical profile. Positions are grouped
 * exactly as recorded — an absent position lands in "Other / unknown" rather
 * than being guessed, and captain status is only shown when the API supplies it.
 */

function PlayerRow({ row }: { row: SquadPlayer }) {
  const player = row.player;
  if (!player) {
    return (
      <li className="squad__player squad__player--unknown">
        <span className="squad__shirt">{row.shirt_number ?? ''}</span>
        <span className="squad__name">Player details unavailable</span>
      </li>
    );
  }
  return (
    <li className="squad__player">
      <span className="squad__shirt" aria-hidden="true">
        {row.shirt_number ?? ''}
      </span>
      <a className="squad__player-link" href={entityUrl('player', player.slug)}>
        <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size={32} />
        <span className="squad__name">{sanitizeText(player.display_name)}</span>
      </a>
      {row.captain ? (
        <abbr title="Captain" className="squad__captain">
          C
        </abbr>
      ) : null}
      {player.position ? <span className="squad__position">{sanitizeText(player.position)}</span> : null}
      {row.shirt_number !== null ? <span className="visually-hidden">Shirt number {row.shirt_number}</span> : null}
    </li>
  );
}

function SquadGroupSection({ group }: { group: SquadGroup }) {
  return (
    <section className="squad__group" aria-labelledby={`squad-group-${group.key}`}>
      <h3 className="squad__group-heading" id={`squad-group-${group.key}`}>
        {group.label}
      </h3>
      <ul className="squad__players">
        {group.players.map((row) => (
          <PlayerRow key={row.player?.id ?? row.season_id ?? group.key} row={row} />
        ))}
      </ul>
    </section>
  );
}

interface SquadListProps {
  squad: SquadPlayer[];
  status: 'ready' | 'empty' | 'error';
  /** Cap the number of groups rendered (used for the overview preview). */
  limitGroups?: number;
  headingLevel?: 2 | 3;
  id?: string;
}

/** Current squad, grouped by recorded position. */
export function SquadList({ squad, status, limitGroups, headingLevel = 2, id = 'squad' }: SquadListProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  if (status === 'error') {
    return (
      <section className="squad" aria-labelledby={`${id}-heading`} id={id}>
        <Heading id={`${id}-heading`}>Squad</Heading>
        <div role="alert">
          <p>The squad is temporarily unavailable. Please try again shortly.</p>
        </div>
      </section>
    );
  }

  const groups = groupSquad(squad);
  if (groups.length === 0) {
    return (
      <section className="squad" aria-labelledby={`${id}-heading`} id={id}>
        <Heading id={`${id}-heading`}>Squad</Heading>
        <p>No current squad has been registered for this team yet.</p>
      </section>
    );
  }

  const shown = limitGroups ? groups.slice(0, limitGroups) : groups;
  const unresolved = unresolvedSquad(squad);
  const total = groups.reduce((sum, group) => sum + group.players.length, 0);

  return (
    <section className="squad" aria-labelledby={`${id}-heading`} id={id}>
      <Heading id={`${id}-heading`}>Squad</Heading>
      <p className="squad__count">
        {total} {total === 1 ? 'player' : 'players'}
        {unresolved > 0 ? ` · ${unresolved} awaiting profile details` : ''}
      </p>
      {shown.map((group) => (
        <SquadGroupSection key={group.key} group={group} />
      ))}
    </section>
  );
}

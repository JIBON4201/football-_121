import { entityUrl } from '@/config/routes';
import {
  buildPlayerIndex,
  eventLabel,
  eventsBySide,
  formatEventMinute,
  teamForSide,
  type MatchDetails,
} from '@/lib/matches';
import { sanitizeText } from '@/lib/validation';
import type { Player } from '@/types/api';

/**
 * Match timeline.
 *
 * `match_events` stores player ids but the API only resolves player records
 * for lineup players, so names come from that index. A player outside the
 * lineup is described by the event alone — an id is never rendered.
 */
export function MatchEvents({ details }: { details: MatchDetails }) {
  const events = eventsBySide(details);
  if (events.length === 0) {
    return <p className="match-events__empty">No match events have been recorded yet.</p>;
  }
  const players = buildPlayerIndex(details);

  const playerLink = (player: Player | undefined) =>
    player ? <a href={entityUrl('player', player.slug)}>{sanitizeText(player.display_name)}</a> : null;

  return (
    <ol className="match-events__list">
      {events.map(({ event, side }) => {
        const team = teamForSide(details, side);
        const minute = formatEventMinute(event.minute, event.extra_minute);
        const scorer = playerLink(players.get(event.player_id ?? ''));
        const assist = playerLink(players.get(event.assist_player_id ?? ''));
        return (
          <li className="match-event" key={event.id}>
            <span className="match-event__minute">{minute || '—'}</span>
            <span className="match-event__type">{sanitizeText(eventLabel(event.type))}</span>
            <span className="match-event__team">
              {team ? (
                <a href={entityUrl('team', team.slug)}>{sanitizeText(team.name)}</a>
              ) : (
                'Team not identified'
              )}
            </span>
            {scorer || assist ? (
              <span className="match-event__player">
                {scorer}
                {scorer && assist ? ' · assist ' : null}
                {assist}
              </span>
            ) : null}
            {event.description ? (
              <span className="match-event__description">{sanitizeText(event.description)}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

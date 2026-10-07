import { entityUrl } from '@/config/routes';
import { trackAttributes } from '@/lib/analytics';
import { liveClockFor, liveTokenFor } from '@/lib/live-state';
import { sanitizeText } from '@/lib/validation';
import { Badge } from '@/components/ui/Badge';
import { TeamBadge } from '@/components/domain/Badges';
import type { MatchListItem } from '@/lib/matches';

/**
 * Live match card.
 *
 * Shows a real backend status token and a score straight from the API. The
 * minute readout is an explicitly-labelled approximation because the data model
 * carries no official clock, and it is omitted whenever a running clock would be
 * untrue (half time, penalties, suspension, or a match that has not kicked off).
 */
export function LiveMatchCard({
  item,
  serverNowMs,
}: {
  item: MatchListItem;
  /** Server-anchored current time, so the clock never trusts the device clock. */
  serverNowMs: number;
}) {
  const { match, homeTeam, awayTeam } = item;
  const status = liveTokenFor(match.status);
  const clock = liveClockFor(match.status, match.scheduled_at, serverNowMs);
  const known = match.home_score !== null && match.away_score !== null;

  return (
    <article className="live-card" data-status={match.status} aria-labelledby={`live-${match.slug}-teams`}>
      {item.competition ? (
        <p className="live-card__competition">
          <a href={entityUrl('competition', item.competition.slug)}>{sanitizeText(item.competition.name)}</a>
        </p>
      ) : null}

      <div className="live-card__teams" id={`live-${match.slug}-teams`}>
        <a className="live-card__team" href={entityUrl('team', homeTeam.slug)}>
          <TeamBadge name={homeTeam.name} logoUrl={homeTeam.logo_url} size={44} />
          <span className="live-card__team-name">{sanitizeText(homeTeam.name)}</span>
        </a>
        <a className="live-card__team" href={entityUrl('team', awayTeam.slug)}>
          <TeamBadge name={awayTeam.name} logoUrl={awayTeam.logo_url} size={44} />
          <span className="live-card__team-name">{sanitizeText(awayTeam.name)}</span>
        </a>
      </div>

      <div className="live-card__centre">
        {status ? (
          <Badge tone={match.status === 'suspended' ? 'warning' : 'live'}>
            <span role="status" aria-live="polite">
              {status.token}
            </span>
            <span className="visually-hidden"> {status.label}</span>
          </Badge>
        ) : null}

        <p
          className="live-card__score"
          data-known={known}
          aria-label={
            known
              ? `${sanitizeText(homeTeam.name)} ${match.home_score}, ${sanitizeText(awayTeam.name)} ${match.away_score}`
              : 'Score not available yet'
          }
        >
          <span aria-hidden="true">{known ? `${match.home_score} - ${match.away_score}` : 'v'}</span>
        </p>

        {clock ? (
          // The approximation is stated in the accessible name so a screen
          // reader never presents it as an official match clock.
          <p className="live-card__clock" aria-label={clock.accessible}>
            <span aria-hidden="true">{clock.label}</span>
          </p>
        ) : (
          <p className="live-card__clock live-card__clock--none" aria-hidden="true">
            &nbsp;
          </p>
        )}
      </div>

      <p className="live-card__actions">
        <a
          className="live-card__link"
          href={entityUrl('match', match.slug)}
          aria-label={`Live match details: ${sanitizeText(homeTeam.name)} versus ${sanitizeText(awayTeam.name)}`}
          {...trackAttributes('match', match.id)}
        >
          Match details
        </a>
      </p>
    </article>
  );
}

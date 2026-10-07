import { entityUrl } from '@/config/routes';
import { trackAttributes } from '@/lib/analytics';
import { isLiveStatus, type MatchListItem } from '@/lib/matches';
import { sanitizeText } from '@/lib/validation';
import { TeamBadge } from '@/components/domain/Badges';
import { DateTimeDisplay } from '@/components/domain/DateTimeDisplay';
import { MatchStatus, ScoreDisplay } from '@/components/domain/MatchStatus';

interface MatchCardProps {
  item: MatchListItem;
  /** Above-the-fold cards load logos eagerly. */
  eagerLogos?: boolean;
}

function TeamSlot({ slug, name, logoUrl, eager }: { slug: string; name: string; logoUrl: string | null; eager?: boolean }) {
  return (
    <a className="match-card__team" href={entityUrl('team', slug)}>
      <TeamBadge name={name} logoUrl={logoUrl} size={40} eager={eager} />
      <span className="match-card__team-name">{sanitizeText(name)}</span>
    </a>
  );
}

/**
 * Listing card for one fixture. Every link uses a real slug resolved from the
 * API, and the score is omitted entirely until both scores are known.
 */
export function MatchCard({ item, eagerLogos = false }: MatchCardProps) {
  const { match, homeTeam, awayTeam, competition, venue } = item;
  const live = isLiveStatus(match.status);

  return (
    <article className="match-card" aria-labelledby={`match-${match.slug}-teams`}>
      {competition ? (
        <p className="match-card__competition">
          <a href={entityUrl('competition', competition.slug)}>{sanitizeText(competition.name)}</a>
        </p>
      ) : null}

      <div className="match-card__teams" id={`match-${match.slug}-teams`}>
        <TeamSlot slug={homeTeam.slug} name={homeTeam.name} logoUrl={homeTeam.logo_url} eager={eagerLogos} />
        <span className="match-card__versus" aria-hidden="true">
          v
        </span>
        <TeamSlot slug={awayTeam.slug} name={awayTeam.name} logoUrl={awayTeam.logo_url} eager={eagerLogos} />
      </div>

      <div className="match-card__header">
        <span className="match-card__status">
          <MatchStatus status={match.status} />
        </span>
        <ScoreDisplay
          homeScore={match.home_score}
          awayScore={match.away_score}
          homeName={homeTeam.name}
          awayName={awayTeam.name}
          status={match.status}
        />
      </div>

      <p className="match-card__meta">
        <span className="match-card__time">
          <DateTimeDisplay iso={match.scheduled_at} label={`Kickoff, ${live ? 'live' : match.status.replace(/_/g, ' ')}`} />
        </span>
        {venue ? (
          <span className="match-card__venue">
            {venue.city ? `${sanitizeText(venue.name)}, ${sanitizeText(venue.city)}` : sanitizeText(venue.name)}
          </span>
        ) : null}
      </p>

      <p className="match-card__footer">
        <a
          className="match-card__link"
          href={entityUrl('match', match.slug)}
          aria-label={`Match report and lineups: ${homeTeam.name} versus ${awayTeam.name}`}
          {...trackAttributes('match', match.id)}
        >
          Match details
        </a>
      </p>
    </article>
  );
}

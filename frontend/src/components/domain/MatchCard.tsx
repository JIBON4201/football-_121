import type { Match } from '@/types/api';
import { trackAttributes } from '@/lib/analytics';
import { MatchStatus, ScoreDisplay } from '@/components/domain/MatchStatus';
import { formatKickoff } from '@/lib/dates';

interface MatchCardProps {
  match: Match;
  homeName: string;
  awayName: string;
  href: string;
}

/** Presentation-only match summary card (typed data in, markup out). */
export function MatchCard({ match, homeName, awayName, href }: MatchCardProps) {
  const kickoff = formatKickoff(match.scheduled_at);
  return (
    <article aria-label={`${homeName} versus ${awayName}`}>
      <a href={href} aria-label={`Match details: ${homeName} versus ${awayName}`} {...trackAttributes('match', match.id)}>
        <h3>
          {homeName} vs {awayName}
        </h3>
      </a>
      <MatchStatus status={match.status} />
      <ScoreDisplay
        homeScore={match.home_score}
        awayScore={match.away_score}
        homeName={homeName}
        awayName={awayName}
        status={match.status}
      />
      <p>
        <time dateTime={match.scheduled_at}>{kickoff.local}</time>{' '}
        <span>
          (<time dateTime={match.scheduled_at}>{kickoff.utc} UTC</time>)
        </span>
      </p>
    </article>
  );
}

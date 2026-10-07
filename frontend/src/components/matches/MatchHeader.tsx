import { entityUrl } from '@/config/routes';
import { formatKickoffBoth, isFinishedStatus, isLiveStatus, isVoidStatus, type MatchDetails } from '@/lib/matches';
import { sanitizeText } from '@/lib/validation';
import { TeamBadge } from '@/components/domain/Badges';
import { MatchStatus, ScoreDisplay } from '@/components/domain/MatchStatus';
import type { Team } from '@/types/api';

function TeamColumn({ team, role }: { team: Team; role: 'Home' | 'Away' }) {
  return (
    <div className="match-header__team">
      <a href={entityUrl('team', team.slug)}>
        <TeamBadge name={team.name} logoUrl={team.logo_url} size={72} eager />
        <span className="match-header__team-name">{sanitizeText(team.name)}</span>
      </a>
      <p className="match-header__team-role">{role}</p>
    </div>
  );
}

interface FactProps {
  label: string;
  children: React.ReactNode;
}

function Fact({ label, children }: FactProps) {
  return (
    <div className="match-header__fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Detail header. Teams, competition and venue always link by canonical slug,
 * and every fact is omitted when the data is genuinely absent.
 */
export function MatchHeader({ details }: { details: MatchDetails }) {
  const { match, homeTeam, awayTeam, competition, season, venue } = details;
  const kickoff = formatKickoffBoth(match.scheduled_at);
  const title = `${homeTeam.name} versus ${awayTeam.name}`;

  return (
    <header className="match-header" aria-labelledby="match-heading">
      <div className="match-header__meta">
        {competition ? (
          <p className="match-header__competition">
            <a href={entityUrl('competition', competition.slug)}>{sanitizeText(competition.name)}</a>
            {season ? <span className="match-header__season"> · {sanitizeText(season.name)}</span> : null}
          </p>
        ) : null}
        <MatchStatus status={match.status} />
      </div>

      <h1 className="match-header__title" id="match-heading">
        {sanitizeText(title)}
      </h1>

      <div className="match-header__teams">
        <TeamColumn team={homeTeam} role="Home" />
        <div className="match-header__center">
          {isLiveStatus(match.status) || isFinishedStatus(match.status) ? (
            <ScoreDisplay
              homeScore={match.home_score}
              awayScore={match.away_score}
              homeName={homeTeam.name}
              awayName={awayTeam.name}
              status={match.status}
            />
          ) : (
            <p className="match-header__vs" aria-hidden="true">
              v
            </p>
          )}
          {isFinishedStatus(match.status) ? <p className="match-header__ft">Full time</p> : null}
          {isVoidStatus(match.status) ? (
            <p className="match-header__ft">{sanitizeText(match.status.replace(/_/g, ' '))}</p>
          ) : null}
        </div>
        <TeamColumn team={awayTeam} role="Away" />
      </div>

      <p className="match-header__kickoff">
        <time dateTime={match.scheduled_at}>{kickoff.local}</time>{' '}
        <span className="match-header__kickoff-utc">({kickoff.utc} UTC)</span>
      </p>

      <dl className="match-header__details-list">
        <Fact label="Competition">
          {competition ? (
            <a href={entityUrl('competition', competition.slug)}>{sanitizeText(competition.name)}</a>
          ) : (
            'Not available'
          )}
        </Fact>
        {season ? <Fact label="Season">{sanitizeText(season.name)}</Fact> : null}
        {match.round ? <Fact label="Round">{sanitizeText(String(match.round))}</Fact> : null}
        {match.matchday !== null && match.matchday !== undefined ? (
          <Fact label="Matchday">{match.matchday}</Fact>
        ) : null}
        <Fact label="Venue">
          {venue ? (
            <span>
              {sanitizeText(venue.name)}
              {venue.city ? `, ${sanitizeText(venue.city)}` : ''}
              {venue.capacity ? <span className="match-header__capacity"> · {venue.capacity.toLocaleString('en-GB')} capacity</span> : null}
            </span>
          ) : (
            'Not available'
          )}
        </Fact>
        <Fact label="Referee">{match.referee_name ? sanitizeText(match.referee_name) : 'Not available'}</Fact>
        <Fact label="Attendance">
          {match.attendance === null || match.attendance === undefined
            ? 'Not available'
            : match.attendance.toLocaleString('en-GB')}
        </Fact>
      </dl>
    </header>
  );
}

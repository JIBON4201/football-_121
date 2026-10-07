import { entityUrl } from '@/config/routes';
import { trackAttributes } from '@/lib/analytics';
import { loadLiveMatches, loadUpcomingMatches, type EnrichedMatch } from '@/lib/homepage';
import { TeamBadge } from '@/components/domain/Badges';
import { DateTimeDisplay } from '@/components/domain/DateTimeDisplay';
import { MatchStatus, ScoreDisplay } from '@/components/domain/MatchStatus';
import { sanitizeText } from '@/lib/validation';
import { HomeLiveRefresher } from '@/components/live/HomeLiveRefresher';
import { HomeSectionSkeleton, SectionShell } from '@/components/home/SectionShell';

/** Enriched match card: logos, competition, venue, score and status. */
export function EnrichedMatchCard({ data, eagerLogos = false }: { data: EnrichedMatch; eagerLogos?: boolean }) {
  const { match, homeTeam, awayTeam, competition, venueName } = data;
  const href = entityUrl('match', match.slug);
  return (
    <article className="match-card match-card--home" data-status={match.status} aria-label={`${homeTeam.name} versus ${awayTeam.name}`}>
      {competition ? <p className="match-card__competition">{sanitizeText(competition.name)}</p> : null}
      <div className="match-card__teams">
        <span className="match-card__team">
          <TeamBadge name={homeTeam.name} logoUrl={homeTeam.logo_url} size={40} eager={eagerLogos} />
          <span className="match-card__team-name">{sanitizeText(homeTeam.name)}</span>
        </span>
        <span className="match-card__team">
          <TeamBadge name={awayTeam.name} logoUrl={awayTeam.logo_url} size={40} eager={eagerLogos} />
          <span className="match-card__team-name">{sanitizeText(awayTeam.name)}</span>
        </span>
      </div>
      <MatchStatus status={match.status} />
      <ScoreDisplay
        homeScore={match.home_score}
        awayScore={match.away_score}
        homeName={homeTeam.name}
        awayName={awayTeam.name}
        status={match.status}
      />
      <p className="match-card__meta">
        <DateTimeDisplay iso={match.scheduled_at} />
        {venueName ? <span> · at {sanitizeText(venueName)}</span> : null}
      </p>
      <a className="match-card__link" href={href} aria-label={`Match details: ${homeTeam.name} versus ${awayTeam.name}`} {...trackAttributes('match', match.id)}>
        Match details
      </a>
    </article>
  );
}

function MatchList({ matches, eagerLogos, listLabel }: { matches: EnrichedMatch[]; eagerLogos?: boolean; listLabel: string }) {
  return (
    <ul className="home-match-list" aria-label={listLabel}>
      {matches.map((data) => (
        <li key={data.match.id} className="home-match-list__item">
          <EnrichedMatchCard data={data} eagerLogos={eagerLogos} />
        </li>
      ))}
    </ul>
  );
}

export function LiveMatchesView({ matches }: { matches: EnrichedMatch[] }) {
  return (
    <div aria-live="polite">
      <MatchList matches={matches} eagerLogos listLabel="Live matches" />
    </div>
  );
}

export async function LiveMatchesSection() {
  const section = await loadLiveMatches().catch(() => ({ status: 'error' as const, items: [] }));
  return (
    <SectionShell
      id="home-live-heading"
      title="Live Now"
      href="/live"
      linkLabel="View all"
      tone="live"
      status={section.status}
      emptyTitle="No matches are live right now"
      emptyDescription="Check the upcoming fixtures below."
    >
      <HomeLiveRefresher statuses={section.items.map((item) => item.match.status)} />
      <LiveMatchesView matches={section.items} />
    </SectionShell>
  );
}

export function UpcomingMatchesView({ matches }: { matches: EnrichedMatch[] }) {
  return <MatchList matches={matches} listLabel="Upcoming matches" />;
}

export async function UpcomingMatchesSection() {
  const section = await loadUpcomingMatches().catch(() => ({ status: 'error' as const, items: [] }));
  return (
    <SectionShell
      id="home-upcoming-heading"
      title="Upcoming Matches"
      href="/matches"
      linkLabel="View all"
      status={section.status}
      emptyTitle="No upcoming matches"
      emptyDescription="Fixtures will appear here once scheduled."
    >
      <UpcomingMatchesView matches={section.items} />
    </SectionShell>
  );
}

export function MatchSectionsSkeleton() {
  return <HomeSectionSkeleton label="Loading matches" />;
}

import { routeUrl } from '@/config/routes';
import { isFinishedStatus, isLiveStatus, isUpcomingStatus, type MatchDetails } from '@/lib/matches';
import { sanitizeText } from '@/lib/validation';
import { Card } from '@/components/ui/Card';
import { DateTimeDisplay } from '@/components/domain/DateTimeDisplay';
import { LiveMatchBanner } from '@/components/live/LiveMatchBanner';
import { MatchEvents } from '@/components/matches/MatchEvents';
import { MatchHeader } from '@/components/matches/MatchHeader';
import { MatchLineups } from '@/components/matches/MatchLineups';
import { MatchStats } from '@/components/matches/MatchStats';
import type { Article } from '@/types/api';

interface MatchDetailViewProps {
  details: MatchDetails;
  relatedNews: Article[];
  /**
   * Server time at render, anchoring the live clock before the first tick.
   * Defaults to render time, which is correct for a server component.
   */
  serverTime?: string;
}

/** Related coverage for this fixture; omitted when nothing is linked. */
function RelatedCoverage({ articles }: { articles: Article[] }) {
  if (articles.length === 0) return null;
  return (
    <section aria-labelledby="match-related-heading" className="match-related">
      <h2 id="match-related-heading">Related coverage</h2>
      <ul>
        {articles.map((article) => (
          <li key={article.id}>
            <a href={routeUrl('newsDetail', { slug: article.slug })}>{sanitizeText(article.title)}</a>
            <DateTimeDisplay iso={article.published_at} timeZone="UTC" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Match page body. The surrounding route owns the `<article>` element and the
 * JSON-LD, so this component renders sections only.
 *
 * Sections that have no data are hidden rather than padded with placeholders;
 * a lineup is only shown for a fixture that is at or past kickoff.
 */
export function MatchDetailView({ details, relatedNews, serverTime }: MatchDetailViewProps) {
  const { match } = details;
  const kickedOff = !isUpcomingStatus(match.status);
  const showLineups = kickedOff;
  const inPlay = isLiveStatus(match.status);
  // Statistics are shown once a match is in progress, but mid-match figures are
  // provisional, so they are labelled as such rather than presented as final.
  const showStats = inPlay || isFinishedStatus(match.status);

  return (
    <div className="match-detail">
      {inPlay ? (
        <LiveMatchBanner
          status={match.status}
          scheduledAt={match.scheduled_at}
          serverTime={serverTime ?? new Date().toISOString()}
        />
      ) : null}

      <MatchHeader details={details} />

      {showLineups ? (
        <Card heading="Lineups" headingLevel={2}>
          <MatchLineups details={details} />
        </Card>
      ) : null}

      <Card heading="Match events" headingLevel={2}>
        <MatchEvents details={details} />
      </Card>

      {showStats ? (
        <Card heading="Statistics" headingLevel={2}>
          {inPlay ? (
            <p className="match-stats__provisional">
              These figures are provisional and will change while the match is in progress.
            </p>
          ) : null}
          <MatchStats details={details} />
        </Card>
      ) : null}

      <RelatedCoverage articles={relatedNews} />

      <nav className="match-detail__nav" aria-label="Match">
        <a href={routeUrl('matches')}>All matches</a>
        <a href={routeUrl('live')}>Live scores</a>
      </nav>
    </div>
  );
}

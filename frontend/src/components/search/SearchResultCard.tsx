import { entityUrl } from '@/config/routes';
import { canonicalResultUrl, highlightParts, type SearchableType } from '@/lib/search';
import { sanitizeText } from '@/lib/validation';
import { TeamBadge, PlayerAvatar, CompetitionBadge } from '@/components/domain/Badges';
import { DateTimeDisplay } from '@/components/domain/DateTimeDisplay';
import { MatchStatus } from '@/components/domain/MatchStatus';
import { SearchResultLink } from '@/components/search/SearchResultLink';
import type { SearchResultItem } from '@/types/api';

/**
 * Search result cards.
 *
 * One card per entity type so each shows the fields that type actually has.
 * Every card links through `SearchResultLink`, which resolves the canonical
 * route from the entity type and backend slug — never from a display name — and
 * every string is rendered as text. Query highlighting works by splitting text
 * into plain segments, never by injecting markup.
 */

interface CardShellProps {
  item: SearchResultItem;
  query: string;
  type: SearchableType;
  /** Rendered outside the link, e.g. a date or score line. */
  aside?: React.ReactNode;
  media?: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
}

/** Renders highlighted text as escaped segments wrapped in <mark>. */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  const parts = highlightParts(text, query);
  return (
    <>
      {parts.map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </>
  );
}

function CardShell({ item, query, type, aside, media, meta, trailing }: CardShellProps) {
  if (!canonicalResultUrl(item)) return null;
  return (
    <li className="search-card" data-entity={type}>
      <SearchResultLink item={item} query={query} media={media} meta={meta} trailing={trailing} />
      {aside ? <p className="search-card__aside">{aside}</p> : null}
    </li>
  );
}

function EntityBadge({ item, name }: { item: SearchResultItem; name: string }) {
  if (item.entity_type === 'team') return <TeamBadge name={name} logoUrl={item.image} size={40} />;
  if (item.entity_type === 'player') return <PlayerAvatar name={name} photoUrl={item.image} size={40} />;
  if (item.entity_type === 'competition') return <CompetitionBadge name={name} logoUrl={item.image} size={40} />;
  if (item.image) {
    return (
      <img
        className="search-card__image"
        src={item.image}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
        aria-hidden="true"
      />
    );
  }
  return <span className="search-card__image search-card__image--empty" aria-hidden="true" />;
}

/** Country, when the search payload carried one. */
function countryOf(item: SearchResultItem): string | null {
  return item.metadata?.country?.name ? sanitizeText(item.metadata.country.name, 80) : null;
}

function TeamResult({ item, query }: { item: SearchResultItem; query: string }) {
  const name = sanitizeText(item.title, 120);
  const country = countryOf(item);
  const short = item.description ? sanitizeText(item.description, 80) : null;
  return (
    <CardShell
      item={item}
      query={query}
      type="team"
      media={<EntityBadge item={item} name={name} />}
      meta={
        <span className="search-card__meta">
          {short ? <span className="search-card__subtle">{short}</span> : null}
          {country ? <span className="search-card__subtle">{country}</span> : null}
        </span>
      }
    />
  );
}

function PlayerResult({ item, query }: { item: SearchResultItem; query: string }) {
  const name = sanitizeText(item.title, 120);
  const position = item.description ? sanitizeText(item.description, 60) : null;
  const currentTeam = item.metadata?.current_team
    ? { name: sanitizeText(item.metadata.current_team.name, 80), slug: item.metadata.current_team.slug }
    : null;
  return (
    <CardShell
      item={item}
      query={query}
      type="player"
      media={<EntityBadge item={item} name={name} />}
      meta={
        <span className="search-card__meta">
          {position ? <span className="search-card__subtle">{position}</span> : null}
          {/* The club is a real canonical entity, so it is a real link. */}
          {currentTeam ? (
            <a className="search-card__subtle" href={entityUrl('team', currentTeam.slug)}>
              {currentTeam.name}
            </a>
          ) : null}
        </span>
      }
    />
  );
}

function CompetitionResult({ item, query }: { item: SearchResultItem; query: string }) {
  const name = sanitizeText(item.title, 120);
  const country = countryOf(item);
  return (
    <CardShell
      item={item}
      query={query}
      type="competition"
      media={<EntityBadge item={item} name={name} />}
      meta={
        <span className="search-card__meta">
          {country ? <span className="search-card__subtle">{country}</span> : null}
        </span>
      }
    />
  );
}

function MatchResult({ item, query }: { item: SearchResultItem; query: string }) {
  const { scheduled_at, status, score, home_team, away_team } = item.metadata ?? {};
  const competition = item.description ? sanitizeText(item.description, 80) : null;
  const state = typeof status === 'string' ? sanitizeText(status, 40) : null;

  return (
    <CardShell
      item={item}
      query={query}
      type="match"
      media={<span className="search-card__badge" aria-hidden="true" />}
      meta={
        <span className="search-card__meta">
          {home_team && away_team ? (
            <span className="search-card__subtle">
              {sanitizeText(home_team.name, 60)} v {sanitizeText(away_team.name, 60)}
            </span>
          ) : null}
          {competition ? <span className="search-card__subtle">{competition}</span> : null}
        </span>
      }
      trailing={
        state ? (
          <span className="search-card__state">
            <MatchStatus status={state} label={state.replace(/_/g, ' ')} />
          </span>
        ) : null
      }
      aside={
        <>
          {score ? <span className="search-card__score">{sanitizeText(score, 20)}</span> : null}
          {scheduled_at ? <DateTimeDisplay iso={scheduled_at} timeZone="UTC" /> : null}
        </>
      }
    />
  );
}

const NEWS_TYPE_LABELS: Record<string, string> = {
  transfer_news: 'Transfer news',
  match_report: 'Match report',
  analysis: 'Analysis',
  preview: 'Preview',
  breaking_news: 'Breaking news',
  injury_news: 'Injury news',
};

function NewsResult({ item, query }: { item: SearchResultItem; query: string }) {
  const title = sanitizeText(item.title, 200);
  const { article_type, published_at } = item.metadata ?? {};
  const typeLabel =
    typeof article_type === 'string'
      ? (NEWS_TYPE_LABELS[article_type] ?? sanitizeText(article_type.replace(/_/g, ' '), 60))
      : null;
  const excerpt = item.description ? sanitizeText(item.description, 160) : null;

  return (
    <CardShell
      item={item}
      query={query}
      type="news"
      media={<EntityBadge item={item} name={title} />}
      meta={
        <span className="search-card__meta">
          {typeLabel ? <span className="search-card__pill">{typeLabel}</span> : null}
          {excerpt ? <span className="search-card__excerpt">{excerpt}</span> : null}
        </span>
      }
      aside={published_at ? <DateTimeDisplay iso={published_at} timeZone="UTC" /> : null}
    />
  );
}

/** Dispatch to the card for this result's entity type. */
export function SearchResultCard({ item, query }: { item: SearchResultItem; query: string }) {
  switch (item.entity_type) {
    case 'team':
      return <TeamResult item={item} query={query} />;
    case 'player':
      return <PlayerResult item={item} query={query} />;
    case 'competition':
      return <CompetitionResult item={item} query={query} />;
    case 'match':
      return <MatchResult item={item} query={query} />;
    case 'news':
      return <NewsResult item={item} query={query} />;
    default:
      // An unknown entity type is never rendered speculatively.
      return null;
  }
}

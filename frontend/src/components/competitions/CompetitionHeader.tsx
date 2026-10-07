import { entityUrl, routeUrl } from '@/config/routes';
import {
  competitionHref,
  viewLabel,
  type CompetitionRecord,
  type CompetitionView,
  type Country,
  type Season,
} from '@/lib/competitions';
import { sanitizeText } from '@/lib/validation';
import { CompetitionBadge, TeamBadge } from '@/components/domain/Badges';

const TYPE_LABELS: Record<string, string> = {
  league: 'League',
  cup: 'Cup',
  trophy: 'Trophy',
  playoff: 'Playoff',
  playoffs: 'Playoffs',
  group_stage: 'Group stage',
  super_league: 'Super league',
  championship: 'Championship',
};

/** Human label for a competition type, falling back to the raw value. */
export function competitionTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return TYPE_LABELS[type.toLowerCase()] ?? sanitizeText(type);
}

function regionLine(country: Country | null): string | null {
  return country ? sanitizeText(country.name) : null;
}

interface CompetitionHeaderProps {
  competition: CompetitionRecord;
  country: Country | null;
  season: Season | null;
}

/**
 * Competition identity block. The current season is stated explicitly, and
 * there is no description field in the public contract — none is invented.
 */
export function CompetitionHeader({ competition, country, season }: CompetitionHeaderProps) {
  const type = competitionTypeLabel(competition.type);
  const region = regionLine(country);

  return (
    <header className="competition-header">
      <div className="competition-header__identity">
        <CompetitionBadge name={competition.name} logoUrl={competition.logo_url} size={72} eager />
        <div>
          <h1 className="competition-header__name" id="competition-heading">
            {sanitizeText(competition.name)}
          </h1>
          <p className="competition-header__meta">
            {competition.short_name ? <span className="competition-header__short">{sanitizeText(competition.short_name)}</span> : null}
            {type ? <span>{sanitizeText(type)}</span> : null}
            {region ? <span>{region}</span> : null}
            {competition.gender ? <span>{sanitizeText(competition.gender)}</span> : null}
          </p>
        </div>
      </div>

      {season ? (
        <p className="competition-header__season">
          <span className="competition-header__season-label">Season</span>{' '}
          <span className="competition-header__season-name">{sanitizeText(season.name)}</span>
          {season.is_current ? <span className="competition-header__season-current">Current season</span> : null}
          {season.start_date || season.end_date ? (
            <span className="competition-header__season-dates">
              {season.start_date ? sanitizeText(season.start_date) : '—'}
              {' – '}
              {season.end_date ? sanitizeText(season.end_date) : '—'}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="competition-header__season">No season has been recorded for this competition yet.</p>
      )}
    </header>
  );
}

interface SeasonSelectorProps {
  slug: string;
  seasons: Season[];
  selected: Season | null;
  view: CompetitionView;
}

/**
 * Season switcher. A labelled GET form so it works without JavaScript; every
 * option targets the same canonical competition URL.
 */
export function SeasonSelector({ slug, seasons, selected, view }: SeasonSelectorProps) {
  if (seasons.length === 0) return null;
  return (
    <form className="season-selector" method="get" action={routeUrl('competitionDetail', { slug })}>
      {view !== 'overview' ? <input type="hidden" name="view" value={view} /> : null}
      <p className="season-selector__field">
        <label htmlFor="competition-season">Season</label>
        <select id="competition-season" name="season" defaultValue={selected?.id ?? ''}>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {sanitizeText(season.name)}
              {season.is_current ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </p>
      <button type="submit">View season</button>
    </form>
  );
}

interface CompetitionNavProps {
  slug: string;
  view: CompetitionView;
  seasonId: string | null;
  views: readonly CompetitionView[];
}

const VIEW_ORDER: CompetitionView[] = ['overview', 'matches', 'standings', 'teams', 'news'];

/** Section navigation that preserves the selected season. */
export function CompetitionNav({ slug, view, seasonId, views }: CompetitionNavProps) {
  const available = VIEW_ORDER.filter((candidate) => views.includes(candidate));
  if (available.length < 2) return null;
  return (
    <nav className="competition-nav" aria-label="Competition sections">
      <ul>
        {available.map((candidate) => (
          <li key={candidate}>
            <a
              href={competitionHref(slug, { view: candidate, seasonId })}
              aria-current={candidate === view ? 'page' : undefined}
            >
              {viewLabel(candidate)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface CompetitionCardProps {
  competition: CompetitionRecord;
  eagerLogo?: boolean;
}

/** Listing card: canonical link, logo, region and type only when known. */
export function CompetitionCard({ competition, eagerLogo = false }: CompetitionCardProps) {
  const type = competitionTypeLabel(competition.type);
  const region = competition.country ? sanitizeText(competition.country.name) : null;
  return (
    <article className="competition-card" aria-labelledby={`competition-${competition.slug}`}>
      <a className="competition-card__link" href={entityUrl('competition', competition.slug)}>
        <TeamBadge name={competition.name} logoUrl={competition.logo_url} size={48} eager={eagerLogo} />
        <span className="competition-card__name" id={`competition-${competition.slug}`}>
          {sanitizeText(competition.name)}
        </span>
      </a>
      <p className="competition-card__meta">
        {competition.short_name ? <span className="competition-card__short">{sanitizeText(competition.short_name)}</span> : null}
        {type ? <span>{type}</span> : null}
        {region ? <span>{region}</span> : null}
      </p>
    </article>
  );
}

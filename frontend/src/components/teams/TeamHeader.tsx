import { entityUrl } from '@/config/routes';
import { TeamBadge } from '@/components/domain/Badges';
import { sanitizeText } from '@/lib/validation';
import { TEAMS_CANONICAL, teamHref, type Country, type TeamRecord, type TeamView, type VenueRecord, viewLabel } from '@/lib/teams';

const VIEW_ORDER: TeamView[] = ['overview', 'matches', 'squad', 'competitions', 'news'];

interface TeamHeaderProps {
  team: TeamRecord;
  country: Country | null;
  venue: VenueRecord | null;
}

/**
 * Team identity. The external website is passed through the same-origin/host
 * validator as any other content URL, so a hostile record cannot inject a
 * `javascript:` link.
 */
export function TeamHeader({ team, country, venue }: TeamHeaderProps) {
  // An external link must survive the href validator, which only accepts
  // same-origin URLs, so it is validated for scheme separately and rendered
  // with rel="noopener noreferrer".
  const website = safeExternalUrl(team.website_url);

  return (
    <header className="team-header">
      <div className="team-header__identity">
        <TeamBadge name={team.name} logoUrl={team.logo_url} size={72} eager />
        <div>
          <h1 className="team-header__name" id="team-heading">
            {sanitizeText(team.name)}
          </h1>
          <p className="team-header__meta">
            {team.short_name ? <span className="team-header__short">{sanitizeText(team.short_name)}</span> : null}
            {country ? <span>{sanitizeText(country.name)}</span> : null}
            {team.founded_year ? <span>Founded {team.founded_year}</span> : null}
            {team.is_active ? <span className="team-header__active">Active</span> : null}
          </p>
        </div>
      </div>

      <dl className="team-header__facts">
        <div className="team-header__fact">
          <dt>Home venue</dt>
          <dd>
            {venue ? (
              <span>
                {sanitizeText(venue.name)}
                {venue.city ? `, ${sanitizeText(venue.city)}` : ''}
                {venue.capacity ? (
                  <span className="team-header__capacity"> · {venue.capacity.toLocaleString('en-GB')} capacity</span>
                ) : null}
              </span>
            ) : (
              'Not available'
            )}
          </dd>
        </div>
        <div className="team-header__fact">
          <dt>Official website</dt>
          <dd>
            {website ? (
              <a href={website} rel="noopener noreferrer nofollow" target="_blank">
                {sanitizeText(new URL(website).hostname)}<span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            ) : (
              'Not available'
            )}
          </dd>
        </div>
        <div className="team-header__fact">
          <dt>Team profile</dt>
          <dd>
            <a href={entityUrl('team', team.slug)}>{sanitizeText(team.name)}</a>
          </dd>
        </div>
      </dl>
    </header>
  );
}

/** http(s) only; a stored value is never trusted verbatim. */
function safeExternalUrl(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || /[\s<>"']/.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

interface TeamNavProps {
  slug: string;
  view: TeamView;
  seasonId: string | null;
}

/** Section navigation; every view stays on the one canonical team path. */
export function TeamNav({ slug, view, seasonId }: TeamNavProps) {
  return (
    <nav className="team-nav" aria-label="Team sections">
      <ul>
        {VIEW_ORDER.map((candidate) => (
          <li key={candidate}>
            <a href={teamHref(slug, { view: candidate, seasonId })} aria-current={candidate === view ? 'page' : undefined}>
              {viewLabel(candidate)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface TeamCardProps {
  team: TeamRecord;
  eagerLogo?: boolean;
}

/** Listing card: canonical link, logo, short name and country when known. */
export function TeamCard({ team, eagerLogo = false }: TeamCardProps) {
  const country = team.country ? sanitizeText(team.country.name) : null;
  return (
    <article className="team-card" aria-labelledby={`team-${team.slug}`}>
      <a className="team-card__link" href={entityUrl('team', team.slug)}>
        <TeamBadge name={team.name} logoUrl={team.logo_url} size={48} eager={eagerLogo} />
        <span className="team-card__name" id={`team-${team.slug}`}>
          {sanitizeText(team.name)}
        </span>
      </a>
      <p className="team-card__meta">
        {team.short_name ? <span className="team-card__short">{sanitizeText(team.short_name)}</span> : null}
        {country ? <span>{country}</span> : null}
        {team.founded_year ? <span>Founded {team.founded_year}</span> : null}
      </p>
    </article>
  );
}

interface TeamBreadcrumbFallbackProps {
  name: string;
}

/** Used when the SEO service is unavailable, so navigation never dead-ends. */
export function TeamBreadcrumbFallback({ name }: TeamBreadcrumbFallbackProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumb">
        <li>
          <a href={TEAMS_CANONICAL}>Teams</a>
        </li>
        <li>
          <span aria-current="page">{sanitizeText(name)}</span>
        </li>
      </ol>
    </nav>
  );
}

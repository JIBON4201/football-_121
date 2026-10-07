import { entityUrl } from '@/config/routes';
import { PlayerAvatar, TeamBadge } from '@/components/domain/Badges';
import { sanitizeText } from '@/lib/validation';
import { formatDate } from '@/lib/dates';
import {
  orderCareer,
  playerHref,
  PLAYERS_CANONICAL,
  type CareerEntry,
  type CompetitionRecord,
  type Country,
  type PlayerRecord,
  type PlayerSelection,
  type PlayerView,
  type Season,
  viewLabel,
} from '@/lib/players';

const VIEW_ORDER: PlayerView[] = ['overview', 'career', 'matches', 'statistics', 'news'];

/** Age is derived from the recorded date of birth, never estimated. */
function ageFrom(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function fullName(player: PlayerRecord): string {
  const parts = [player.first_name, player.last_name].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' ') : player.display_name;
}

interface PlayerHeaderProps {
  player: PlayerRecord;
  nationality: Country | null;
  currentTeam: CareerEntry | null;
}

/** Player identity, with every optional attribute omitted when unknown. */
export function PlayerHeader({ player, nationality, currentTeam }: PlayerHeaderProps) {
  const age = ageFrom(player.date_of_birth);
  return (
    <header className="player-header">
      <div className="player-header__identity">
        <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size={80} eager />
        <div>
          <h1 className="player-header__name" id="player-heading">
            {sanitizeText(player.display_name)}
          </h1>
          <p className="player-header__legal">
            {fullName(player) === player.display_name ? null : sanitizeText(fullName(player))}
          </p>
          <p className="player-header__meta">
            {player.position ? <span className="player-header__position">{sanitizeText(player.position)}</span> : null}
            {nationality ? <span>{sanitizeText(nationality.name)}</span> : null}
            {age !== null ? <span>Age {age}</span> : null}
            {currentTeam?.team ? (
              <a className="player-header__team" href={entityUrl('team', currentTeam.team.slug)}>
                {sanitizeText(currentTeam.team.name)}
              </a>
            ) : null}
          </p>
        </div>
      </div>

      <dl className="player-header__facts">
        <div className="player-header__fact">
          <dt>Date of birth</dt>
          <dd>{player.date_of_birth ? sanitizeText(formatDate(player.date_of_birth)) : 'Not public'}</dd>
        </div>
        <div className="player-header__fact">
          <dt>Preferred foot</dt>
          <dd>{player.preferred_foot ? sanitizeText(player.preferred_foot) : 'Not recorded'}</dd>
        </div>
        <div className="player-header__fact">
          <dt>Height</dt>
          <dd>
            {player.height_cm !== null ? `${player.height_cm.toLocaleString('en-GB')} cm` : 'Not recorded'}
          </dd>
        </div>
        <div className="player-header__fact">
          <dt>Shirt number</dt>
          <dd>
            {currentTeam && currentTeam.shirt_number !== null ? (
              <>
                {currentTeam.shirt_number}
                {currentTeam.team ? (
                  <span className="player-header__number-team">
                    {' '}
                    at <a href={entityUrl('team', currentTeam.team.slug)}>{sanitizeText(currentTeam.team.name)}</a>
                  </span>
                ) : null}
              </>
            ) : (
              'Not recorded'
            )}
          </dd>
        </div>
        <div className="player-header__fact">
          <dt>Status</dt>
          <dd>{player.status ? sanitizeText(player.status.replace(/_/g, ' ')) : 'Not recorded'}</dd>
        </div>
        <div className="player-header__fact">
          <dt>Profile</dt>
          <dd>
            <a href={entityUrl('player', player.slug)}>{sanitizeText(player.display_name)}</a>
          </dd>
        </div>
      </dl>
    </header>
  );
}

interface PlayerNavProps {
  slug: string;
  view: PlayerView;
  selection: PlayerSelection;
}

/** Section navigation that preserves the active season and competition. */
export function PlayerNav({ slug, view, selection }: PlayerNavProps) {
  return (
    <nav className="player-nav" aria-label="Player sections">
      <ul>
        {VIEW_ORDER.map((candidate) => (
          <li key={candidate}>
            <a
              href={playerHref(slug, { ...selection, view: candidate })}
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

interface PlayerCardProps {
  player: PlayerRecord;
  /** Resolved from the listing page so a card never needs its own request. */
  currentTeamName?: string | null;
  nationalityName?: string | null;
  eagerPhoto?: boolean;
}

/** Listing card: canonical link, photo, name, position and current team. */
export function PlayerCard({ player, currentTeamName, nationalityName, eagerPhoto = false }: PlayerCardProps) {
  return (
    <article className="player-card" aria-labelledby={`player-${player.slug}`}>
      <a className="player-card__link" href={entityUrl('player', player.slug)}>
        <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size={48} eager={eagerPhoto} />
        <span className="player-card__name" id={`player-${player.slug}`}>
          {sanitizeText(player.display_name)}
        </span>
      </a>
      <p className="player-card__meta">
        {player.position ? <span className="player-card__position">{sanitizeText(player.position)}</span> : null}
        {currentTeamName ? <span>{sanitizeText(currentTeamName)}</span> : null}
        {nationalityName ? <span>{sanitizeText(nationalityName)}</span> : null}
      </p>
    </article>
  );
}

interface CurrentTeamCardProps {
  entry: CareerEntry;
}

/** The player's current club, linked to its canonical team page. */
export function CurrentTeamCard({ entry }: CurrentTeamCardProps) {
  const team = entry.team;
  if (!team) return null;
  return (
    <section className="player-current-team" aria-labelledby="player-current-team-heading">
      <h2 id="player-current-team-heading">Current team</h2>
      <a className="player-current-team__link" href={entityUrl('team', team.slug)}>
        <TeamBadge name={team.name} logoUrl={team.logo_url} size={48} />
        <span className="player-current-team__name">{sanitizeText(team.name)}</span>
      </a>
      <p className="player-current-team__meta">
        <span className="player-current-team__badge">Current</span>
        {entry.shirt_number !== null ? <span>Shirt {entry.shirt_number}</span> : null}
        {entry.season ? <span>{sanitizeText(entry.season.name)}</span> : null}
      </p>
    </section>
  );
}

interface CareerHistoryProps {
  history: CareerEntry[];
  status: 'ready' | 'empty' | 'error';
  headingLevel?: 2 | 3;
  id?: string;
}

function formatSpan(entry: CareerEntry): string {
  const joined = entry.joined_at ? formatDate(entry.joined_at) : null;
  const left = entry.left_at ? formatDate(entry.left_at) : null;
  if (joined && left) return `${joined} – ${left}`;
  if (joined) return `Joined ${joined}`;
  if (left) return `Left ${left}`;
  return 'Dates not recorded';
}

/**
 * Career spells in chronological order. A row missing dates still appears, at
 * the end, and says so — it is never dropped or placed speculatively.
 */
export function CareerHistory({ history, status, headingLevel = 2, id = 'career' }: CareerHistoryProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  if (status === 'error') {
    return (
      <section className="career" aria-labelledby={`${id}-heading`} id={id}>
        <Heading id={`${id}-heading`}>Career</Heading>
        <div role="alert">
          <p>Career history is temporarily unavailable. Please try again shortly.</p>
        </div>
      </section>
    );
  }

  const ordered = orderCareer(history);
  if (ordered.length === 0) {
    return (
      <section className="career" aria-labelledby={`${id}-heading`} id={id}>
        <Heading id={`${id}-heading`}>Career</Heading>
        <p>No team history has been recorded for this player yet.</p>
      </section>
    );
  }

  return (
    <section className="career" aria-labelledby={`${id}-heading`} id={id}>
      <Heading id={`${id}-heading`}>Career</Heading>
      <ol className="career__list">
        {ordered.map((entry) => (
          <li className={entry.is_current ? 'career__entry career__entry--current' : 'career__entry'} key={entry.id}>
            <div className="career__team">
              {entry.team ? (
                <a href={entityUrl('team', entry.team.slug)}>{sanitizeText(entry.team.name)}</a>
              ) : (
                <span className="career__team-unknown">Team not identified</span>
              )}
              {entry.is_current ? <span className="career__badge">Current</span> : null}
            </div>
            <p className="career__meta">
              {entry.season ? <span>{sanitizeText(entry.season.name)}</span> : <span>Season not recorded</span>}
              {entry.shirt_number !== null ? <span>Shirt {entry.shirt_number}</span> : null}
            </p>
            <p className="career__span">{formatSpan(entry)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface CareerCompetitionsProps {
  entries: Array<{ competition: CompetitionRecord; seasons: Season[] }>;
  status: 'ready' | 'empty' | 'error';
  headingLevel?: 2 | 3;
  id?: string;
}

/**
 * Competitions reached through the seasons on the career rows. A competition
 * is never listed on the strength of an appearance alone.
 */
export function CareerCompetitionsList({
  entries,
  status,
  headingLevel = 2,
  id = 'career-competitions',
}: CareerCompetitionsProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  if (status === 'error') {
    return (
      <section className="career-competitions" aria-labelledby={`${id}-heading`} id={id}>
        <Heading id={`${id}-heading`}>Competitions</Heading>
        <div role="alert">
          <p>Competition history is temporarily unavailable.</p>
        </div>
      </section>
    );
  }
  if (entries.length === 0) {
    return (
      <section className="career-competitions" aria-labelledby={`${id}-heading`} id={id}>
        <Heading id={`${id}-heading`}>Competitions</Heading>
        <p>No competition history has been recorded for this player yet.</p>
      </section>
    );
  }
  return (
    <section className="career-competitions" aria-labelledby={`${id}-heading`} id={id}>
      <Heading id={`${id}-heading`}>Competitions</Heading>
      <ul className="career-competitions__list">
        {entries.map(({ competition, seasons }) => (
          <li key={competition.id}>
            <a href={entityUrl('competition', competition.slug)}>{sanitizeText(competition.name)}</a>
            <ul className="career-competitions__seasons">
              {seasons.map((season) => (
                <li key={season.id}>
                  {sanitizeText(season.name)}
                  {season.is_current ? <span className="career-competitions__current"> · current</span> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface PlayerBreadcrumbFallbackProps {
  name: string;
}

/** Used when the SEO service is unavailable, so navigation never dead-ends. */
export function PlayerBreadcrumbFallback({ name }: PlayerBreadcrumbFallbackProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol>
        <li>
          <a href={PLAYERS_CANONICAL}>Players</a>
        </li>
        <li>
          <span aria-current="page">{sanitizeText(name)}</span>
        </li>
      </ol>
    </nav>
  );
}

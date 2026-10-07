import { entityUrl } from '@/config/routes';
import { trackAttributes } from '@/lib/analytics';
import { loadCompetitions, loadPlayers, loadTeams } from '@/lib/homepage';
import { CompetitionBadge, PlayerAvatar, TeamBadge } from '@/components/domain/Badges';
import { sanitizeText } from '@/lib/validation';
import { HomeSectionSkeleton, SectionShell } from '@/components/home/SectionShell';
import type { Competition, Player, Team } from '@/types/api';

/** Competition rows carry no image slot; the badge renders beside the card. */
export function PopularCompetitionsWithBadges({ competitions }: { competitions: Competition[] }) {
  return (
    <ul className="grid-cards" aria-label="Popular competitions">
      {competitions.map((competition) => (
        <li key={competition.id}>
          <article className="popular-card" aria-label={sanitizeText(competition.name)}>
            <CompetitionBadge name={competition.name} logoUrl={competition.logo_url} size={48} />
            <a href={entityUrl('competition', competition.slug)} {...trackAttributes('competition', competition.id)}>
              <h3>{sanitizeText(competition.name)}</h3>
            </a>
            {competition.short_name ? <p>{sanitizeText(competition.short_name)}</p> : null}
          </article>
        </li>
      ))}
    </ul>
  );
}

export async function PopularCompetitionsSection() {
  const section = await loadCompetitions().catch(() => ({ status: 'error' as const, items: [] }));
  return (
    <SectionShell
      id="home-competitions-heading"
      title="Popular Competitions"
      href="/competitions"
      status={section.status}
      emptyTitle="No competitions"
      emptyDescription="Active competitions will appear here."
    >
      <PopularCompetitionsWithBadges competitions={section.items} />
    </SectionShell>
  );
}

export function PopularTeamsView({ teams }: { teams: Team[] }) {
  return (
    <ul className="grid-cards" aria-label="Popular teams">
      {teams.map((team) => (
        <li key={team.id}>
          <article className="popular-card" aria-label={sanitizeText(team.name)}>
            <TeamBadge name={team.name} logoUrl={team.logo_url} size={48} />
            <a href={entityUrl('team', team.slug)} {...trackAttributes('team', team.id)}>
              <h3>{sanitizeText(team.name)}</h3>
            </a>
            {team.short_name ? <p>{sanitizeText(team.short_name)}</p> : null}
          </article>
        </li>
      ))}
    </ul>
  );
}

export async function PopularTeamsSection() {
  const section = await loadTeams().catch(() => ({ status: 'error' as const, items: [] }));
  return (
    <SectionShell
      id="home-teams-heading"
      title="Popular Teams"
      href="/teams"
      status={section.status}
      emptyTitle="No teams"
      emptyDescription="Featured teams will appear here."
    >
      <PopularTeamsView teams={section.items} />
    </SectionShell>
  );
}

export function PopularPlayersView({ players }: { players: Player[] }) {
  return (
    <ul className="grid-cards" aria-label="Popular players">
      {players.map((player) => (
        <li key={player.id}>
          <article className="popular-card" aria-label={sanitizeText(player.display_name)}>
            <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size={48} />
            <a href={entityUrl('player', player.slug)} {...trackAttributes('player', player.id)}>
              <h3>{sanitizeText(player.display_name)}</h3>
            </a>
            {player.position ? <p>{sanitizeText(player.position)}</p> : null}
          </article>
        </li>
      ))}
    </ul>
  );
}

export async function PopularPlayersSection() {
  const section = await loadPlayers().catch(() => ({ status: 'error' as const, items: [] }));
  return (
    <SectionShell
      id="home-players-heading"
      title="Popular Players"
      href="/players"
      status={section.status}
      emptyTitle="No players"
      emptyDescription="Featured players will appear here."
    >
      <PopularPlayersView players={section.items} />
    </SectionShell>
  );
}

export function PopularSectionsSkeleton() {
  return <HomeSectionSkeleton label="Loading entities" />;
}

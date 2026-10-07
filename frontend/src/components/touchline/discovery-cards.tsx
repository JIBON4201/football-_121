/* Native responsive images are used so the existing media URLs can provide srcSet without requiring a next.config remote-host change. */
import type { CSSProperties } from "react";
import type { CompetitionRef, PlayerProfile, TeamProfile } from "@/lib/touchline/homepage-types";
import { Icon } from "./icons";
import { TeamCrest } from "./match-cards";

export function CompetitionCard({ competition }: { competition: CompetitionRef }) {
  return (
    <a className="competition-card" href={competition.href}>
      <span className="competition-card__mark" style={{ "--competition-accent": competition.accent ?? "#526d5b" } as CSSProperties} aria-hidden="true">
        {competition.logoUrl ? <img src={competition.logoUrl} alt="" loading="lazy" decoding="async" /> : <span>{competition.abbreviation.slice(0, 3)}</span>}
      </span>
      <span className="competition-card__copy"><strong>{competition.name}</strong><small>{competition.region}{competition.type ? ` · ${competition.type}` : ""}</small></span>
      <Icon name="arrow-up-right" size={16} />
    </a>
  );
}

export function TeamCard({ team }: { team: TeamProfile }) {
  return (
    <a className="team-card" href={team.href}>
      <span className="team-card__crest"><TeamCrest team={team} size="lg" /></span>
      <span className="team-card__copy"><strong>{team.name}</strong><small>{team.country ?? "Club profile"}{team.competitionName ? ` · ${team.competitionName}` : ""}</small></span>
      <Icon name="arrow-up-right" size={15} />
    </a>
  );
}

export function PlayerCard({ player }: { player: PlayerProfile }) {
  return (
    <article className="player-card">
      <a className="player-card__image media-frame" href={player.href} aria-label={`View ${player.name}'s player profile`}>
        {player.image ? <img src={player.image.src} srcSet={player.image.srcSet} sizes="(max-width: 680px) 44vw, (max-width: 1024px) 22vw, 16vw" alt={player.image.alt} loading="lazy" decoding="async" /> : <span className="player-card__fallback" aria-hidden="true">{player.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>}
        <span className="player-card__open"><Icon name="arrow-up-right" size={15} /></span>
      </a>
      <div className="player-card__body"><h3><a href={player.href}>{player.name}</a></h3><p>{player.teamName ? `${player.teamName} · ${player.position}` : player.position}</p>{player.country ? <div className="player-card__meta"><span>{player.country}</span></div> : null}</div>
    </article>
  );
}

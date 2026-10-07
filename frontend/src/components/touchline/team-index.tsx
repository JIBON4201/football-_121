import type { CSSProperties } from "react";
import type { TeamDirectory, TeamEntry } from "@/lib/touchline/directory-data";
import { DirectoryEmpty } from "./index-shell";
import { Icon } from "./icons";

function ClubCrest({ team }: { team: TeamEntry }) {
  return (
    <span className="cl-crest" style={{ "--cl-accent": team.accent ?? "#2c3d30" } as CSSProperties}>
      {team.logoUrl ? <img src={team.logoUrl} alt="" loading="lazy" decoding="async" /> : <span>{team.abbreviation.slice(0, 3)}</span>}
    </span>
  );
}

function ClubRow({ team }: { team: TeamEntry }) {
  return (
    <li className="cl-row">
      <a className="cl-row__link" href={team.href}>
        <ClubCrest team={team} />
        <span className="cl-row__identity">
          <span className="cl-row__name">{team.name}</span>
          <span className="cl-row__country">
            {team.countryLabel}
            {team.coverage.live > 0 && (
              <span className="cl-row__live"><span className="live-dot" aria-hidden="true" />Live now</span>
            )}
          </span>
        </span>
        <span className="cl-row__competition">{team.competition?.name ?? ""}</span>
        <span className="cl-row__go" aria-hidden="true"><Icon name="arrow-up-right" size={17} /></span>
      </a>
    </li>
  );
}

/**
 * Focused club list ordered by current coverage activity (live first, then
 * most fixtures tracked), so the most-followed clubs lead. No search or
 * filters — every row carries logo, name, country and competition.
 */
export function TeamIndex({ directory }: { directory: TeamDirectory }) {
  if (directory.entries.length === 0) {
    return <DirectoryEmpty title="No clubs" description="Check back soon." />;
  }
  const ordered = [...directory.entries].sort(
    (a, b) => b.activity - a.activity || a.name.localeCompare(b.name),
  );
  return (
    <ul className="cl-rows">
      {ordered.map((team) => (
        <ClubRow team={team} key={team.id} />
      ))}
    </ul>
  );
}

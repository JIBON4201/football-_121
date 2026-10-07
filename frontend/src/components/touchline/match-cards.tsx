/* Native responsive images are used so the existing media URLs can provide srcSet without requiring a next.config remote-host change. */
import { Fragment, type CSSProperties } from "react";
import type { CompetitionRef, FootballMatch, MatchEventSummary, TeamRef } from "@/lib/touchline/homepage-types";

export function TeamCrest({ team, size = "md" }: { team: TeamRef; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`team-crest team-crest--${size}`} style={{ "--team-accent": team.accent ?? "#dfe5dc" } as CSSProperties}>
      {team.logoUrl ? <img src={team.logoUrl} alt={`${team.name} crest`} loading="lazy" decoding="async" /> : <span aria-hidden="true">{team.abbreviation.slice(0, 3)}</span>}
    </span>
  );
}

export function CompetitionLine({ competition }: { competition: Pick<CompetitionRef, "name" | "abbreviation" | "accent" | "logoUrl"> }) {
  return (
    <div className="competition-line">
      <span className="competition-line__mark" style={{ "--competition-accent": competition.accent ?? "#526d5b" } as CSSProperties} aria-hidden="true">
        {competition.logoUrl ? <img src={competition.logoUrl} alt="" loading="lazy" /> : competition.abbreviation.slice(0, 3)}
      </span>
      <span>{competition.name}</span>
    </div>
  );
}

/** A short label for one event: the minute, the side that owns it, and a card mark. */
function eventLabel(event: MatchEventSummary, match: FootballMatch): string {
  const side = event.side === "home" ? match.homeTeam.abbreviation : event.side === "away" ? match.awayTeam.abbreviation : "";
  const card = event.type === "yellow_card" ? " Y" : event.type === "red_card" ? " R" : "";
  return `${event.minute ?? ""}${side ? ` ${side}` : ""}${card}`.trim();
}

/**
 * Goals and cards for a completed match, as the design system's inline meta row.
 *
 * Only ever rendered on the white result-card surface: `.meta-line` is coloured
 * with `--color-faint`, which has no contrast against the dark live panel, so the
 * live card carries its minute and score instead. The full timeline, including
 * substitutions and VAR, is on the match report the card links to.
 */
function MatchEventLine({ match }: { match: FootballMatch }) {
  const events = match.events;
  if (!events?.length) return null;
  return (
    <p className="meta-line">
      <span className="sr-only">Key events: </span>
      {events.map((event, index) => (
        <Fragment key={`${event.type}-${event.minute ?? "x"}-${index}`}>
          {index > 0 ? <span className="meta-separator" aria-hidden="true">·</span> : null}
          <span>{eventLabel(event, match)}</span>
        </Fragment>
      ))}
    </p>
  );
}

export function LiveMatchCard({ match }: { match: FootballMatch }) {
  return (
    <article className="match-card live-match-card">
      <div className="match-card__top"><CompetitionLine competition={match.competition} /><span className="match-status"><span className="live-dot" aria-hidden="true" />{match.minute ?? match.statusLabel ?? "LIVE"}</span></div>
      <a className="match-card__scoreline" href={match.href} aria-label={`${match.homeTeam.name} ${match.homeScore ?? "–"}, ${match.awayTeam.name} ${match.awayScore ?? "–"}; ${match.minute ?? match.statusLabel ?? "live"}`}>
        <span className="match-team match-team--home"><TeamCrest team={match.homeTeam} /><span>{match.homeTeam.shortName}</span></span>
        <span className="score-block"><strong>{match.homeScore ?? "–"}</strong><span className="score-divider">–</span><strong>{match.awayScore ?? "–"}</strong></span>
        <span className="match-team match-team--away"><span>{match.awayTeam.shortName}</span><TeamCrest team={match.awayTeam} /></span>
      </a>
    </article>
  );
}

function formatKickoff(kickoffAt: string, timeZone = "UTC") {
  const date = new Date(kickoffAt);
  if (Number.isNaN(date.getTime())) return { date: "TBC", time: "–:–" };
  return {
    date: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(date),
    time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date),
  };
}

export function UpcomingMatchCard({ match, hideDate = false }: { match: FootballMatch; hideDate?: boolean }) {
  const kickoff = match.kickoffAt ? formatKickoff(match.kickoffAt, match.timeZone ?? "UTC") : { date: "TBC", time: "TBC" };
  return (
    <article className="match-card upcoming-match-card">
      <div className="upcoming-match-card__top"><CompetitionLine competition={match.competition} />{!hideDate && <span className="fixture-date">{kickoff.date}</span>}</div>
      <a className="fixture-teams" href={match.href} aria-label={`${match.homeTeam.name} versus ${match.awayTeam.name}, ${kickoff.date} ${kickoff.time}`}>
        <span className="fixture-team"><TeamCrest team={match.homeTeam} size="md" /><span>{match.homeTeam.shortName}</span></span>
        <span className="fixture-kickoff"><strong>{kickoff.time}</strong><small>{match.timeZoneLabel ?? "UTC"}</small></span>
        <span className="fixture-team fixture-team--away"><span>{match.awayTeam.shortName}</span><TeamCrest team={match.awayTeam} size="md" /></span>
      </a>
    </article>
  );
}


export function ResultMatchCard({ match, hideDate = false }: { match: FootballMatch; hideDate?: boolean }) {
  const date = match.kickoffAt ? new Date(match.kickoffAt) : null;
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: match.timeZone ?? "UTC" }).format(date)
    : "FT";
  return (
    <article className="result-match-card">
      <div className="result-match-card__competition"><CompetitionLine competition={match.competition} />{!hideDate && <span>{dateLabel} · FT</span>}</div>
      <a className="result-match-card__teams" href={match.href} aria-label={`${match.homeTeam.name} ${match.homeScore ?? "–"}, ${match.awayTeam.name} ${match.awayScore ?? "–"}, full time`}>
        <span className="result-match-card__team"><TeamCrest team={match.homeTeam} /><span>{match.homeTeam.shortName}</span></span>
        <span className="result-match-card__score"><strong>{match.homeScore ?? "–"}</strong><span>–</span><strong>{match.awayScore ?? "–"}</strong></span>
        <span className="result-match-card__team result-match-card__team--away"><span>{match.awayTeam.shortName}</span><TeamCrest team={match.awayTeam} /></span>
      </a>
      <MatchEventLine match={match} />
    </article>
  );
}

type MatchDayGroup = { key: string; label: string; sortValue: number; matches: FootballMatch[] };

function matchDay(match: FootballMatch): { key: string; label: string; sortValue: number } {
  if (!match.kickoffAt) return { key: "date-tbc", label: "Date to be confirmed", sortValue: Number.MAX_SAFE_INTEGER };
  const date = new Date(match.kickoffAt);
  if (Number.isNaN(date.getTime())) return { key: "date-tbc", label: "Date to be confirmed", sortValue: Number.MAX_SAFE_INTEGER };
  const zone = match.timeZone ?? "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  const key = `${get("year")}-${get("month")}-${get("day")}`;
  const label = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(date);
  return { key, label, sortValue: date.getTime() };
}

/** Groups fixture/result cards by match date without changing the API's match shape. */
export function MatchDayGroups({ matches, kind }: { matches: FootballMatch[]; kind: "upcoming" | "results" }) {
  const map = new Map<string, MatchDayGroup>();
  for (const match of matches) {
    const day = matchDay(match);
    const current = map.get(day.key);
    if (current) {
      current.matches.push(match);
      if (day.key !== "date-tbc") current.sortValue = kind === "upcoming" ? Math.min(current.sortValue, day.sortValue) : Math.max(current.sortValue, day.sortValue);
    }
    else map.set(day.key, { ...day, matches: [match] });
  }
  const groups = [...map.values()].sort((a, b) => {
    if (a.key === "date-tbc") return 1;
    if (b.key === "date-tbc") return -1;
    return kind === "upcoming" ? a.sortValue - b.sortValue : b.sortValue - a.sortValue;
  });

  return (
    <div className={`match-day-groups match-day-groups--${kind}`}>
      {groups.map((group) => (
        <section className="match-day-group" key={group.key} aria-labelledby={`match-day-${kind}-${group.key}`}>
          <header className="match-day-group__heading">
            <h3 id={`match-day-${kind}-${group.key}`}>{group.label}</h3>
            <span>{group.matches.length} {group.matches.length === 1 ? "match" : "matches"}</span>
          </header>
          <div className={kind === "upcoming" ? "upcoming-grid" : "result-match-grid"}>
            {group.matches.slice().sort((a, b) => {
              const aTime = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.MAX_SAFE_INTEGER;
              const bTime = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.MAX_SAFE_INTEGER;
              const safeATime = Number.isNaN(aTime) ? Number.MAX_SAFE_INTEGER : aTime;
              const safeBTime = Number.isNaN(bTime) ? Number.MAX_SAFE_INTEGER : bTime;
              return kind === "upcoming" ? safeATime - safeBTime : safeBTime - safeATime;
            }).map((match) => kind === "upcoming"
              ? <UpcomingMatchCard match={match} hideDate key={match.id} />
              : <ResultMatchCard match={match} hideDate key={match.id} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

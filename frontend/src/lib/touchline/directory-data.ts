/**
 * Presentation-layer derivations for the Transfers, Competitions and Teams directories.
 *
 * These helpers only reshape records that the existing providers already return
 * (`getHomepageData()` / `getFootballSiteData()`). No endpoint, database shape or
 * API contract is changed, and nothing is invented: every derived value is either
 * copied from an existing field or counted from records that are present.
 */
import type { CompetitionRef, FootballMatch, TeamProfile } from "./homepage-types";

/** Regions that describe a confederation or the world rather than a single country. */
const INTERNATIONAL_REGIONS = new Set([
  "world", "global", "international", "internationals",
  "europe", "uefa", "uefa europa", "uefa europa league", "uefa champions league",
  "south america", "conmebol", "concacaf", "north america", "central america",
  "asia", "afc", "africa", "caf", "oceania", "ofc",
]);

/**
 * A competition as it appears either in the competition feed (full record) or
 * attached to a match (a reduced reference). Both are read through this shape.
 */
export type CompetitionSource = Pick<CompetitionRef, "id" | "name" | "abbreviation" | "logoUrl" | "accent">
  & Partial<Pick<CompetitionRef, "region" | "type" | "teamIds" | "standings" | "href">>;

export type CompetitionGroup = "international" | "domestic" | "cup" | "other";

export type CompetitionGroupLabel = {
  id: CompetitionGroup;
  eyebrow: string;
  title: string;
  description: string;
};

/** Ordered definitions for the competition directory groupings. */
export const COMPETITION_GROUPS: CompetitionGroupLabel[] = [
  {
    id: "international",
    eyebrow: "Continental & world",
    title: "International competitions",
    description: "Tournaments contested across more than one country, from continental club competitions to national-team tournaments.",
  },
  {
    id: "domestic",
    eyebrow: "League seasons",
    title: "Domestic leagues",
    description: "The club competitions that decide a season inside a single country.",
  },
  {
    id: "cup",
    eyebrow: "Knockout football",
    title: "Cups & knockout competitions",
    description: "Single-match and elimination competitions, domestic and international.",
  },
];

export interface CompetitionCoverage {
  /** Fixtures returned by the existing match feed for this competition. */
  fixtures: number;
  live: number;
  upcoming: number;
  results: number;
  /** True when the competition API has returned a standings table. */
  hasStandings: boolean;
  /** Clubs the competition API associates with the competition. */
  clubs: number;
}

/**
 * Classifies a competition from its own optional `type`/`region` fields.
 * Countries are never guessed: an unknown competition is only placed in a group
 * when its own record says so, otherwise it falls through to "other".
 */
export function competitionGroup(competition: CompetitionSource): CompetitionGroup {
  const type = (competition.type ?? "").toLowerCase();
  const region = (competition.region ?? "").toLowerCase();
  if (/international|continental|world|fifa|uefa/.test(type) || INTERNATIONAL_REGIONS.has(region)) return "international";
  if (/cup|trophy|knockout|play-?off/.test(type)) return "cup";
  if (/league|division|championship|liga|bundesliga|ligue|serie a|primeira|eredivisie/.test(type)) return "domestic";
  return "other";
}

/** Counts the coverage already available in the existing feeds. */
export function competitionCoverage(competition: CompetitionSource, matches: FootballMatch[]): CompetitionCoverage {
  const related = matches.filter((match) => match.competition.id === competition.id);
  return {
    fixtures: related.length,
    live: related.filter((match) => match.status === "live").length,
    upcoming: related.filter((match) => match.status === "scheduled").length,
    results: related.filter((match) => match.status === "finished").length,
    hasStandings: Boolean(competition.standings?.length),
    clubs: competition.teamIds?.length ?? 0,
  };
}

/** Ranks competitions by how much coverage already exists for them. */
export function competitionRank(competition: CompetitionSource, matches: FootballMatch[]): number {
  const coverage = competitionCoverage(competition, matches);
  return coverage.live * 100 + coverage.fixtures * 10 + (coverage.hasStandings ? 5 : 0) + Math.min(coverage.clubs, 4);
}

export interface CompetitionEntry extends CompetitionRef {
  group: CompetitionGroup;
  coverage: CompetitionCoverage;
  rank: number;
}

export interface CompetitionDirectory {
  entries: CompetitionEntry[];
  /** Section ids in render order, used by the page's jump navigation. */
  sections: { id: string; label: string; count: number }[];
  regions: { name: string; count: number; ids: string[] }[];
  totals: { competitions: number; regions: number; formats: number; fixtures: number; countries: number };
}

export function buildCompetitionDirectory(competitions: CompetitionRef[], matches: FootballMatch[]): CompetitionDirectory {
  const entries: CompetitionEntry[] = competitions.map((competition) => {
    const coverage = competitionCoverage(competition, matches);
    return { ...competition, group: competitionGroup(competition), coverage, rank: competitionRank(competition, matches) };
  });
  const rankDescending = (a: CompetitionEntry, b: CompetitionEntry) => b.rank - a.rank || a.name.localeCompare(b.name);

  const popular = entries.filter((entry) => entry.rank > 0).slice().sort(rankDescending);
  const sections = [
    ...(popular.length > 1 ? [{ id: "popular", label: "Most followed", count: popular.length }] : []),
    ...COMPETITION_GROUPS
      .map((group) => ({
        id: group.id,
        label: group.title,
        count: entries.filter((entry) => entry.group === group.id).length,
      }))
      .filter((section) => section.count > 0),
  ];

  const regionMap = new Map<string, { name: string; ids: string[] }>();
  for (const entry of entries) {
    const name = entry.region?.trim() || "Unassigned region";
    const bucket = regionMap.get(name) ?? { name, ids: [] };
    bucket.ids.push(entry.id);
    regionMap.set(name, bucket);
  }

  return {
    entries,
    sections,
    regions: [...regionMap.values()]
      .map((bucket) => ({ ...bucket, count: bucket.ids.length }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    totals: {
      competitions: entries.length,
      regions: regionMap.size,
      countries: entries.filter((entry) => entry.group !== "international").length,
      formats: new Set(entries.map((entry) => entry.type).filter(Boolean)).size,
      fixtures: entries.reduce((total, entry) => total + entry.coverage.fixtures, 0),
    },
  };
}

export interface TeamCoverage {
  live: number;
  upcoming: number;
  results: number;
  fixtures: number;
  /** The next scheduled kick-off for this club, as an ISO string when known. */
  nextKickoffAt?: string;
  nextCompetitionId?: string;
}

/** The competition identity a club row needs, resolved without inventing a link. */
export interface CompetitionSummary {
  id: string;
  name: string;
  abbreviation: string;
  logoUrl?: string;
  accent?: string;
  /** Only present when the feed supplied a real competition page. */
  href?: string;
}

/**
 * Resolves the competition a club belongs to. `competitionName` from the team API
 * wins; otherwise the club is attributed to the competition its fixtures are
 * reported under. Returns undefined when the feeds provide neither.
 */
export function resolveTeamCompetition(team: TeamProfile, matches: FootballMatch[]): CompetitionSummary | undefined {
  if (team.competitionName) {
    return {
      id: team.id,
      name: team.competitionName,
      abbreviation: team.competitionName.slice(0, 3).toUpperCase(),
    };
  }
  const related = matches.filter((match) => match.homeTeam.id === team.id || match.awayTeam.id === team.id);
  const named: CompetitionSource[] = related.map((match) => match.competition).filter((competition, index, list) => list.findIndex((item) => item.id === competition.id) === index);
  if (named.length === 1) return named[0];
  const hasStandings = named.find((competition) => competition.standings?.length);
  return hasStandings ?? named[0];
}

export function teamCoverage(team: TeamProfile, matches: FootballMatch[]): TeamCoverage {
  const related = matches.filter((match) => match.homeTeam.id === team.id || match.awayTeam.id === team.id);
  const upcoming = related
    .filter((match) => match.status === "scheduled" && match.kickoffAt)
    .slice()
    .sort((a, b) => new Date(a.kickoffAt ?? 0).getTime() - new Date(b.kickoffAt ?? 0).getTime());
  const next = upcoming[0];
  return {
    live: related.filter((match) => match.status === "live").length,
    upcoming: related.filter((match) => match.status === "scheduled").length,
    results: related.filter((match) => match.status === "finished").length,
    fixtures: related.length,
    nextKickoffAt: next?.kickoffAt,
    nextCompetitionId: next?.competition.id,
  };
}

export interface TeamEntry extends TeamProfile {
  countryLabel: string;
  competition?: CompetitionSummary;
  coverage: TeamCoverage;
  /** Ordered priority used by the "clubs to know" band: live first, then next fixture. */
  activity: number;
}

export interface CountryGroup {
  name: string;
  entries: TeamEntry[];
}

export interface TeamDirectory {
  entries: TeamEntry[];
  /** Clubs with existing match coverage, most active first. */
  featured: TeamEntry[];
  countries: CountryGroup[];
  competitions: { id: string; name: string; count: number; href?: string }[];
  totals: { teams: number; countries: number; competitions: number };
}

export function buildTeamDirectory(teams: TeamProfile[], matches: FootballMatch[]): TeamDirectory {
  const entries: TeamEntry[] = teams.map((team) => {
    const coverage = teamCoverage(team, matches);
    const nextKickoff = coverage.nextKickoffAt ? new Date(coverage.nextKickoffAt).getTime() : Number.MAX_SAFE_INTEGER;
    return {
      ...team,
      countryLabel: team.country?.trim() || "Unassigned country",
      competition: resolveTeamCompetition(team, matches),
      coverage,
      activity: coverage.live * 1000 + coverage.fixtures * 10 + (Number.isFinite(nextKickoff) && coverage.nextKickoffAt ? 5 : 0),
    };
  });

  const countryMap = new Map<string, TeamEntry[]>();
  for (const entry of entries) {
    const bucket = countryMap.get(entry.countryLabel) ?? [];
    bucket.push(entry);
    countryMap.set(entry.countryLabel, bucket);
  }

  const competitionMap = new Map<string, { name: string; count: number; href?: string }>();
  for (const entry of entries) {
    if (!entry.competition) continue;
    const existing = competitionMap.get(entry.competition.id);
    competitionMap.set(entry.competition.id, { name: entry.competition.name, count: (existing?.count ?? 0) + 1, href: entry.competition.href });
  }

  const byName = (a: TeamEntry, b: TeamEntry) => a.name.localeCompare(b.name);
  return {
    entries,
    featured: entries.filter((entry) => entry.coverage.fixtures > 0).slice().sort((a, b) => b.activity - a.activity || byName(a, b)),
    countries: [...countryMap.entries()]
      .map(([name, list]) => ({ name, entries: list.slice().sort(byName) }))
      .sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name)),
    competitions: [...competitionMap.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    totals: { teams: entries.length, countries: countryMap.size, competitions: competitionMap.size },
  };
}

const AGO_PATTERN = /(\d+)\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks|month|months)\s*ago/i;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Unit aliases, keyed after a trailing plural "s" has been removed. */
const RELATIVE_UNITS: Record<string, number> = {
  min: MINUTE,
  minute: MINUTE,
  hr: HOUR,
  hour: HOUR,
  day: DAY,
  week: 7 * DAY,
  month: 30 * DAY,
};

export type TransferWindow = "all" | "day" | "week";

export const TRANSFER_WINDOWS: { id: TransferWindow; label: string; description: string }[] = [
  { id: "all", label: "All activity", description: "Every tracked move in the current feed." },
  { id: "day", label: "Past 24 hours", description: "Moves updated within the last day." },
  { id: "week", label: "Past week", description: "Moves updated within the last seven days." },
];

/**
 * Converts an existing `updatedAt` label such as "Updated 12 min ago" into an age in
 * milliseconds. Returns undefined when the feed uses a format we cannot read, so the
 * UI can exclude that record from a time window instead of guessing.
 */
export function parseUpdatedAt(updatedAt: string): number | undefined {
  const match = AGO_PATTERN.exec(updatedAt);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = RELATIVE_UNITS[match[2].toLowerCase().replace(/s$/, "")];
  if (!Number.isFinite(amount) || !unit) return undefined;
  return amount * unit;
}

/** Keeps a transfer inside the selected time window; unreadable timestamps stay in "All activity" only. */
export function withinTransferWindow(updatedAt: string, window: TransferWindow): boolean {
  if (window === "all") return true;
  const age = parseUpdatedAt(updatedAt);
  if (age === undefined) return false;
  return age <= (window === "day" ? DAY : 7 * DAY);
}

/** Ranks clubs by how many tracked moves they are involved in, most active first. */
export function activeClubs(transfers: { fromTeam: { id: string }; toTeam: { id: string } }[]) {
  const counts = new Map<string, number>();
  for (const transfer of transfers) {
    counts.set(transfer.fromTeam.id, (counts.get(transfer.fromTeam.id) ?? 0) + 1);
    counts.set(transfer.toTeam.id, (counts.get(transfer.toTeam.id) ?? 0) + 1);
  }
  return [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

const MISSING_FEES = new Set(["—", "–", "-", "n/a", "na", "unknown", "tbc"]);

/**
 * Normalises a fee value. Feeds commonly use an em dash, a dash or "n/a" to mean
 * "not disclosed", so those are treated as absent rather than shown as a value.
 */
export function readFee(fee?: string): string | undefined {
  const trimmed = fee?.trim();
  if (!trimmed || MISSING_FEES.has(trimmed.toLocaleLowerCase())) return undefined;
  return trimmed;
}

export function statusSlug(status: string) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

export function pluralise(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
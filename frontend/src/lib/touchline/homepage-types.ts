/** Shared, API-agnostic contracts for the homepage UI. */
export interface EditorialImage {
  src: string;
  srcSet?: string;
  alt: string;
}

export interface NewsStory {
  id: string;
  title: string;
  summary?: string;
  category: string;
  publishedAt: string;
  href: string;
  /**
   * Optional because the news API returns no image field at all on list or detail
   * payloads. Cards render the existing empty media surface rather than inventing
   * a placeholder asset.
   */
  image?: EditorialImage;
}

export interface TeamRef {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  country?: string;
  logoUrl?: string;
  accent?: string;
}

export interface CompetitionRef {
  id: string;
  name: string;
  /**
   * Optional: the competition API exposes `country_id` only, with no region or
   * confederation field. Directory grouping falls back to "Unassigned region".
   */
  region?: string;
  abbreviation: string;
  logoUrl?: string;
  accent?: string;
  href: string;
  /** Optional fields supplied by competition APIs; no UI should fabricate these. */
  type?: string;
  teamIds?: string[];
  standings?: CompetitionStanding[];
}

export interface CompetitionStanding {
  teamId: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor?: number;
  goalsAgainst?: number;
  goalDifference: number;
  points: number;
  form?: string[];
}

export type MatchStatus = "live" | "scheduled" | "finished";

/** A goal or card recorded against one side of a match. */
export interface MatchEventSummary {
  /** `match_event_type` value, e.g. `goal`, `penalty_goal`, `yellow_card`. */
  type: string;
  minute?: string;
  /** Which side the event belongs to, when the provider recorded the team. */
  side?: "home" | "away";
}

export interface FootballMatch {
  id: string;
  competition: Pick<CompetitionRef, "id" | "name" | "abbreviation" | "logoUrl" | "accent">;
  homeTeam: TeamRef;
  awayTeam: TeamRef;
  status: MatchStatus;
  homeScore?: number;
  awayScore?: number;
  minute?: string;
  statusLabel?: string;
  /** Goals and cards in the order they happened. Absent when none are recorded. */
  events?: MatchEventSummary[];
  kickoffAt?: string;
  timeZoneLabel?: string;
  timeZone?: string;
  href: string;
}

export interface BreakingItem {
  id: string;
  headline: string;
  publishedAt: string;
  href: string;
}

export type TransferStatus = "Official" | "In talks" | "Reported" | "Loan watch";

export interface TransferItem {
  id: string;
  playerName: string;
  playerImage?: EditorialImage;
  fromTeam: TeamRef;
  toTeam: TeamRef;
  /**
   * Derived from the API's `transfer_status` enum. Only `announced`/`completed`
   * (Official) and `rumour` (Reported) have a source; `In talks` and `Loan watch`
   * are retained in the union for the transfer hub but are never fabricated here.
   */
  status: TransferStatus;
  fee?: string;
  updatedAt: string;
  href: string;
}

export interface TeamProfile extends TeamRef {
  href: string;
  managerName?: string;
  competitionName?: string;
  squad?: PlayerProfile[];
}

export interface PlayerSeasonStats {
  season?: string;
  appearances?: number;
  starts?: number;
  minutes?: number;
  goals?: number;
  assists?: number;
  cleanSheets?: number;
  yellowCards?: number;
  redCards?: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  /**
   * Optional: the player list endpoint returns no club and no nationality name
   * (only `nationality_id`). Omitted rather than filled with a placeholder club.
   */
  teamName?: string;
  position: string;
  /** Optional for the same reason as `teamName`. */
  country?: string;
  image?: EditorialImage;
  href: string;
  /** Optional season statistics returned by the existing player API. */
  seasonStats?: PlayerSeasonStats;
}

export interface HomepageData {
  /**
   * Always `false` now that data comes from the Football API. Retained so existing
   * `PageLayout` call sites keep compiling; no demo fixtures are produced.
   */
  isDemo: boolean;
  featuredStory?: NewsStory;
  supportingStories: NewsStory[];
  liveMatches: FootballMatch[];
  breakingNews: BreakingItem[];
  upcomingMatches: FootballMatch[];
  recentMatches: FootballMatch[];
  latestNews: NewsStory[];
  transfers: TransferItem[];
  transferStories: NewsStory[];
  competitions: CompetitionRef[];
  teams: TeamProfile[];
  players: PlayerProfile[];
}

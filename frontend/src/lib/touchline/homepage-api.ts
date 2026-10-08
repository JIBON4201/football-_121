import type {
  Article,
  Competition,
  Match,
  MatchDetails,
  Player,
  Team,
  Transfer,
} from "@/types/api";
import { entityUrl } from "@/config/routes";
import { fetchList, fetchListSafely, hasIdentity } from "./data-fetch";
import { formatRelative, toFiniteNumber } from "./dates";
import { initials, statusSlug } from "./directory-data";
import type {
  BreakingItem,
  CompetitionRef,
  EditorialImage,
  FootballMatch,
  MatchStatus,
  NewsStory,
  PlayerProfile,
  TeamProfile,
  TeamRef,
  TransferItem,
  TransferStatus,
} from "./homepage-types";

/**
 * API adapter for the homepage.
 *
 * This is the only place where `/api/v1` payloads become UI records. Components
 * receive the same shapes they always received; nothing below invents a value the
 * API did not supply, and anything the API omits is left undefined so the existing
 * empty states and fallbacks take over.
 */

/** Rows requested per homepage feed. */
export const HOMEPAGE_LIMITS = {
  liveMatches: 6,
  upcomingMatches: 6,
  recentMatches: 6,
  breakingNews: 4,
  latestNews: 8,
  transferNews: 4,
  competitions: 6,
  teams: 8,
  players: 8,
  transfers: 6,
} as const;

/**
 * Per-feed revalidation, in seconds. Live scores refresh fastest; reference data
 * such as clubs, players and competitions is effectively static.
 */
export const HOMEPAGE_REVALIDATE = {
  liveMatches: 30,
  upcomingMatches: 60,
  recentMatches: 300,
  breakingNews: 60,
  latestNews: 300,
  transferNews: 300,
  competitions: 3600,
  teams: 3600,
  players: 3600,
  transfers: 300,
} as const;

/**
 * Match listing endpoints return bare foreign keys unless asked for the card
 * shape. Every feed requests `include=card`, which batch-resolves team,
 * competition and venue records server-side plus the few event types a card
 * renders, so the homepage never fans out to per-match details requests.
 */

/**
 * Rows per feed on the match centre (`/live`, `/matches`).
 */
export const MATCH_CENTRE_LIMITS = {
  live: 12,
  upcoming: 12,
  finished: 12,
} as const;

/** Live scores refresh fastest; results settle and can be cached hard. */
export const MATCH_CENTRE_REVALIDATE = {
  live: 30,
  upcoming: 60,
  finished: 300,
} as const;

/** The match status sets the API treats as live, from `LIVE_MATCH_STATUSES`. */
const LIVE_STATUSES = new Set(["live", "half_time", "extra_time", "penalty_shootout", "suspended"]);
/** `scheduled` and `pre_match`, from `UPCOMING_MATCH_STATUSES`. */
const UPCOMING_STATUSES = new Set(["scheduled", "pre_match"]);

/**
 * A three-letter badge. The API's `short_name` is nullable and unconstrained in
 * length, so a name-derived fallback is used rather than an empty string, which
 * the crest components would otherwise fail to slice.
 */
function toAbbreviation(name: string, shortName: string | null | undefined): string {
  const short = shortName?.trim();
  if (short) return short.slice(0, 3);
  return initials(name).slice(0, 3);
}

export function toTeamRef(team: Team): TeamRef {
  return {
    // The API's `id` is a UUID; every href in this UI is built from the slug, so
    // the slug is carried in `id` to keep generated links valid.
    id: team.slug,
    name: team.name,
    shortName: team.short_name?.trim() || team.name,
    abbreviation: toAbbreviation(team.name, team.short_name),
    logoUrl: team.logo_url ?? undefined,
  };
}

export function toTeamProfile(team: Team): TeamProfile {
  return { ...toTeamRef(team), href: `/teams/${team.slug}` };
}

export function toCompetitionRef(competition: Competition): CompetitionRef {
  return {
    id: competition.slug,
    name: competition.name,
    abbreviation: toAbbreviation(competition.name, competition.short_name),
    logoUrl: competition.logo_url ?? undefined,
    href: `/competitions/${competition.slug}`,
    type: competition.type ?? undefined,
    // `region` is intentionally omitted: the competition API has no such field.
  };
}

export function toPlayerProfile(player: Player): PlayerProfile {
  return {
    id: player.slug,
    name: player.display_name,
    position: player.position ?? "",
    href: `/players/${player.slug}`,
    image: player.photo_url ? ({ src: player.photo_url, alt: player.display_name } satisfies EditorialImage) : undefined,
    // `teamName` and `country` are omitted: the player list endpoint returns no
    // club and no nationality name.
  };
}

const ARTICLE_TYPE_LABELS: Record<string, string> = {
  news: "News",
  breaking_news: "Breaking",
  transfer: "Transfer",
  match_report: "Match report",
  analysis: "Analysis",
  opinion: "Opinion",
};

/** `article_type` is a classification, not a category; it is the only label available. */
function toArticleLabel(articleType: string): string {
  return ARTICLE_TYPE_LABELS[articleType] ?? articleType.replace(/_/g, " ");
}

export function toNewsStory(article: Article): NewsStory {
  return {
    id: article.slug,
    title: article.title,
    summary: article.excerpt ?? undefined,
    category: toArticleLabel(article.article_type),
    publishedAt: formatRelative(article.published_at),
    href: `/news/${article.slug}`,
    // No image: the news endpoints do not return one.
  };
}

/** Matches the API's status set onto the three phases this UI renders. */
export function toMatchStatus(status: string): MatchStatus | null {
  if (LIVE_STATUSES.has(status)) return "live";
  if (UPCOMING_STATUSES.has(status)) return "scheduled";
  if (status === "finished") return "finished";
  // postponed / cancelled / abandoned and anything unknown are deliberately dropped.
  return null;
}

/** Latest recorded event minute, so a live card can show progress instead of "LIVE". */
function toMinute(events: MatchDetails["events"] | undefined): string | undefined {
  let latest: number | null = null;
  let latestExtra = 0;
  for (const event of events ?? []) {
    if (typeof event?.minute !== "number") continue;
    if (latest === null || event.minute > latest || (event.minute === latest && (event.extra_minute ?? 0) > latestExtra)) {
      latest = event.minute;
      latestExtra = event.extra_minute ?? 0;
    }
  }
  if (latest === null) return undefined;
  return latestExtra > 0 ? `${latest}+${latestExtra}'` : `${latest}'`;
}

/**
 * The most recent event that says something about where the match stands. The API
 * returns `half_time`, `extra_time`, `penalty_shootout` and `suspended` as live
 * statuses, and "LIVE" would misreport every one of them.
 */
function toStatusLabel(status: string, minute: string | undefined): string | undefined {
  switch (status) {
    case "half_time":
      return "HT";
    case "extra_time":
      return minute ? `ET ${minute}` : "ET";
    case "penalty_shootout":
      return minute ? `PENS ${minute}` : "PENS";
    case "suspended":
      return "Suspended";
    default:
      // A progressing match already shows its minute, which reads better than "LIVE".
      return minute ? undefined : "LIVE";
  }
}

/** Events the API records that are worth showing on a card. */
const CARD_EVENT_TYPES = new Set(["goal", "own_goal", "penalty_goal", "yellow_card", "red_card"]);

/** Enough goals and cards to be useful without crowding a match card. */
const CARD_EVENT_LIMIT = 6;

export interface MatchEventSummary {
  type: string;
  minute?: string;
  /** 'home' | 'away' | undefined when the provider left the side unrecorded. */
  side?: "home" | "away";
}

/**
 * Goal and card events for one match, in the order they happened. The API caps a
 * match at 200 events; only the handful a card can show are kept.
 */
export function toMatchEventSummaries(details: MatchDetails): MatchEventSummary[] {
  const summaries: MatchEventSummary[] = [];
  for (const event of details.events ?? []) {
    if (!CARD_EVENT_TYPES.has(event?.type)) continue;
    const minute = typeof event.minute === "number" ? (event.extra_minute ? `${event.minute}+${event.extra_minute}'` : `${event.minute}'`) : undefined;
    summaries.push({
      type: event.type,
      ...(minute ? { minute } : {}),
      ...(event.team_id ? { side: event.team_id === details.homeTeam?.id ? "home" : event.team_id === details.awayTeam?.id ? "away" : undefined } : {}),
    });
    if (summaries.length >= CARD_EVENT_LIMIT) break;
  }
  return summaries;
}

export function toFootballMatch(details: MatchDetails): FootballMatch | null {
  // The API returns untyped JSON, so a payload without a usable match object is
  // dropped rather than rendered as an empty card. The check is deliberately a
  // plain guard: an `isRecord` predicate would widen the declared field types to
  // `unknown` and lose every downstream narrowing.
  const match = details?.match;
  if (!match || typeof match !== "object" || typeof match.slug !== "string") return null;
  const homeTeam = details.homeTeam;
  const awayTeam = details.awayTeam;
  // A match card is meaningless without both clubs; drop it rather than guess.
  if (!hasIdentity(homeTeam) || !hasIdentity(awayTeam)) return null;
  const status = toMatchStatus(match.status);
  if (!status) return null;

  const minute = toMinute(details.events);
  const events = toMatchEventSummaries(details);
  return {
    id: match.slug,
    competition: details.competition && hasIdentity(details.competition)
      ? {
          id: details.competition.slug,
          name: details.competition.name,
          abbreviation: toAbbreviation(details.competition.name, details.competition.short_name),
          logoUrl: details.competition.logo_url ?? undefined,
        }
      : { id: "", name: "Competition", abbreviation: "" },
    homeTeam: toTeamRef(homeTeam),
    awayTeam: toTeamRef(awayTeam),
    status,
    homeScore: typeof match.home_score === "number" ? match.home_score : undefined,
    awayScore: typeof match.away_score === "number" ? match.away_score : undefined,
    minute,
    ...(toStatusLabel(match.status, minute) ? { statusLabel: toStatusLabel(match.status, minute) } : {}),
    ...(events.length ? { events } : {}),
    kickoffAt: match.scheduled_at ?? undefined,
    // The API exposes no per-match time zone; readers fall back to UTC.
    href: entityUrl("match", match.slug),
  };
}

/** Narrow a `/matches` row served with `include=card` into renderable parts. */
function parseMatchCard(value: unknown): MatchDetails | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const match = row as unknown as Match;
  if (typeof match?.slug !== "string" || typeof match?.status !== "string") return null;
  const team = (v: unknown): Team | null => {
    if (typeof v !== "object" || v === null) return null;
    const t = v as Record<string, unknown>;
    return typeof t.name === "string" && typeof t.slug === "string"
      ? {
          id: typeof t.id === "string" ? t.id : t.slug,
          name: t.name,
          short_name: typeof t.short_name === "string" ? t.short_name : null,
          slug: t.slug,
          logo_url: typeof t.logo_url === "string" ? t.logo_url : null,
        }
      : null;
  };
  const competition = (v: unknown): Competition | null => {
    if (typeof v !== "object" || v === null) return null;
    const c = v as Record<string, unknown>;
    return typeof c.name === "string" && typeof c.slug === "string"
      ? {
          id: typeof c.id === "string" ? c.id : c.slug,
          name: c.name,
          short_name: typeof c.short_name === "string" ? c.short_name : null,
          slug: c.slug,
          logo_url: typeof c.logo_url === "string" ? c.logo_url : null,
          ...(typeof c.type === "string" ? { type: c.type } : {}),
        }
      : null;
  };
  const events = Array.isArray(row.events)
    ? (row.events
        .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
        .map((e) => ({
          id: typeof e.id === "string" ? e.id : "",
          team_id: typeof e.team_id === "string" ? e.team_id : null,
          player_id: typeof e.player_id === "string" ? e.player_id : null,
          assist_player_id: typeof e.assist_player_id === "string" ? e.assist_player_id : null,
          type: typeof e.type === "string" ? e.type : "",
          minute: typeof e.minute === "number" ? e.minute : null,
          extra_minute: typeof e.extra_minute === "number" ? e.extra_minute : null,
          description: typeof e.description === "string" ? e.description : null,
        }))
        .filter((e) => e.type !== ""))
    : [];
  return {
    match,
    homeTeam: team(row.homeTeam),
    awayTeam: team(row.awayTeam),
    competition: competition(row.competition),
    events,
  };
}

/** The three match lists the API serves, each with its own endpoint and status set. */
export type MatchFeed = "live" | "upcoming" | "finished";

export interface MatchFeedResult {
  matches: FootballMatch[];
  /**
   * The list request itself failed — API unreachable, timed out or unparseable.
   * Distinct from an empty feed, which is a legitimate "nothing right now".
   */
  failed: boolean;
}

/**
 * One match feed, served with the `include=card` shape.
 *
 * `fetchListSafely` collapses a transport failure into an empty list, which would
 * render as "no matches" and quietly hide an outage. This reports the two cases
 * apart so a page can show an honest error state.
 */
export async function loadMatchFeed(
  feed: MatchFeed,
  options: { limit: number; revalidateSeconds: number; tag: string },
): Promise<MatchFeedResult> {
  let rows: unknown[];
  try {
    ({ rows } = await fetchList<unknown>(`/matches/${feed}`, {
      limit: options.limit,
      query: { include: "card" },
      next: { revalidate: options.revalidateSeconds, tags: [options.tag] },
    }));
  } catch {
    return { matches: [], failed: true };
  }
  const matches: FootballMatch[] = [];
  for (const row of rows) {
    const card = parseMatchCard(row);
    const match = card ? toFootballMatch(card) : null;
    if (match) matches.push(match);
  }
  return { matches, failed: false };
}

export function loadLiveMatches(): Promise<FootballMatch[]> {
  return loadMatchFeed("live", {
    limit: HOMEPAGE_LIMITS.liveMatches,
    revalidateSeconds: HOMEPAGE_REVALIDATE.liveMatches,
    tag: "homepage:live",
  }).then((result) => result.matches);
}

export function loadUpcomingMatches(): Promise<FootballMatch[]> {
  return loadMatchFeed("upcoming", {
    limit: HOMEPAGE_LIMITS.upcomingMatches,
    revalidateSeconds: HOMEPAGE_REVALIDATE.upcomingMatches,
    tag: "homepage:upcoming",
  }).then((result) => result.matches);
}

export function loadRecentMatches(): Promise<FootballMatch[]> {
  return loadMatchFeed("finished", {
    limit: HOMEPAGE_LIMITS.recentMatches,
    revalidateSeconds: HOMEPAGE_REVALIDATE.recentMatches,
    tag: "homepage:results",
  }).then((result) => result.matches);
}

async function loadStories(
  path: string,
  limit: number,
  revalidateSeconds: number,
  tag: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<NewsStory[]> {
  const { rows } = await fetchListSafely<Article>(path, {
    limit,
    query,
    next: { revalidate: revalidateSeconds, tags: [tag] },
  });
  return rows.filter(hasIdentity).map(toNewsStory);
}

export function loadBreakingNews(): Promise<NewsStory[]> {
  return loadStories("/news/breaking", HOMEPAGE_LIMITS.breakingNews, HOMEPAGE_REVALIDATE.breakingNews, "homepage:breaking");
}

export function loadTransferNews(): Promise<NewsStory[]> {
  return loadStories("/news", HOMEPAGE_LIMITS.transferNews, HOMEPAGE_REVALIDATE.transferNews, "homepage:transfers", { type: "transfer" });
}

export interface LatestNewsWindow {
  /** The whole ordered window, exactly as the API returned it. */
  latest: NewsStory[];
  /** A newsroom-marked article leads; otherwise the newest published one does. */
  featured?: NewsStory;
  supporting: NewsStory[];
}

/**
 * The ordered latest-news window, read once and split three ways.
 *
 * The lead story, its supporting pair and the "latest" list are all views of the
 * same `/news/latest` response. Fetching it per view meant asking the API for an
 * identical payload two or three times in a single render, so the window is read
 * once here and every caller reads a different slice of the same records.
 */
export async function loadLatestWindow(): Promise<LatestNewsWindow> {
  const { rows } = await fetchListSafely<Article>("/news/latest", {
    limit: HOMEPAGE_LIMITS.latestNews,
    next: { revalidate: HOMEPAGE_REVALIDATE.latestNews, tags: ["homepage:latest"] },
  });
  const latest = rows.filter(hasIdentity).map(toNewsStory);
  const featuredIndex = rows.findIndex((row) => row.is_featured && hasIdentity(row));
  const featured = latest[featuredIndex === -1 ? 0 : featuredIndex];
  const supporting = latest.filter((story) => story.id !== featured?.id).slice(0, 2);
  return { latest, ...(featured ? { featured } : {}), supporting };
}

/** The three headline slots a breaking strip shows. */
export function toBreakingItems(stories: NewsStory[]): BreakingItem[] {
  return stories.slice(0, 3).map((story) => ({
    id: story.id,
    headline: story.title,
    publishedAt: story.publishedAt,
    href: story.href,
  }));
}

export async function loadCompetitions(): Promise<CompetitionRef[]> {
  const { rows } = await fetchListSafely<Competition>("/competitions", {
    limit: HOMEPAGE_LIMITS.competitions,
    query: { active: true },
    next: { revalidate: HOMEPAGE_REVALIDATE.competitions, tags: ["homepage:competitions"] },
  });
  return rows.filter(hasIdentity).map(toCompetitionRef);
}

export async function loadTeams(): Promise<TeamProfile[]> {
  const { rows } = await fetchListSafely<Team>("/teams", {
    limit: HOMEPAGE_LIMITS.teams,
    query: { active: true },
    next: { revalidate: HOMEPAGE_REVALIDATE.teams, tags: ["homepage:teams"] },
  });
  return rows.filter(hasIdentity).map(toTeamProfile);
}

export async function loadPlayers(): Promise<PlayerProfile[]> {
  const { rows } = await fetchListSafely<Player>("/players", {
    limit: HOMEPAGE_LIMITS.players,
    next: { revalidate: HOMEPAGE_REVALIDATE.players, tags: ["homepage:players"] },
  });
  return rows.filter(hasIdentity).map(toPlayerProfile);
}

/**
 * Fee formatting. The API returns `numeric(18,2)` plus a separate ISO currency,
 * never a display string. A null fee is treated as undisclosed, never as zero.
 */
export function formatTransferFee(
  fee: number | string | null | undefined,
  currency: string | null | undefined,
  transferType: string | null | undefined,
): string | undefined {
  const value = toFiniteNumber(fee);
  if (value === null) return transferType === "free_transfer" ? "Free" : undefined;
  if (value === 0) return "Free";
  const formatted = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
  return currency ? `${currency} ${formatted}` : formatted;
}

/**
 * `Official` covers the API's `announced` and `completed`; `Reported` covers
 * `rumour`. `cancelled` and `rejected` have no equivalent and are dropped rather
 * than relabelled, so a dead move never appears as live reporting.
 */
export function toTransferStatus(status: string): TransferStatus | null {
  if (status === "announced" || status === "completed") return "Official";
  if (status === "rumour") return "Reported";
  return null;
}

export function toTransferItem(transfer: Transfer): TransferItem | null {
  const status = toTransferStatus(transfer.status);
  // A move needs a named player and both clubs to be readable on the tracker.
  if (!status || !hasIdentity(transfer.player) || !hasIdentity(transfer.fromTeam) || !hasIdentity(transfer.toTeam)) return null;
  const player = transfer.player;
  return {
    id: transfer.id,
    playerName: player.display_name,
    playerImage: player.photo_url ? ({ src: player.photo_url, alt: player.display_name } satisfies EditorialImage) : undefined,
    fromTeam: toTeamRef(transfer.fromTeam),
    toTeam: toTeamRef(transfer.toTeam),
    status,
    fee: formatTransferFee(transfer.fee, transfer.currency, transfer.transfer_type),
    updatedAt: formatRelative(transfer.announcement_date ?? transfer.effective_date),
    href: `/transfers/${transfer.id}`,
  };
}

export async function loadTransfers(): Promise<TransferItem[]> {
  const { rows } = await fetchListSafely<Transfer>("/transfers", {
    limit: HOMEPAGE_LIMITS.transfers,
    next: { revalidate: HOMEPAGE_REVALIDATE.transfers, tags: ["homepage:transfers-feed"] },
  });
  const items = rows.map(toTransferItem).filter((item): item is TransferItem => item !== null);
  // Stable, de-duplicated ordering for the CSS status classes.
  return items.sort((a, b) => a.status.localeCompare(b.status) || statusSlug(a.status).localeCompare(statusSlug(b.status)));
}
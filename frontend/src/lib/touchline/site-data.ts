import type {
  BreakingItem,
  CompetitionRef,
  FootballMatch,
  NewsStory,
  PlayerProfile,
  TeamProfile,
  TransferItem,
} from "./homepage-types";
import { siteConfig } from "@/config/site";
import { sanitizeArticleContent } from "@/lib/content";
import { fetchArticleDetail } from "@/lib/news";
import type { Article, Transfer } from "@/types/api";
import { formatRelative } from "./dates";
import {
  loadBreakingNews,
  loadCompetitions,
  loadLatestWindow,
  loadLiveMatches,
  loadMatchFeed,
  loadPlayers,
  loadRecentMatches,
  loadTeams,
  loadTransferNews,
  loadUpcomingMatches,
  loadTransfers,
  toBreakingItems,
  toNewsStory,
  toTransferItem,
  MATCH_CENTRE_LIMITS,
  MATCH_CENTRE_REVALIDATE,
} from "./homepage-api";

export interface ArticleDetail {
  slug: string;
  story: NewsStory;
  author?: string;
  readingMinutes?: number;
  /** Sanitised HTML paragraphs, already cleaned by `@/lib/content`. */
  body: string[];
  /** Raw ISO publish timestamp from the API, for machine-readable metadata. */
  publishedIso?: string;
}

/**
 * Route data loaders.
 *
 * Each loader below reads only the feeds the route it serves actually renders, in
 * one parallel read. There is deliberately no "load everything" loader: the
 * homepage is the single page that renders every section, and it has its own
 * `getHomepageData()`. A route that wants a shared dataset (the newsroom pool,
 * the three match phases) calls the shared pool loader, so the same data is
 * fetched once per render rather than once per page that happens to need it.
 */

function slugFromHref(href: string) {
  const parts = href.split("?")[0].split("/").filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] ?? "");
}

function uniqueByHref(stories: NewsStory[]) {
  const seen = new Set<string>();
  return stories.filter((story) => {
    if (!story.href.startsWith("/news/")) return false;
    if (seen.has(story.href)) return false;
    seen.add(story.href);
    return true;
  });
}

/** Matches a row to itself in either slug form. */
function matchesSlug(item: { id: string; href: string }, slug: string) {
  return item.id === slug || slugFromHref(item.href) === slug;
}

/* ------------------------------------------------------------------------- *
 * Shared feed pools
 * ------------------------------------------------------------------------- */

/** The three match phases the directories and entity pages count coverage from. */
export interface MatchPhaseFeeds {
  live: FootballMatch[];
  upcoming: FootballMatch[];
  recent: FootballMatch[];
}

/**
 * Live, upcoming and finished matches, read together.
 *
 * Every coverage counter (fixture totals, club form, next kick-off, competition
 * fixture counts) is derived from these three feeds, so the team, competition and
 * entity routes share this loader instead of each re-deriving the same dataset.
 */
export async function getMatchPhaseFeeds(): Promise<MatchPhaseFeeds> {
  const [live, upcoming, recent] = await Promise.all([
    loadLiveMatches(),
    loadUpcomingMatches(),
    loadRecentMatches(),
  ]);
  return { live, upcoming, recent };
}

/** Every match a coverage counter should see, in section order. */
export function flattenMatchPhases({ live, upcoming, recent }: MatchPhaseFeeds): FootballMatch[] {
  return [...live, ...upcoming, ...recent];
}

/**
 * The newsroom pool: the latest window plus transfer coverage and breaking
 * headlines. This is what "more stories" links are matched against on article,
 * team, player and competition pages — it is not the full newsroom archive, which
 * only `/news` reads.
 */
export async function getNewsStories(): Promise<NewsStory[]> {
  const [latestWindow, transferStories, breakingNews] = await Promise.all([
    loadLatestWindow(),
    loadTransferNews(),
    loadBreakingNews(),
  ]);
  return uniqueByHref([...latestWindow.latest, ...transferStories, ...breakingNews]);
}

/**
 * Breaking headlines only.
 *
 * A story counts as breaking when the API classified it that way, which happens
 * both on the dedicated breaking feed and inside the latest window, so both are
 * read. Nothing else is fetched: this page never renders a match, a transfer, a
 * club, a player or a competition.
 */
export async function getBreakingStories(): Promise<NewsStory[]> {
  const [latestWindow, breakingNews] = await Promise.all([loadLatestWindow(), loadBreakingNews()]);
  return uniqueByHref([...latestWindow.latest, ...breakingNews]).filter(
    (story) => story.category.toLowerCase() === "breaking",
  );
}

/* ------------------------------------------------------------------------- *
 * `/breaking-news`
 * ------------------------------------------------------------------------- */

export interface BreakingNewsPageData {
  stories: NewsStory[];
  isDemo: boolean;
}

/** Data for `/breaking-news` — the breaking feeds and nothing else. */
export async function getBreakingNewsPageData(): Promise<BreakingNewsPageData> {
  return { stories: await getBreakingStories(), isDemo: false };
}

/* ------------------------------------------------------------------------- *
 * `/news`
 * ------------------------------------------------------------------------- */

export interface TaxonomyLink {
  name: string;
  slug: string;
}

export interface NewsroomPageData {
  stories: NewsStory[];
  breakingNews: BreakingItem[];
  categoryLinks: TaxonomyLink[];
  tagLinks: TaxonomyLink[];
  isDemo: boolean;
}

/** Rows the archive holds before the next page; unchanged from the newsroom view. */
const ARCHIVE_LIMIT = 100;
/** Taxonomy chips are a browse aid, not the page's content. */
const TAXONOMY_LIMIT = 50;
const TAXONOMY_REVALIDATE = 3600;

/**
 * The published archive, merged into the pool so every article the API lists is
 * linked from the newsroom. Rows are mapped defensively: the endpoint returns
 * untyped JSON and an unmappable row is skipped rather than invented.
 */
async function loadNewsArchive(): Promise<NewsStory[]> {
  try {
    const { fetchNewsList } = await import("@/lib/news");
    const archive = await fetchNewsList({ page: 1, limit: ARCHIVE_LIMIT });
    const stories: NewsStory[] = [];
    for (const row of archive.rows) {
      if (typeof row.slug !== "string" || !row.slug) continue;
      try {
        stories.push(toNewsStory(row));
      } catch {
        // skip unmappable rows — never invent a story
      }
    }
    return stories;
  } catch {
    return [];
  }
}

function pickTaxonomy(value: unknown): TaxonomyLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (row): row is TaxonomyLink =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as { slug?: unknown }).slug === "string" &&
        typeof (row as { name?: unknown }).name === "string",
    )
    .slice(0, 30);
}

/**
 * Category/tag rows for the newsroom's browse links. These taxonomy pages are
 * sitemap-listed but have no header/footer entry point, so server-rendered links
 * here close the orphan gap — only real taxonomy rows are emitted.
 */
async function loadTaxonomy(path: "/categories" | "/tags"): Promise<TaxonomyLink[]> {
  try {
    const { fetchServer } = await import("@/lib/data-fetch");
    const envelope = await fetchServer<unknown>(path, {
      page: 1,
      limit: TAXONOMY_LIMIT,
      revalidate: TAXONOMY_REVALIDATE,
    });
    return pickTaxonomy(envelope.data);
  } catch {
    return [];
  }
}

/**
 * Data for `/news`.
 *
 * Four requests in parallel: the published archive, the breaking feed behind the
 * strip, and the two taxonomy lists. The archive already contains the latest and
 * transfer windows, so those are not re-read; the duplicate latest-news request
 * this page used to issue is gone with them.
 */
export async function getNewsroomPageData(): Promise<NewsroomPageData> {
  const [archive, breakingNews, categoryLinks, tagLinks] = await Promise.all([
    loadNewsArchive(),
    loadBreakingNews(),
    loadTaxonomy("/categories"),
    loadTaxonomy("/tags"),
  ]);
  return {
    stories: uniqueByHref([...archive, ...breakingNews]),
    breakingNews: toBreakingItems(breakingNews),
    categoryLinks,
    tagLinks,
    isDemo: false,
  };
}

/* ------------------------------------------------------------------------- *
 * `/transfers`
 * ------------------------------------------------------------------------- */

export interface TransfersPageData {
  transfers: TransferItem[];
  stories: NewsStory[];
  /** Player pool, so a move can link to the profile it belongs to. */
  players: PlayerProfile[];
  totalPages: number;
  isDemo: boolean;
}

/**
 * One page of tracked moves from the paginated transfer list.
 *
 * The list endpoint already resolves the player and both clubs per row, so the
 * rows are mapped to the same tracker records the API describes — fee, status and
 * player image included — rather than being fetched a second time from a
 * homepage-sized pool.
 */
async function loadTransferPage(page: number): Promise<{ items: TransferItem[]; totalPages: number }> {
  try {
    const { fetchTransferList, parseTransferFilters } = await import("@/lib/transfers");
    const list = await fetchTransferList(parseTransferFilters({ page: String(page) }));
    const items: TransferItem[] = [];
    for (const row of list.rows ?? []) {
      if (!row.player || !row.fromTeam || !row.toTeam) continue;
      const item = toTransferItem({
        ...row.transfer,
        player: row.player,
        fromTeam: row.fromTeam,
        toTeam: row.toTeam,
      } as Transfer);
      if (item) items.push(item);
    }
    return { items, totalPages: list.pagination.totalPages || 1 };
  } catch {
    return { items: [], totalPages: 1 };
  }
}

/**
 * Data for `/transfers` — the move list, the transfer coverage beside it, and the
 * player pool the hub links against. Three requests, no match or directory feeds.
 */
export async function getTransfersPageData(page: number): Promise<TransfersPageData> {
  const [list, stories, players] = await Promise.all([
    loadTransferPage(page),
    loadTransferNews(),
    loadPlayers(),
  ]);
  return { transfers: list.items, stories, players, totalPages: list.totalPages, isDemo: false };
}

/* ------------------------------------------------------------------------- *
 * Directories: `/teams`, `/players`, `/competitions`
 * ------------------------------------------------------------------------- */

export interface TeamsPageData {
  teams: TeamProfile[];
  matches: FootballMatch[];
  totalPages: number;
  isDemo: boolean;
}

/** A club row as the directory renders it; the list endpoint carries every field. */
function toTeamProfileRow(row: {
  slug: string;
  name: string;
  short_name?: string | null;
  logo_url?: string | null;
  country?: { name?: string } | null;
}): TeamProfile {
  const short = row.short_name?.trim() || row.name;
  return {
    id: row.slug,
    name: row.name,
    shortName: short,
    abbreviation: short.slice(0, 3).toUpperCase(),
    country: row.country?.name ?? undefined,
    logoUrl: row.logo_url ?? undefined,
    href: `/teams/${row.slug}`,
  };
}

/**
 * Data for `/teams` — the paginated club list plus the match phases the directory
 * counts coverage from. The homepage club pool added nothing the list rows do not
 * already carry, so it is no longer read.
 */
export async function getTeamsPageData(page: number): Promise<TeamsPageData> {
  const [list, matches] = await Promise.all([loadTeamPage(page), getMatchPhaseFeeds()]);
  return { teams: list.teams, matches: flattenMatchPhases(matches), totalPages: list.totalPages, isDemo: false };
}

async function loadTeamPage(page: number): Promise<{ teams: TeamProfile[]; totalPages: number }> {
  try {
    const { fetchTeamList, TEAM_PAGE_SIZE } = await import("@/lib/teams");
    const list = await fetchTeamList({ page, limit: TEAM_PAGE_SIZE });
    const teams = list.rows.map(toTeamProfileRow);
    if (teams.length > 0) return { teams, totalPages: list.pagination.totalPages };
    // The list feed came back empty — an outage, not an empty world. Fall back to
    // the club pool so the page still renders crawlable links. One extra request,
    // and only on this path.
    const pool = await loadTeams();
    return pool.length > 0 ? { teams: pool, totalPages: 1 } : { teams, totalPages: list.pagination.totalPages };
  } catch {
    return { teams: [], totalPages: 1 };
  }
}

export interface PlayersPageData {
  players: PlayerProfile[];
  totalPages: number;
  isDemo: boolean;
}

function toPlayerProfileRow(row: {
  slug: string;
  display_name: string;
  position?: string | null;
  photo_url?: string | null;
}): PlayerProfile {
  return {
    id: row.slug,
    name: row.display_name,
    position: row.position ?? "",
    href: `/players/${row.slug}`,
    ...(row.photo_url ? { image: { src: row.photo_url, alt: row.display_name } } : {}),
  };
}

/**
 * Data for `/players` — the paginated player list only. A directory needs no
 * matches, no clubs and no news, so this route reads exactly one feed.
 */
export async function getPlayersPageData(page: number): Promise<PlayersPageData> {
  try {
    const { fetchPlayerList, PLAYER_PAGE_SIZE } = await import("@/lib/players");
    const list = await fetchPlayerList({ page, limit: PLAYER_PAGE_SIZE });
    const players = list.rows.map(toPlayerProfileRow);
    if (players.length > 0) {
      return { players, totalPages: list.pagination.totalPages, isDemo: false };
    }
    // Empty list means an outage rather than an empty world: fall back to the
    // player pool so the directory still renders crawlable profiles.
    const pool = await loadPlayers();
    return { players: pool, totalPages: 1, isDemo: false };
  } catch {
    return { players: [], totalPages: 1, isDemo: false };
  }
}

export interface CompetitionsPageData {
  competitions: CompetitionRef[];
  matches: FootballMatch[];
  totalPages: number;
  isDemo: boolean;
}

function toCompetitionRefRow(row: {
  slug: string;
  name: string;
  short_name?: string | null;
  logo_url?: string | null;
  type?: string | null;
  country?: { name?: string } | null;
}): CompetitionRef {
  return {
    id: row.slug,
    name: row.name,
    abbreviation: (row.short_name?.trim() || row.name).slice(0, 3).toUpperCase(),
    logoUrl: row.logo_url ?? undefined,
    href: `/competitions/${row.slug}`,
    type: row.type ?? undefined,
    region: row.country?.name ?? undefined,
  };
}

/**
 * Data for `/competitions` — the paginated competition list plus the match phases
 * the directory counts fixtures from.
 */
export async function getCompetitionsPageData(page: number): Promise<CompetitionsPageData> {
  const [list, matches] = await Promise.all([
    loadCompetitionPage(page),
    getMatchPhaseFeeds(),
  ]);
  return {
    competitions: list.competitions,
    matches: flattenMatchPhases(matches),
    totalPages: list.totalPages,
    isDemo: false,
  };
}

async function loadCompetitionPage(page: number): Promise<{ competitions: CompetitionRef[]; totalPages: number }> {
  try {
    const { fetchCompetitionList, COMPETITION_PAGE_SIZE } = await import("@/lib/competitions");
    const list = await fetchCompetitionList({ page, limit: COMPETITION_PAGE_SIZE });
    const competitions = list.rows.map(toCompetitionRefRow);
    if (competitions.length > 0) return { competitions, totalPages: list.pagination.totalPages };
    // Empty list means an outage rather than an empty world: fall back to the
    // competition pool so the directory still renders crawlable pages.
    const pool = await loadCompetitions();
    return { competitions: pool, totalPages: 1 };
  } catch {
    return { competitions: [], totalPages: 1 };
  }
}

/* ------------------------------------------------------------------------- *
 * Entity pages
 * ------------------------------------------------------------------------- */

export interface ArticlePageData {
  article: ArticleDetail | null;
  /** The newsroom pool, for the related-coverage and sidebar links. */
  stories: NewsStory[];
  isDemo: boolean;
}

/** Data for `/news/[slug]` — the article plus the pool its sidebars match against. */
export async function getArticlePageData(slug: string): Promise<ArticlePageData> {
  const [article, stories] = await Promise.all([getArticleBySlug(slug), getNewsStories()]);
  return { article, stories, isDemo: false };
}

export interface TeamDetailPageData {
  team: TeamProfile | null;
  matches: FootballMatch[];
  stories: NewsStory[];
  isDemo: boolean;
}

/** Data for `/teams/[slug]` — the club, its match phases and related coverage. */
export async function getTeamDetailPageData(slug: string): Promise<TeamDetailPageData> {
  const [team, matches, stories] = await Promise.all([
    getTeamBySlug(slug),
    getMatchPhaseFeeds(),
    getNewsStories(),
  ]);
  return { team, matches: flattenMatchPhases(matches), stories, isDemo: false };
}

/** The tracked-move pool used to match a player's transfer history. */
async function loadTransferPool(): Promise<TransferItem[]> {
  return loadTransfers();
}

export interface PlayerDetailPageData {
  player: PlayerProfile | null;
  /** Club pool, so the player's current side can be linked. */
  teams: TeamProfile[];
  stories: NewsStory[];
  transfers: TransferItem[];
  isDemo: boolean;
}

/** Data for `/players/[slug]` — the profile, its club pool, coverage and moves. */
export async function getPlayerDetailPageData(slug: string): Promise<PlayerDetailPageData> {
  const [player, teams, stories, transfers] = await Promise.all([
    getPlayerBySlug(slug),
    loadTeams(),
    getNewsStories(),
    loadTransferPool(),
  ]);
  return { player, teams, stories, transfers, isDemo: false };
}

export interface CompetitionDetailPageData {
  competition: CompetitionRef | null;
  matches: FootballMatch[];
  stories: NewsStory[];
  isDemo: boolean;
}

/** Data for `/competitions/[slug]` — the competition, its match phases and coverage. */
export async function getCompetitionDetailPageData(slug: string): Promise<CompetitionDetailPageData> {
  const [competition, matches, stories] = await Promise.all([
    getCompetitionBySlug(slug),
    getMatchPhaseFeeds(),
    getNewsStories(),
  ]);
  return { competition, matches: flattenMatchPhases(matches), stories, isDemo: false };
}

/* ------------------------------------------------------------------------- *
 * Match centre
 * ------------------------------------------------------------------------- */

export interface LivePageData {
  /** Matches in play, from `GET /matches/live`. */
  live: FootballMatch[];
  /** The next kick-offs, for the "Up next" rail beneath the live panel. */
  upcoming: FootballMatch[];
  /** The live feed could not be read, so absence of matches is not a verdict. */
  liveFailed: boolean;
  /** The upcoming feed could not be read. */
  upcomingFailed: boolean;
}

/**
 * Data for `/live`.
 *
 * Deliberately fetches only the two match feeds this page renders. Going through
 * the site dataset would also pull the newsroom, the transfer tracker and the
 * team/player/competition directories — eight further requests the page never
 * shows. Live stays a live-scores experience: what is in play, plus what is next.
 */
export async function getLivePageData(): Promise<LivePageData> {
  const [live, upcoming] = await Promise.all([
    loadMatchFeed("live", {
      limit: MATCH_CENTRE_LIMITS.live,
      revalidateSeconds: MATCH_CENTRE_REVALIDATE.live,
      tag: "matches:live",
    }),
    loadMatchFeed("upcoming", {
      limit: MATCH_CENTRE_LIMITS.upcoming,
      revalidateSeconds: MATCH_CENTRE_REVALIDATE.upcoming,
      tag: "matches:upcoming",
    }),
  ]);
  return {
    live: live.matches,
    upcoming: upcoming.matches,
    liveFailed: live.failed,
    upcomingFailed: upcoming.failed,
  };
}

export interface MatchCentreData {
  upcoming: FootballMatch[];
  live: FootballMatch[];
  results: FootballMatch[];
  upcomingFailed: boolean;
  liveFailed: boolean;
  resultsFailed: boolean;
}

/**
 * Data for `/matches` — the fixtures and results experience.
 *
 * Reads the same three feeds as the homepage but through the match-centre limits,
 * and fetches nothing else. Results come from `GET /matches/finished`; fixtures
 * from `GET /matches/upcoming`. Keeping this separate from `/live` is what lets
 * each page ask only for the phases it renders.
 */
export async function getMatchCentreData(): Promise<MatchCentreData> {
  const [upcoming, live, results] = await Promise.all([
    loadMatchFeed("upcoming", {
      limit: MATCH_CENTRE_LIMITS.upcoming,
      revalidateSeconds: MATCH_CENTRE_REVALIDATE.upcoming,
      tag: "matches:upcoming",
    }),
    loadMatchFeed("live", {
      limit: MATCH_CENTRE_LIMITS.live,
      revalidateSeconds: MATCH_CENTRE_REVALIDATE.live,
      tag: "matches:live",
    }),
    loadMatchFeed("finished", {
      limit: MATCH_CENTRE_LIMITS.finished,
      revalidateSeconds: MATCH_CENTRE_REVALIDATE.finished,
      tag: "matches:results",
    }),
  ]);
  return {
    upcoming: upcoming.matches,
    live: live.matches,
    results: results.matches,
    upcomingFailed: upcoming.failed,
    liveFailed: live.failed,
    resultsFailed: results.failed,
  };
}

/* ------------------------------------------------------------------------- *
 * Single-entity lookups
 * ------------------------------------------------------------------------- */

export async function getArticleBySlug(slug: string): Promise<ArticleDetail | null> {
  // `GET /news/:slug` is the authoritative source for an article body. When it is
  // unavailable the reader falls back to the newsroom pool so the page still
  // renders its headline rather than 404ing.
  let article: Article | null = null;
  try {
    article = (await fetchArticleDetail(slug)).article;
  } catch {
    article = null;
  }

  const fallback = article ? null : await getNewsStories();
  const story: NewsStory | undefined = article
    ? {
        id: article.slug,
        title: article.title,
        summary: article.excerpt ?? undefined,
        category: article.article_type.replace(/_/g, " "),
        publishedAt: formatRelative(article.published_at),
        href: `/news/${article.slug}`,
      }
    : fallback?.find((item) => slugFromHref(item.href) === slug);

  if (!story) return null;

  // Untrusted CMS markup is sanitised before it is ever split into blocks.
  const html = article ? sanitizeArticleContent(article.content) : "";
  return {
    slug,
    story,
    readingMinutes: estimateReadingMinutes(html),
    body: html ? splitBody(html) : [],
    publishedIso: article?.published_at ?? undefined,
  };
}

/**
 * Splits sanitised article HTML into plain-text blocks.
 *
 * The detail page renders each block as React text (`<p>{block}</p>`), so any
 * surviving markup would show up literally (escaped `<p>` tags in the reader's
 * face). Tags are therefore stripped here; block boundaries become items.
 * Common entities are decoded because React text does not parse them.
 */
function splitBody(html: string): string[] {
  return html
    .replace(/<\/(?:p|h2|h3|h4|blockquote|ul|ol|li|pre|hr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((block) =>
      block
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

/** ~200 words per minute, rounded up, with a floor of one minute. */
function estimateReadingMinutes(html: string): number | undefined {
  const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  if (words === 0) return undefined;
  return Math.max(1, Math.round(words / 200));
}

function toAbbreviation(name: string, shortName?: string | null): string {
  const short = shortName?.trim();
  if (short) return short.slice(0, 3).toUpperCase();
  return name.split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 3).toUpperCase() || name.slice(0, 3).toUpperCase();
}

export async function getCompetitionBySlug(slug: string): Promise<CompetitionRef | null> {
  // Direct backend fetch first so EVERY sitemap-listed competition renders HTTP 200.
  // The homepage pool only carries 6 items and would 404 the rest.
  // A details 404 falls through to the pool (test mocks often stub the list only).
  try {
    const { fetchCompetitionDetail } = await import('@/lib/competitions');
    const result = await fetchCompetitionDetail(slug);
    if (result.status === 'ready' && result.competition) {
      const c = result.competition;
      return {
        id: c.slug,
        name: c.name,
        abbreviation: toAbbreviation(c.name, c.short_name),
        logoUrl: c.logo_url ?? undefined,
        href: `/competitions/${c.slug}`,
        type: c.type ?? undefined,
        region: c.country?.name ?? undefined,
      };
    }
  } catch {
    // fall through to the pool
  }
  const pool = await loadCompetitions();
  return pool.find((item) => matchesSlug(item, slug)) ?? null;
}

export async function getTeamBySlug(slug: string): Promise<TeamProfile | null> {
  // Direct backend fetch first so EVERY sitemap-listed team renders HTTP 200.
  // A details 404 falls through to the pool (test mocks often stub the list only).
  try {
    const { fetchTeamDetail } = await import('@/lib/teams');
    const result = await fetchTeamDetail(slug);
    if (result.status === 'ready' && result.team) {
      const t = result.team;
      const squad: PlayerProfile[] = (result.squad ?? [])
        .filter((row) => row.player && row.player.slug)
        .map((row) => ({
          id: row.player!.slug,
          name: row.player!.display_name,
          position: row.player!.position ?? '',
          href: `/players/${row.player!.slug}`,
          ...(row.player!.photo_url ? { image: { src: row.player!.photo_url, alt: row.player!.display_name } } : {}),
        }));
      return {
        id: t.slug,
        name: t.name,
        shortName: t.short_name?.trim() || t.name,
        abbreviation: toAbbreviation(t.name, t.short_name),
        country: t.country?.name ?? undefined,
        logoUrl: t.logo_url ?? undefined,
        href: `/teams/${t.slug}`,
        ...(squad.length ? { squad } : {}),
      };
    }
  } catch {
    // fall through to the pool
  }
  const pool = await loadTeams();
  const profile = pool.find((item) => matchesSlug(item, slug));
  if (profile) return profile;
  // A club referenced by a fixture can still have a useful match-centre profile
  // even when the separate team-directory feed has not returned its full record.
  // Fallback: fetch only recent matches (single feed) instead of all three phases.
  try {
    const { loadMatchFeed, MATCH_CENTRE_LIMITS, MATCH_CENTRE_REVALIDATE } = await import("./homepage-api");
    const recent = await loadMatchFeed("finished", {
      limit: MATCH_CENTRE_LIMITS.finished,
      revalidateSeconds: MATCH_CENTRE_REVALIDATE.finished,
      tag: "matches:results",
    });
    const matchTeam = recent.matches
      .flatMap((match) => [match.homeTeam, match.awayTeam])
      .find((item) => item.id === slug);
    if (matchTeam) return { ...matchTeam, href: `/teams/${matchTeam.id}` };
  } catch {
    // match feed failed; no team found
  }
  return null;
}

export async function getPlayerBySlug(slug: string): Promise<PlayerProfile | null> {
  // Direct backend fetch first so EVERY sitemap-listed player renders HTTP 200.
  // A details 404 falls through to the pool (test mocks often stub the list only).
  try {
    const { fetchPlayerDetail, currentTeamEntry } = await import('@/lib/players');
    const result = await fetchPlayerDetail(slug);
    if (result.status === 'ready' && result.player) {
      const p = result.player;
      const current = currentTeamEntry(result.history ?? []);
      return {
        id: p.slug,
        name: p.display_name,
        teamName: current?.team?.name ?? undefined,
        position: p.position ?? '',
        country: p.nationality?.name ?? undefined,
        href: `/players/${p.slug}`,
        ...(p.photo_url ? { image: { src: p.photo_url, alt: p.display_name } } : {}),
      };
    }
  } catch {
    // fall through to the pool
  }
  const pool = await loadPlayers();
  return pool.find((item) => matchesSlug(item, slug)) ?? null;
}

export function getRelatedStories(stories: NewsStory[], searchTerms: string[]): NewsStory[] {
  const terms = searchTerms.map((term) => term.toLocaleLowerCase()).filter(Boolean);
  if (!terms.length) return [];
  return stories.filter((story) => terms.some((term) => `${story.title} ${story.summary ?? ""} ${story.category}`.toLocaleLowerCase().includes(term)));
}

export function getSiteUrl() {
  return siteConfig.siteUrl;
}

export { slugFromHref };

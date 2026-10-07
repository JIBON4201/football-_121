import type { BreakingItem, CompetitionRef, FootballMatch, HomepageData, NewsStory, PlayerProfile, TeamProfile } from "./homepage-types";
import { siteConfig } from "@/config/site";
import { sanitizeArticleContent } from "@/lib/content";
import { fetchArticleDetail } from "@/lib/news";
import type { Article } from "@/types/api";
import { formatRelative } from "./dates";
import { getHomepageData } from "./homepage-data";
import { loadMatchFeed, MATCH_CENTRE_LIMITS, MATCH_CENTRE_REVALIDATE } from "./homepage-api";

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

export interface FootballSiteData extends HomepageData {
  allNews: NewsStory[];
  allMatches: FootballMatch[];
}


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

export async function getFootballSiteData(): Promise<FootballSiteData> {
  const home = await getHomepageData();
  // Breaking headlines arrive headline-only. They join the searchable news pool
  // without an image rather than borrowing an unrelated story's artwork.
  const breakingStories: NewsStory[] = home.breakingNews.map((item: BreakingItem) => ({
    id: item.id,
    title: item.headline,
    category: "Breaking",
    publishedAt: item.publishedAt,
    href: item.href,
  }));
  const allNews = uniqueByHref([
    ...(home.featuredStory ? [home.featuredStory] : []),
    ...home.latestNews,
    ...home.supportingStories,
    ...home.transferStories,
    ...breakingStories,
  ]);
  const allMatches = [...home.liveMatches, ...home.upcomingMatches, ...home.recentMatches];
  return { ...home, allNews, allMatches };
}

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
 * `getFootballSiteData` would also pull the newsroom, the transfer tracker and the
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

export async function getArticleBySlug(slug: string): Promise<ArticleDetail | null> {
  // `GET /news/:slug` is the authoritative source for an article body. When it is
  // unavailable the reader falls back to the homepage story record so the page
  // still renders its headline and related coverage rather than 404ing.
  let article: Article | null = null;
  try {
    article = (await fetchArticleDetail(slug)).article;
  } catch {
    article = null;
  }

  const fallback = article ? null : await getFootballSiteData();
  const story: NewsStory | undefined = article
    ? {
        id: article.slug,
        title: article.title,
        summary: article.excerpt ?? undefined,
        category: article.article_type.replace(/_/g, " "),
        publishedAt: formatRelative(article.published_at),
        href: `/news/${article.slug}`,
      }
    : fallback?.allNews.find((item) => slugFromHref(item.href) === slug);

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
    // fall through to homepage pool
  }
  const data = await getFootballSiteData();
  return data.competitions.find((item) => item.id === slug || slugFromHref(item.href) === slug) ?? null;
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
    // fall through to homepage pool
  }
  const data = await getFootballSiteData();
  const profile = data.teams.find((item) => item.id === slug || slugFromHref(item.href) === slug);
  if (profile) return profile;
  // A club referenced by a fixture can still have a useful match-centre profile
  // even when the separate team-directory feed has not returned its full record.
  const matchTeam = data.allMatches.flatMap((match) => [match.homeTeam, match.awayTeam]).find((item) => item.id === slug);
  return matchTeam ? { ...matchTeam, href: `/teams/${matchTeam.id}` } : null;
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
    // fall through to homepage pool
  }
  const data = await getFootballSiteData();
  return data.players.find((item) => item.id === slug || slugFromHref(item.href) === slug) ?? null;
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

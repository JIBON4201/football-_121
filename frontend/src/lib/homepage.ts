import { siteConfig } from '@/config/site';
import { createApiClient } from '@/lib/api-client';
import type { Article, Competition, Match, Player, Team, Venue } from '@/types/api';

/**
 * Homepage data layer. All sections fetch in parallel (no waterfalls);
 * matches are enriched in one bounded fan-out round. Every section degrades
 * independently — one failure never takes down the page.
 */

export const HOMEPAGE_LIMITS = {
  live: 6,
  upcoming: 6,
  breaking: 4,
  latest: 6,
  transfers: 4,
  competitions: 6,
  teams: 8,
  players: 8,
} as const;

/** Per-section ISR tiers (seconds): live data refreshes fastest. */
export const HOMEPAGE_REVALIDATE = {
  live: 30,
  upcoming: 60,
  breaking: 60,
  latest: 300,
  transfers: 300,
  entities: 3600,
} as const;

/** Cap on per-match details fan-out so enrichment stays bounded. */
export const MAX_MATCH_DETAILS_FANOUT = 12;

export type SectionStatus = 'ready' | 'empty' | 'error';

export interface SectionData<T> {
  status: SectionStatus;
  items: T[];
}

export interface EnrichedMatch {
  match: Match;
  homeTeam: Team;
  awayTeam: Team;
  competition: Competition | null;
  venueName: string | null;
}

export interface HomepageData {
  live: SectionData<EnrichedMatch>;
  upcoming: SectionData<EnrichedMatch>;
  breaking: SectionData<Article>;
  latest: SectionData<Article>;
  transfers: SectionData<Article>;
  competitions: SectionData<Competition>;
  teams: SectionData<Team>;
  players: SectionData<Player>;
  hero: Article | null;
}

function homepageClient() {
  return createApiClient({ baseUrl: siteConfig.apiUrl, defaultTimeoutMs: 8000 });
}

async function fetchList<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  revalidate: number,
  tag: string,
): Promise<SectionData<T>> {
  try {
    const envelope = await homepageClient().get<T[]>(path, {
      query,
      next: { revalidate, tags: [tag] },
    });
    const items = Array.isArray(envelope.data) ? envelope.data : [];
    return { status: items.length > 0 ? 'ready' : 'empty', items };
  } catch {
    return { status: 'error', items: [] };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asTeam(value: unknown): Team | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== 'string' || typeof value.slug !== 'string') return null;
  return value as unknown as Team;
}

function asCompetition(value: unknown): Competition | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== 'string' || typeof value.slug !== 'string') return null;
  return value as unknown as Competition;
}

/**
 * Attach display entities to raw matches. A match is kept only when both
 * teams resolve — nameless fixtures are dropped, never fabricated.
 */
export function attachMatchDetails(
  matches: Match[],
  detailsBySlug: Map<string, { homeTeam: unknown; awayTeam: unknown; competition: unknown; venue: unknown }>,
): EnrichedMatch[] {
  const enriched: EnrichedMatch[] = [];
  for (const match of matches) {
    const details = detailsBySlug.get(match.slug);
    const homeTeam = asTeam(details?.homeTeam);
    const awayTeam = asTeam(details?.awayTeam);
    if (!homeTeam || !awayTeam) continue;
    const competition = asCompetition(details?.competition);
    const venue = details?.venue;
    enriched.push({
      match,
      homeTeam,
      awayTeam,
      competition,
      venueName: isRecord(venue) && typeof venue.name === 'string' ? venue.name : null,
    });
  }
  return enriched;
}

async function enrichMatches(matches: Match[], revalidate: number): Promise<EnrichedMatch[]> {
  const capped = matches.slice(0, MAX_MATCH_DETAILS_FANOUT);
  const settled = await Promise.allSettled(
    capped.map(async (match) => {
      const envelope = await homepageClient().get<{
        homeTeam: unknown;
        awayTeam: unknown;
        competition: unknown;
        venue: unknown;
      }>(`/matches/${match.slug}/details`, {
        next: { revalidate, tags: ['homepage:matches'] },
        timeoutMs: 5000,
      });
      return { slug: match.slug, details: envelope.data };
    }),
  );
  const bySlug = new Map<string, { homeTeam: unknown; awayTeam: unknown; competition: unknown; venue: unknown }>();
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.details) {
      bySlug.set(result.value.slug, result.value.details);
    }
  }
  return attachMatchDetails(capped, bySlug);
}

function toEnrichedSection(matches: Match[], enriched: EnrichedMatch[], listStatus: SectionStatus): SectionData<EnrichedMatch> {
  if (listStatus === 'error' && enriched.length === 0) return { status: 'error', items: [] };
  if (matches.length === 0) return { status: 'empty', items: [] };
  if (enriched.length === 0) return { status: 'error', items: [] };
  return { status: 'ready', items: enriched };
}

/** Hero prefers breaking news, falls back to the latest article. */
export function selectHeroArticle(breaking: Article[], latest: Article[]): Article | null {
  return breaking[0] ?? latest[0] ?? null;
}

/** Drop an item by id (used to avoid repeating the hero in its list). */
export function withoutId<T extends { id: string }>(items: T[], id: string | undefined): T[] {
  if (!id) return items;
  return items.filter((item) => item.id !== id);
}

export function venueNameOf(venue: Venue | null | undefined): string | null {
  return venue?.name ?? null;
}

/** Load every homepage section in parallel; each degrades independently. */
export async function loadHomepage(): Promise<HomepageData> {
  const [live, upcoming, breaking, latest, transfers, competitions, teams, players] = await Promise.all([
    loadLiveMatches(),
    loadUpcomingMatches(),
    loadBreakingNews(),
    loadLatestNews(),
    loadTransferNews(),
    loadCompetitions(),
    loadTeams(),
    loadPlayers(),
  ]);

  const hero = selectHeroArticle(breaking.items, latest.items);
  const latestItems = withoutId(latest.items, hero?.id);

  return {
    live,
    upcoming,
    breaking,
    latest: {
      status: latest.status === 'error' ? 'error' : latestItems.length > 0 ? 'ready' : 'empty',
      items: latestItems,
    },
    transfers,
    competitions,
    teams,
    players,
    hero,
  };
}

/** Individual section loaders (used by streaming async sections). */
export async function loadLiveMatches(): Promise<SectionData<EnrichedMatch>> {
  const list = await fetchList<Match>('/matches/live', { limit: HOMEPAGE_LIMITS.live }, HOMEPAGE_REVALIDATE.live, 'homepage:live');
  return toEnrichedSection(list.items, await enrichMatches(list.items, HOMEPAGE_REVALIDATE.live), list.status);
}

export async function loadUpcomingMatches(): Promise<SectionData<EnrichedMatch>> {
  const list = await fetchList<Match>('/matches/upcoming', { limit: HOMEPAGE_LIMITS.upcoming }, HOMEPAGE_REVALIDATE.upcoming, 'homepage:upcoming');
  return toEnrichedSection(list.items, await enrichMatches(list.items, HOMEPAGE_REVALIDATE.upcoming), list.status);
}

export async function loadBreakingNews(): Promise<SectionData<Article>> {
  return fetchList<Article>('/news/breaking', { limit: HOMEPAGE_LIMITS.breaking }, HOMEPAGE_REVALIDATE.breaking, 'homepage:breaking');
}

export async function loadLatestNews(): Promise<SectionData<Article>> {
  return fetchList<Article>('/news/latest', { limit: HOMEPAGE_LIMITS.latest }, HOMEPAGE_REVALIDATE.latest, 'homepage:latest');
}

export async function loadTransferNews(): Promise<SectionData<Article>> {
  return fetchList<Article>('/news', { type: 'transfer', limit: HOMEPAGE_LIMITS.transfers }, HOMEPAGE_REVALIDATE.transfers, 'homepage:transfers');
}

export async function loadCompetitions(): Promise<SectionData<Competition>> {
  return fetchList<Competition>('/competitions', { active: true, limit: HOMEPAGE_LIMITS.competitions }, HOMEPAGE_REVALIDATE.entities, 'homepage:competitions');
}

export async function loadTeams(): Promise<SectionData<Team>> {
  return fetchList<Team>('/teams', { limit: HOMEPAGE_LIMITS.teams }, HOMEPAGE_REVALIDATE.entities, 'homepage:teams');
}

export async function loadPlayers(): Promise<SectionData<Player>> {
  return fetchList<Player>('/players', { limit: HOMEPAGE_LIMITS.players }, HOMEPAGE_REVALIDATE.entities, 'homepage:players');
}

/** Hero article for the page top (breaking preferred, latest fallback). */
export async function loadHeroArticle(): Promise<Article | null> {
  const [breaking, latest] = await Promise.all([loadBreakingNews(), loadLatestNews()]);
  return selectHeroArticle(breaking.items, latest.items);
}

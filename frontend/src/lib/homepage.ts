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

/** Sections degrade independently and load from the card-shaped list feed. */
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
 * Narrow a card-shaped list row (`/matches/*?include=card`) into an EnrichedMatch.
 * A match is kept only when both teams resolve — nameless fixtures are dropped.
 */
export function toEnrichedMatch(value: unknown): EnrichedMatch | null {
  if (!isRecord(value)) return null;
  const match = value as unknown as Match;
  if (typeof match.slug !== 'string' || typeof match.status !== 'string') return null;
  const homeTeam = asTeam(value.homeTeam);
  const awayTeam = asTeam(value.awayTeam);
  if (!homeTeam || !awayTeam) return null;
  const competition = asCompetition(value.competition);
  const venue = value.venue;
  return {
    match,
    homeTeam,
    awayTeam,
    competition,
    venueName: isRecord(venue) && typeof venue.name === 'string' ? venue.name : null,
  };
}

export function toEnrichedMatches(values: unknown[]): EnrichedMatch[] {
  return values.map(toEnrichedMatch).filter((item): item is EnrichedMatch => item !== null);
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
  const list = await fetchList<unknown>('/matches/live', { limit: HOMEPAGE_LIMITS.live, include: 'card' }, HOMEPAGE_REVALIDATE.live, 'homepage:live');
  return toEnrichedSection(list.items as Match[], toEnrichedMatches(list.items), list.status);
}

export async function loadUpcomingMatches(): Promise<SectionData<EnrichedMatch>> {
  const list = await fetchList<unknown>('/matches/upcoming', { limit: HOMEPAGE_LIMITS.upcoming, include: 'card' }, HOMEPAGE_REVALIDATE.upcoming, 'homepage:upcoming');
  return toEnrichedSection(list.items as Match[], toEnrichedMatches(list.items), list.status);
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

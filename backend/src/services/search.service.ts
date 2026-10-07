import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import { log } from '../lib/logger';
import { buildPagination, paginateInput } from '../lib/pagination';
import { canonicalUrl, SEARCHABLE_ENTITY_TYPES, type SearchableEntityType } from '../lib/urls';
import { anonClient } from '../lib/supabase';
import {
  indexBy,
  listByIds,
  listWhereIn,
  COUNTRY_COLUMNS,
  COMPETITION_COLUMNS,
  TEAM_COLUMNS,
} from '../repositories/related';
import {
  searchArticles,
  searchCompetitions,
  searchMatches,
  searchPlayers,
  searchTeams,
  tokenize,
} from '../repositories/search.repo';

const NS = 'search';
const TTL = config.cache.newsTtl;
const PER_ENTITY_CAP = 25;

/** Canonical entities outrank long-form content on relevance ties. */
const ENTITY_WEIGHT: Record<SearchableEntityType, number> = {
  team: 6,
  player: 5,
  competition: 4,
  match: 3,
  news: 2,
};

export interface SearchInput {
  q: string;
  type?: SearchableEntityType;
  competitionId?: string;
  teamId?: string;
  playerId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export interface SearchResult {
  entity_type: SearchableEntityType;
  entity_id: string;
  title: string;
  slug: string;
  url: string;
  image: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  relevance: number;
}

function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 200);
}

/** Deterministic score: exact > prefix > full-query > all-tokens > any-token. */
function fieldScore(value: unknown, query: string, tokens: string[]): number {
  const field = String(value ?? '').toLowerCase();
  if (!field) return 0;
  if (field === query) return 100;
  if (field.startsWith(query)) return 70;
  if (field.includes(query)) return 55;
  if (tokens.every((token) => field.includes(token))) return 45;
  if (tokens.some((token) => field.includes(token))) return 25;
  return 0;
}

function bestScore(fields: unknown[], query: string, tokens: string[]): number {
  return Math.max(0, ...fields.map((field) => fieldScore(field, query, tokens)));
}

function rank<T extends SearchResult>(results: T[]): T[] {
  return results.sort((a, b) => b.relevance - a.relevance || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

function teamResult(row: Record<string, unknown>, query: string, tokens: string[]): SearchResult {
  const slug = String(row.slug);
  return {
    entity_type: 'team',
    entity_id: String(row.id),
    title: String(row.name ?? slug),
    slug,
    url: canonicalUrl('team', slug),
    image: (row.logo_url as string | null) ?? null,
    description: (row.short_name as string | null) ?? null,
    metadata: {},
    relevance: bestScore([row.name, row.short_name, row.slug], query, tokens) + ENTITY_WEIGHT.team,
  };
}

function playerResult(
  row: Record<string, unknown>,
  currentTeams: Map<string, Record<string, unknown>>,
  query: string,
  tokens: string[],
): SearchResult {
  const slug = String(row.slug);
  const current = currentTeams.get(String(row.id));
  return {
    entity_type: 'player',
    entity_id: String(row.id),
    title: String(row.display_name ?? slug),
    slug,
    url: canonicalUrl('player', slug),
    image: (row.photo_url as string | null) ?? null,
    description: (row.position as string | null) ?? null,
    // The current club is optional: a player with no current contract simply
    // has none, and nothing is inferred to fill the gap.
    metadata: current
      ? { current_team: { id: current.id, name: current.name, slug: current.slug } }
      : {},
    relevance:
      bestScore([row.display_name, row.first_name, row.last_name, row.slug], query, tokens) +
      ENTITY_WEIGHT.player,
  };
}

function competitionResult(
  row: Record<string, unknown>,
  countries: Map<string, Record<string, unknown>>,
  query: string,
  tokens: string[],
): SearchResult {
  const slug = String(row.slug);
  const country = row.country_id ? countries.get(String(row.country_id)) : undefined;
  return {
    entity_type: 'competition',
    entity_id: String(row.id),
    title: String(row.name ?? slug),
    slug,
    url: canonicalUrl('competition', slug),
    image: (row.logo_url as string | null) ?? null,
    description: country ? String(country.name ?? '') : null,
    metadata: country ? { country: { id: country.id, name: country.name, slug: country.slug } } : {},
    relevance: bestScore([row.name, row.short_name, row.slug], query, tokens) + ENTITY_WEIGHT.competition,
  };
}

function matchResult(
  row: Record<string, unknown>,
  teams: Map<string, Record<string, unknown>>,
  competitions: Map<string, Record<string, unknown>>,
  query: string,
  tokens: string[],
): SearchResult {
  const slug = String(row.slug);
  const home = teams.get(String(row.home_team_id));
  const away = teams.get(String(row.away_team_id));
  const competition = competitions.get(String(row.competition_id));
  const homeName = home ? String(home.short_name ?? home.name ?? '') : '';
  const awayName = away ? String(away.short_name ?? away.name ?? '') : '';
  const score =
    row.home_score !== null && row.home_score !== undefined && row.away_score !== null && row.away_score !== undefined
      ? `${String(row.home_score)} - ${String(row.away_score)}`
      : null;
  return {
    entity_type: 'match',
    entity_id: String(row.id),
    title: homeName && awayName ? `${homeName} vs ${awayName}` : slug,
    slug,
    url: canonicalUrl('match', slug),
    image: null,
    description: competition ? String(competition.name ?? '') : null,
    metadata: {
      scheduled_at: row.scheduled_at ?? null,
      status: row.status ?? null,
      score,
      home_team: home ? { id: home.id, name: home.name, slug: home.slug } : null,
      away_team: away ? { id: away.id, name: away.name, slug: away.slug } : null,
    },
    relevance: bestScore([row.slug, homeName, awayName], query, tokens) + ENTITY_WEIGHT.match,
  };
}

function articleResult(
  row: Record<string, unknown>,
  images: Map<string, Record<string, unknown>>,
  query: string,
  tokens: string[],
): SearchResult {
  const slug = String(row.slug);
  const image = row.featured_image_id ? images.get(String(row.featured_image_id)) : undefined;
  return {
    entity_type: 'news',
    entity_id: String(row.id),
    title: String(row.title ?? slug),
    slug,
    url: canonicalUrl('news', slug),
    image: image ? ((image.public_url as string | null) ?? null) : null,
    description: (row.excerpt as string | null) ?? null,
    metadata: { article_type: row.article_type ?? null, published_at: row.published_at ?? null },
    relevance: bestScore([row.title, row.excerpt, row.slug], query, tokens) + ENTITY_WEIGHT.news,
  };
}

function relationFor(
  type: SearchableEntityType | undefined,
  input: SearchInput,
): { table: string; column: string; entityId: string } | undefined {
  if (input.teamId) return { table: 'article_teams', column: 'team_id', entityId: input.teamId };
  if (input.playerId) return { table: 'article_players', column: 'player_id', entityId: input.playerId };
  if (input.competitionId)
    return { table: 'article_competitions', column: 'competition_id', entityId: input.competitionId };
  return undefined;
}

/** player id -> current club row, for the subset flagged `is_current`. */
function currentTeamIndexFrom(
  histories: Record<string, unknown>[],
  teams: Map<string, Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const history of histories) {
    if (history.is_current !== true) continue;
    const team = teams.get(String(history.team_id));
    if (team) map.set(String(history.player_id), team);
  }
  return map;
}

export const searchService = {
  async search(input: SearchInput) {
    const startedAt = Date.now();
    const query = normalize(input.q);
    const tokens = tokenize(query);
    const page = paginateInput(input.page, input.limit);
    const wanted: SearchableEntityType[] = input.type
      ? [input.type]
      : [...SEARCHABLE_ENTITY_TYPES];

    const run = async () => {
      if (tokens.length === 0) return { results: [] as SearchResult[], pagination: buildPagination(0, page) };
      const perEntity = Math.min(page.limit, PER_ENTITY_CAP);
      const degraded: SearchableEntityType[] = [];

      /** Run one entity lookup; record and swallow a failure to allow partial results. */
      const settle = async <T>(
        enabled: boolean,
        runner: () => Promise<T[]>,
        type: SearchableEntityType,
      ): Promise<T[]> => {
        if (!enabled) return [];
        try {
          return await runner();
        } catch {
          degraded.push(type);
          log({ msg: 'search_partial_failure', type, q: query });
          return [];
        }
      };

      // Each entity type settles independently: a failure in one area degrades
      // that group only, so a partial result set is still served instead of the
      // whole search failing.
      const [teamRows, playerRows, compRows, matchRows, articleRows] = await Promise.all([
        settle(wanted.includes('team'), () => searchTeams(tokens, perEntity), 'team'),
        settle(wanted.includes('player'), () => searchPlayers(tokens, perEntity), 'player'),
        settle(wanted.includes('competition'), () => searchCompetitions(tokens, perEntity), 'competition'),
        settle(
          wanted.includes('match'),
          () =>
            searchMatches(tokens, perEntity, {
              competitionId: input.competitionId,
              teamId: input.teamId,
              from: input.from,
              to: input.to,
            }),
          'match',
        ),
        settle(
          wanted.includes('news'),
          () =>
            searchArticles(tokens, perEntity, {
              from: input.from,
              to: input.to,
              relation: relationFor(input.type, input),
            }),
          'news',
        ),
      ]);

      // Bounded enrichment (no N+1): countries, match teams/competitions, player
      // current clubs, article images.
      const countryIds = compRows.map((row) => String(row.country_id)).filter(Boolean);
      const matchTeamIds = matchRows.flatMap((row) => [String(row.home_team_id), String(row.away_team_id)]);
      const matchCompIds = matchRows.map((row) => String(row.competition_id));
      const playerIds = playerRows.map((row) => String(row.id));
      const imageIds = articleRows.map((row) => String(row.featured_image_id)).filter(Boolean);
      const client = anonClient();
      const [countries, enrichTeams, enrichComps, histories, images] = await Promise.all([
        listByIds(client, 'countries', COUNTRY_COLUMNS, countryIds, undefined, 300),
        listByIds(client, 'teams', TEAM_COLUMNS, matchTeamIds, undefined, 300),
        listByIds(client, 'competitions', COMPETITION_COLUMNS, matchCompIds, undefined, 300),
        // One bounded query for every player's current club, never one per row.
        listWhereIn(client, 'player_team_history', 'player_id,team_id,is_current', 'player_id', playerIds, undefined, 300),
        listByIds(client, 'media', 'id,public_url', imageIds, undefined, 300),
      ]);

      const historyTeamIds = histories
        .filter((row) => row.is_current === true)
        .map((row) => String(row.team_id));
      const historyTeams = await listByIds(client, 'teams', TEAM_COLUMNS, historyTeamIds, undefined, 300);
      const teamIndex = indexBy([...enrichTeams, ...historyTeams]);
      const currentTeamIndex = currentTeamIndexFrom(histories, teamIndex);

      const countryIndex = indexBy(countries);
      const compIndex = indexBy(enrichComps);
      const imageIndex = indexBy(images);

      const merged: SearchResult[] = [
        ...teamRows.map((row) => teamResult(row, query, tokens)),
        ...playerRows.map((row) => playerResult(row, currentTeamIndex, query, tokens)),
        ...compRows.map((row) => competitionResult(row, countryIndex, query, tokens)),
        ...matchRows.map((row) => matchResult(row, teamIndex, compIndex, query, tokens)),
        ...articleRows.map((row) => articleResult(row, imageIndex, query, tokens)),
      ].filter((result) => result.relevance > 0);

      const ranked = rank(merged);
      const total = ranked.length;
      const results = ranked.slice(page.from, page.to + 1);
      return {
        results,
        pagination: buildPagination(total, page),
        ...(degraded.length > 0 ? { degraded } : {}),
      };
    };

    try {
      const output = await cached(
        NS,
        { q: query, type: input.type ?? 'all', c: input.competitionId, t: input.teamId, p: input.playerId, f: input.from, to: input.to, page: page.page, limit: page.limit },
        TTL,
        run,
      );
      log({
        msg: 'search',
        q: query,
        type: input.type ?? 'all',
        durationMs: Date.now() - startedAt,
        results: output.pagination.total,
        zeroResult: output.pagination.total === 0,
      });
      return output;
    } catch (error) {
      log({ msg: 'search_failed', q: query, durationMs: Date.now() - startedAt });
      throw toServiceError(error, 'Search unavailable');
    }
  },

  /** Invalidation hook for entity updates and future sync workers. */
  invalidate: () => invalidateNamespace(NS),
};

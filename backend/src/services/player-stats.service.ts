import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import { MAX_PLAYER_STAT_ROWS, getPlayerStatistics, type PlayerStatisticsPayload } from '../repositories/player-stats.repo';

const NS = 'player-stats';

/**
 * A finished match changes a player's numbers, so this window is shorter than
 * the static player cache. Still server-side cached — no live updates in this
 * phase.
 */
const TTL = Math.min(config.cache.staticTtl, config.cache.matchesTtl);

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Player statistics unavailable');
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return MAX_PLAYER_STAT_ROWS;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PLAYER_STAT_ROWS);
}

export const playerStatsService = {
  /** Every active filter is part of the cache key, so scopes never mix. */
  get: (
    slug: string,
    options: { seasonId?: string | null; competitionSlug?: string | null; limit?: number } = {},
  ) =>
    guarded(() =>
      cached(
        NS,
        {
          kind: 'player',
          slug,
          seasonId: options.seasonId ?? 'all',
          competition: options.competitionSlug ?? 'all',
          limit: clampLimit(options.limit),
        },
        TTL,
        () =>
          getPlayerStatistics(slug, {
            seasonId: options.seasonId ?? null,
            competitionSlug: options.competitionSlug ?? null,
            limit: clampLimit(options.limit),
          }),
      ),
    ),

  /** Invalidation hook for match results and future sync workers. */
  invalidate: () => invalidateNamespace(NS),
};

export type { PlayerStatisticsPayload };

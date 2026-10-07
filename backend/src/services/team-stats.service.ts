import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import { getTeamStatistics, type TeamStatisticsPayload } from '../repositories/team-stats.repo';

const NS = 'team-stats';

/** Shorter than the static team cache: a finished match changes the totals. */
const TTL = Math.min(config.cache.staticTtl, config.cache.matchesTtl);

/** Form is a fixed, small window, so the response size is bounded. */
export const MAX_FORM_RESULTS = 10;

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Team statistics unavailable');
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 5;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_FORM_RESULTS);
}

export const teamStatsService = {
  /** Season is part of the cache key so history never overwrites current totals. */
  get: (slug: string, seasonId: string | null, formLimit?: number) =>
    guarded(() =>
      cached(
        NS,
        { kind: 'team', slug, seasonId: seasonId ?? 'all', form: clampLimit(formLimit ?? 5) },
        TTL,
        () => getTeamStatistics(slug, seasonId, clampLimit(formLimit ?? 5)),
      ),
    ),

  /** Invalidation hook for match results and future sync workers. */
  invalidate: () => invalidateNamespace(NS),
};

export type { TeamStatisticsPayload };

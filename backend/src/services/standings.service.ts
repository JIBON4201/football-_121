import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import { getCompetitionStandings, type StandingsPayload } from '../repositories/standings.repo';

const NS = 'standings';

/**
 * Standings are derived from match results, so a finished match changes the
 * table. The window is therefore shorter than the static competition cache but
 * still server-side cached — this step deliberately ships no live updates or
 * streaming.
 */
const TTL = Math.min(config.cache.staticTtl, config.cache.matchesTtl);

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Standings unavailable');
  }
}

export const standingsService = {
  /**
   * Season is part of the cache key, so browsing a historical season can never
   * serve (or poison) the current season's table.
   */
  get: (slug: string, seasonId: string | null) =>
    guarded(() => cached(NS, { kind: 'competition', slug, seasonId: seasonId ?? 'current' }, TTL, () => getCompetitionStandings(slug, seasonId))),

  /** Invalidation hook for match results and future sync workers. */
  invalidate: () => invalidateNamespace(NS),
};

export type { StandingsPayload };

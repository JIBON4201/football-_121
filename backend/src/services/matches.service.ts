import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import {
  getMatchBySlug,
  getMatchDetails,
  listMatches,
  type MatchListInput,
} from '../repositories/matches.repo';

const NS = 'matches';
const TTL = config.cache.matchesTtl;

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Match service unavailable');
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export const matchesService = {
  list: (input: MatchListInput) =>
    guarded(() => cached(NS, { kind: 'list', ...input }, TTL, () => listMatches(input))),

  getBySlug: (slug: string) => guarded(() => cached(NS, { kind: 'detail', slug }, TTL, () => getMatchBySlug(slug))),

  getDetails: (slug: string) =>
    guarded(() => cached(NS, { kind: 'details', slug }, TTL, () => getMatchDetails(slug))),

  getLive: (limit: number, include?: 'card') =>
    guarded(() =>
      cached(NS, { kind: 'live', limit, include }, TTL, () =>
        listMatches({ page: 1, limit, phase: 'live', sort: 'asc', include }),
      ),
    ),

  getUpcoming: (
    limit: number,
    filters: Pick<MatchListInput, 'competition' | 'team' | 'season' | 'include'> = {},
  ) =>
    guarded(() =>
      cached(NS, { kind: 'upcoming', limit, ...filters }, TTL, () =>
        listMatches({ page: 1, limit, phase: 'upcoming', sort: 'asc', ...filters }),
      ),
    ),

  getToday: (limit: number, include?: 'card') => {
    const today = todayISO();
    return guarded(() =>
      cached(NS, { kind: 'today', limit, today, include }, TTL, () =>
        listMatches({ page: 1, limit, from: today, to: today, sort: 'asc', include }),
      ),
    );
  },

  getFinished: (limit: number, include?: 'card') =>
    guarded(() =>
      cached(NS, { kind: 'finished', limit, include }, TTL, () =>
        listMatches({ page: 1, limit, phase: 'finished', sort: 'desc', include }),
      ),
    ),

  /** Invalidation hook for match updates and future live-sync workers. */
  invalidate: () => invalidateNamespace(NS),
};

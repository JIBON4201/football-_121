import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import {
  getCompetitionBySlug,
  getCompetitionDetails,
  listCompetitions,
  type CompetitionListInput,
} from '../repositories/competitions.repo';

const NS = 'competitions';
const TTL = config.cache.staticTtl;

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Competition service unavailable');
  }
}

export const competitionsService = {
  list: (input: CompetitionListInput) =>
    guarded(() => cached(NS, { kind: 'list', ...input }, TTL, () => listCompetitions(input))),

  getBySlug: (slug: string) =>
    guarded(() => cached(NS, { kind: 'detail', slug }, TTL, () => getCompetitionBySlug(slug))),

  getDetails: (slug: string) =>
    guarded(() => cached(NS, { kind: 'details', slug }, TTL, () => getCompetitionDetails(slug))),

  /** Invalidation hook for competition updates and future sync workers. */
  invalidate: () => invalidateNamespace(NS),
};

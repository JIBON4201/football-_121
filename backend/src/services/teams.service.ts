import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import { getTeamBySlug, getTeamDetails, listTeams, type TeamListInput } from '../repositories/teams.repo';

const NS = 'teams';
const TTL = config.cache.staticTtl;

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Team service unavailable');
  }
}

export const teamsService = {
  list: (input: TeamListInput) => guarded(() => cached(NS, { kind: 'list', ...input }, TTL, () => listTeams(input))),

  getBySlug: (slug: string) => guarded(() => cached(NS, { kind: 'detail', slug }, TTL, () => getTeamBySlug(slug))),

  getDetails: (slug: string) =>
    guarded(() => cached(NS, { kind: 'details', slug }, TTL, () => getTeamDetails(slug))),

  /** Invalidation hook for team updates and future sync workers. */
  invalidate: () => invalidateNamespace(NS),
};

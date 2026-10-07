import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import {
  getPlayerBySlug,
  getPlayerDetails,
  listPlayers,
  type PlayerListInput,
} from '../repositories/players.repo';

const NS = 'players';
const TTL = config.cache.staticTtl;

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Player service unavailable');
  }
}

export const playersService = {
  list: (input: PlayerListInput) =>
    guarded(() => cached(NS, { kind: 'list', ...input }, TTL, () => listPlayers(input))),

  getBySlug: (slug: string) => guarded(() => cached(NS, { kind: 'detail', slug }, TTL, () => getPlayerBySlug(slug))),

  getDetails: (slug: string) =>
    guarded(() => cached(NS, { kind: 'details', slug }, TTL, () => getPlayerDetails(slug))),

  /** Invalidation hook for player updates and future sync workers. */
  invalidate: () => invalidateNamespace(NS),
};

import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import {
  getTransferById,
  getTransferDetails,
  listTransferWindows,
  listTransfers,
  type TransferDetails,
  type TransferListInput,
} from '../repositories/transfers.repo';

const NS = 'transfers';
const TTL = config.cache.newsTtl;

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Transfer service unavailable');
  }
}

export const transfersService = {
  list: (input: TransferListInput) =>
    guarded(() => cached(NS, { kind: 'list', ...input }, TTL, () => listTransfers(input))),

  getById: (id: string) => guarded(() => cached(NS, { kind: 'record', id }, TTL, () => getTransferById(id))),

  /** Aggregated page payload; cached per id like the raw record. */
  getDetails: (id: string) =>
    guarded(() => cached(NS, { kind: 'details', id }, TTL, () => getTransferDetails(id))),

  /** Window lists are cached too, so a filter dropdown is not a full query. */
  listWindows: (input: { page: number; limit: number; season?: string }) =>
    guarded(() => cached(NS, { kind: 'windows', ...input }, TTL, () => listTransferWindows(input))),

  /** Invalidation hook for transfer updates and future sync workers. */
  invalidate: () => invalidateNamespace(NS),
};

export type { TransferDetails, TransferListInput };

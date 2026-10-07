import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import {
  getCategoryBySlug,
  listCategories,
  type CategoryListInput,
} from '../repositories/categories.repo';

const NS = 'categories';
const TTL = config.cache.staticTtl;

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Category service unavailable');
  }
}

export const categoriesService = {
  list: (input: CategoryListInput) =>
    guarded(() => cached(NS, { kind: 'list', ...input }, TTL, () => listCategories(input))),

  getBySlug: (slug: string) => guarded(() => cached(NS, { kind: 'detail', slug }, TTL, () => getCategoryBySlug(slug))),

  invalidate: () => invalidateNamespace(NS),
};

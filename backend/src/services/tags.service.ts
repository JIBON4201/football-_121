import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import { getTagBySlug, listTags, type TagListInput } from '../repositories/tags.repo';

const NS = 'tags';
const TTL = config.cache.staticTtl;

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Tag service unavailable');
  }
}

export const tagsService = {
  list: (input: TagListInput) => guarded(() => cached(NS, { kind: 'list', ...input }, TTL, () => listTags(input))),

  getBySlug: (slug: string) => guarded(() => cached(NS, { kind: 'detail', slug }, TTL, () => getTagBySlug(slug))),

  invalidate: () => invalidateNamespace(NS),
};

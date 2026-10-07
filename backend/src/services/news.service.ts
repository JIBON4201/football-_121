import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import { getNewsBySlug, listNews, type NewsListInput } from '../repositories/news.repo';

const NS = 'news';
const TTL = config.cache.newsTtl;

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'News service unavailable');
  }
}

export const newsService = {
  list: (input: NewsListInput) => guarded(() => cached(NS, { kind: 'list', ...input }, TTL, () => listNews(input))),

  getBySlug: (slug: string) => guarded(() => cached(NS, { kind: 'detail', slug }, TTL, () => getNewsBySlug(slug))),

  getLatest: (limit: number) =>
    guarded(() => cached(NS, { kind: 'latest', limit }, TTL, () => listNews({ page: 1, limit, sort: 'desc' }))),

  getBreaking: (limit: number) =>
    guarded(() =>
      cached(NS, { kind: 'breaking', limit }, TTL, () =>
        listNews({ page: 1, limit, sort: 'desc', breaking: true }),
      ),
    ),

  /** Invalidation hook for article updates/publishing and future sync workers. */
  invalidate: () => invalidateNamespace(NS),
};

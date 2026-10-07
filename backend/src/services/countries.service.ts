import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError } from '../lib/errors';
import {
  getCountryBySlug,
  listCountries,
  type CountryListInput,
} from '../repositories/countries.repo';

const NS = 'countries';
const TTL = config.cache.staticTtl;

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Country service unavailable');
  }
}

export const countriesService = {
  list: (input: CountryListInput) =>
    guarded(() => cached(NS, { kind: 'list', ...input }, TTL, () => listCountries(input))),

  getBySlug: (slug: string) => guarded(() => cached(NS, { kind: 'detail', slug }, TTL, () => getCountryBySlug(slug))),

  invalidate: () => invalidateNamespace(NS),
};
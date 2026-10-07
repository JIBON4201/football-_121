import { notFound, upstream } from '../lib/errors';
import { buildPagination, paginateInput } from '../lib/pagination';
import { anonClient } from '../lib/supabase';
import { escapeIlike } from '../lib/validate';

const COLUMNS = 'id,name,slug,code,flag_url';

export interface CountryListInput {
  page: number;
  limit: number;
  q?: string;
}

/**
 * Public country reference list.
 *
 * Countries are the one relationship with no route of its own: team, player and
 * competition repositories each join `countries` internally to enrich a detail
 * response, but nothing exposed the set, so the Control Center could only offer
 * a hardcoded or empty country picker on those forms. Read via the anon client
 * because `countries_select_public` already grants `SELECT` to `anon` — the
 * same policy that backs teams and competitions.
 */
export async function listCountries(input: CountryListInput) {
  const page = paginateInput(input.page, input.limit);
  let query = anonClient().from('countries').select(COLUMNS, { count: 'exact' });

  if (input.q) {
    const term = escapeIlike(input.q);
    if (term.length > 0) query = query.or(`name.ilike.%${term}%,slug.ilike.%${term}%,code.ilike.%${term}%`);
  }

  const { data, error, count } = await query
    .order('name', { ascending: true })
    .order('id', { ascending: true })
    .range(page.from, page.to);
  if (error) throw upstream('Failed to load countries');
  return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
}

export async function getCountryBySlug(slug: string) {
  const { data, error } = await anonClient().from('countries').select(COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw upstream('Failed to load country');
  if (!data) throw notFound('Country');
  return data;
}
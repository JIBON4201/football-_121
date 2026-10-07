import { notFound, upstream } from '../lib/errors';
import { buildPagination, paginateInput } from '../lib/pagination';
import { anonClient } from '../lib/supabase';
import { escapeIlike } from '../lib/validate';

const COLUMNS = 'id,name,slug';

export interface TagListInput {
  page: number;
  limit: number;
  q?: string;
}

export async function listTags(input: TagListInput) {
  const page = paginateInput(input.page, input.limit);
  let query = anonClient().from('tags').select(COLUMNS, { count: 'exact' });

  if (input.q) {
    const term = escapeIlike(input.q);
    if (term.length > 0) query = query.or(`name.ilike.%${term}%,slug.ilike.%${term}%`);
  }

  const { data, error, count } = await query
    .order('name', { ascending: true })
    .order('id', { ascending: true })
    .range(page.from, page.to);
  if (error) throw upstream('Failed to load tags');
  return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
}

export async function getTagBySlug(slug: string) {
  const { data, error } = await anonClient().from('tags').select(COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw upstream('Failed to load tag');
  if (!data) throw notFound('Tag');
  return data;
}

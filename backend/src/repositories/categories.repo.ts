import { notFound, upstream } from '../lib/errors';
import { buildPagination, paginateInput } from '../lib/pagination';
import { anonClient } from '../lib/supabase';
import { escapeIlike } from '../lib/validate';

const COLUMNS = 'id,name,slug,description,parent_id,image_url,is_active';

export interface CategoryListInput {
  page: number;
  limit: number;
  q?: string;
}

/** Public categories are active-only, mirroring RLS. */
export async function listCategories(input: CategoryListInput) {
  const page = paginateInput(input.page, input.limit);
  let query = anonClient().from('categories').select(COLUMNS, { count: 'exact' }).eq('is_active', true);

  if (input.q) {
    const term = escapeIlike(input.q);
    if (term.length > 0) query = query.or(`name.ilike.%${term}%,slug.ilike.%${term}%`);
  }

  const { data, error, count } = await query
    .order('name', { ascending: true })
    .order('id', { ascending: true })
    .range(page.from, page.to);
  if (error) throw upstream('Failed to load categories');
  return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
}

export async function getCategoryBySlug(slug: string) {
  const { data, error } = await anonClient()
    .from('categories')
    .select(COLUMNS)
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw upstream('Failed to load category');
  if (!data) throw notFound('Category');
  return data;
}

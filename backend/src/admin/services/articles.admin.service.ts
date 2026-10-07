/**
 * Step 5 — Admin articles read service (all statuses, incl. drafts).
 * Extended filters: category (article_categories join), author, featured,
 * created-date range, sort. All bounded via shared adminList().
 */
import { serviceClient } from '../../lib/supabase';
import { escapeIlike } from '../../lib/validate';
import { adminList, type AdminListInput } from './_list';

const COLUMNS =
  'id,slug,title,excerpt,status,article_type,author_id,featured_image_id,published_at,scheduled_at,is_breaking,is_featured,view_count,created_at,updated_at';

export interface AdminArticlesInput extends AdminListInput {
  q?: string;
  status?: string;
  article_type?: string;
  categoryId?: string;
  authorId?: string;
  featured?: boolean;
  from?: string;
  to?: string;
  sort?: string;
  order?: string;
}

async function articleIdsForCategory(categoryId: string): Promise<string[] | null> {
  const { data, error } = (await serviceClient()
    .from('article_categories')
    .select('article_id')
    .eq('category_id', categoryId)
    .range(0, 499)) as unknown as {
    data: Array<{ article_id: string }> | null;
    error: unknown;
  };
  if (error) return null;
  return (data ?? []).map((row) => row.article_id);
}

export const adminArticlesService = {
  list: async (input: AdminArticlesInput) => {
    let categoryIds: string[] | null | undefined;
    if (input.categoryId) {
      categoryIds = await articleIdsForCategory(input.categoryId);
      // Unknown category (or none linked) yields an empty page, never an error.
      if (categoryIds === null || categoryIds.length === 0) {
        const { buildPagination, paginateInput } = await import('../../lib/pagination');
        const page = paginateInput(input.page, input.limit);
        return { rows: [], pagination: buildPagination(0, page) };
      }
    }
    return adminList(
      'articles',
      COLUMNS,
      input,
      (query) => {
        let q = query;
        if (categoryIds) q = q.in('id', categoryIds);
        if (input.authorId) q = q.eq('author_id', input.authorId);
        if (input.featured !== undefined) q = q.eq('is_featured', input.featured);
        if (input.q) {
          const term = escapeIlike(input.q);
          if (term.length > 0) q = q.or(`title.ilike.%${term}%,slug.ilike.%${term}%`);
        }
        if (input.status) q = q.eq('status', input.status);
        if (input.article_type) q = q.eq('article_type', input.article_type);
        if (input.from) q = q.gte('created_at', `${input.from}T00:00:00.000Z`);
        if (input.to) q = q.lte('created_at', `${input.to}T23:59:59.999Z`);
        return q;
      },
      (query) => {
        const sorts: Record<string, string> = {
          created_at: 'created_at',
          published_at: 'published_at',
          updated_at: 'updated_at',
        };
        const col = sorts[input.sort ?? ''] ?? 'created_at';
        const asc = (input.order ?? 'desc') === 'asc';
        return query.order(col, { ascending: asc });
      },
    );
  },
};

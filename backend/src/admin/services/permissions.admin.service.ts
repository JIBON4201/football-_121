/**
 * Step 13 — Admin permission catalogue (read-only).
 * The catalogue is immutable by design: keys are seeded by migration and
 * grants change only through PUT /roles/:id/permissions (roles.manage).
 */
import { toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';

const COLUMNS = 'id,key,resource,action,description,created_at';

export interface AdminPermissionListInput {
  page: number;
  limit: number;
}

export const adminPermissionsService = {
  list: async (input: AdminPermissionListInput) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = serviceClient() as any;
      const page = paginateInput(input.page, input.limit);
      const { data, error, count } = await client
        .from('admin_permissions')
        .select(COLUMNS, { count: 'exact' })
        .order('key', { ascending: true })
        .range(page.from, page.to);
      if (error) throw new Error('permission list failed');
      return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Permission service unavailable');
    }
  },
};

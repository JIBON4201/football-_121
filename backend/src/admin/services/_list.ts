/**
 * Step 4 — Shared bounded list executor for admin read services.
 *
 * Every admin list goes through here: paginateInput() clamps page/limit
 * (max 100), queries always carry an explicit .range(), and driver errors
 * become sanitized 503s (never SQL internals). No caching — admin reads
 * must be fresh (routes are noStore()).
 */
import { toServiceError, upstream } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';

export interface AdminListInput {
  page: number;
  limit: number;
}

// Supabase query-builder chaining is intentionally untyped here, mirroring
// the existing repositories (postgrest-js filter DSL, no generated types).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;

export async function adminList(
  table: string,
  columns: string,
  input: AdminListInput,
  apply?: (query: AnyQuery) => AnyQuery,
  order?: (query: AnyQuery) => AnyQuery,
): Promise<{ rows: unknown[]; pagination: ReturnType<typeof buildPagination> }> {
  const guarded = async () => {
    const client = serviceClient();
    const page = paginateInput(input.page, input.limit);
    let query = client.from(table).select(columns, { count: 'exact' }) as AnyQuery;
    if (apply) query = apply(query);
    query = order
      ? order(query)
      : (query.order('created_at', { ascending: false }) as AnyQuery);
    const { data, error, count } = (await query
      .order('id', { ascending: false })
      .range(page.from, page.to)) as unknown as {
      data: unknown[] | null;
      error: unknown;
      count: number | null;
    };
    if (error) throw upstream(`Failed to load ${table}`);
    return { rows: data ?? [], pagination: buildPagination(count ?? 0, page) };
  };
  try {
    return await guarded();
  } catch (error) {
    throw toServiceError(error, `${table} service unavailable`);
  }
}

/** Bounded exact-count probe: selects one row, returns the total. */
export async function adminCount(
  table: string,
  apply?: (query: AnyQuery) => AnyQuery,
): Promise<number> {
  try {
    let query = serviceClient().from(table).select('id', { count: 'exact' }) as AnyQuery;
    if (apply) query = apply(query);
    const { count, error } = (await query.range(0, 0)) as unknown as {
      count: number | null;
      error: unknown;
    };
    if (error) throw upstream(`Failed to count ${table}`);
    return count ?? 0;
  } catch (error) {
    throw toServiceError(error, `${table} service unavailable`);
  }
}

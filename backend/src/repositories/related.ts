import { upstream } from '../lib/errors';
import type { DbClient } from '../lib/supabase';

/**
 * Shared batched data-access helpers for detail aggregations.
 * Every method issues a fixed number of queries — related rows are
 * fetched with IN/limited queries, never one-per-row (no N+1).
 *
 * Step 41: `limit` is REQUIRED on every list helper. An omitted bound used to
 * produce a fully unbounded query, which is unsafe on public detail endpoints
 * (e.g. a team's full `player_team_history` grows forever, and the follow-up
 * `in=(...)` lookup then embeds thousands of ids in the request URL).
 * Making the parameter mandatory means the compiler forces every call site to
 * state its bound.
 */

/** Hard ceiling applied to every related-row query, whatever the caller asks for. */
export const MAX_RELATED_ROWS = 500;

/**
 * PostgREST encodes `in=(...)` into the query string. Very large lists produce
 * over-long URLs that are rejected or truncated by proxies, so the id set is
 * capped defensively. Callers derive these ids from an already-bounded parent
 * query, so this is a safety net rather than the primary bound.
 */
export const MAX_IN_CLAUSE_IDS = 300;

export const TEAM_COLUMNS =
  'id,name,short_name,slug,country_id,logo_url,founded_year,venue_id,website_url,is_active';
export const PLAYER_COLUMNS =
  'id,first_name,last_name,display_name,slug,date_of_birth,nationality_id,' +
  'position,preferred_foot,height_cm,photo_url,status';
export const COMPETITION_COLUMNS = 'id,name,short_name,slug,country_id,logo_url,type,gender,is_active';
export const SEASON_COLUMNS = 'id,competition_id,name,start_date,end_date,is_current';
export const VENUE_COLUMNS = 'id,name,slug,city,country_id,capacity,image_url,latitude,longitude';
export const COUNTRY_COLUMNS = 'id,code,name,slug,flag_url';

export interface OrderSpec {
  col: string;
  asc: boolean;
}

export async function maybeById(
  client: DbClient,
  table: string,
  columns: string,
  id: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const { data, error } = await client.from(table).select(columns).eq('id', id).maybeSingle();
  if (error) throw upstream(`Failed to load ${table}`);
  return (data as Record<string, unknown> | null) ?? null;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.floor(limit), MAX_RELATED_ROWS);
}

function clampIds(ids: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= MAX_IN_CLAUSE_IDS) break;
  }
  return unique;
}

/**
 * Fetch rows by id set. `limit` is required and always applied.
 */
export async function listByIds(
  client: DbClient,
  table: string,
  columns: string,
  ids: readonly string[],
  order: OrderSpec | undefined,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const unique = clampIds(ids);
  if (unique.length === 0) return [];
  let query = client.from(table).select(columns).in('id', unique);
  if (order) query = query.order(order.col, { ascending: order.asc });
  const { data, error } = await query.range(0, clampLimit(limit) - 1);
  if (error) throw upstream(`Failed to load ${table}`);
  return ((data as unknown as Record<string, unknown>[] | null) ?? []);
}

/**
 * Fetch rows for a set of values in one column. `limit` is required and
 * always applied.
 */
export async function listWhereIn(
  client: DbClient,
  table: string,
  columns: string,
  column: string,
  values: readonly string[],
  order: OrderSpec | undefined,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const unique = clampIds(values);
  if (unique.length === 0) return [];
  let query = client.from(table).select(columns).in(column, unique);
  if (order) query = query.order(order.col, { ascending: order.asc });
  const { data, error } = await query.range(0, clampLimit(limit) - 1);
  if (error) throw upstream(`Failed to load ${table}`);
  return ((data as unknown as Record<string, unknown>[] | null) ?? []);
}

/**
 * Fetch rows matching a single column value. `limit` is required and always
 * applied — this is the helper that previously allowed unbounded reads.
 */
export async function listBy(
  client: DbClient,
  table: string,
  columns: string,
  column: string,
  value: string | boolean,
  order: OrderSpec | undefined,
  limit: number,
): Promise<Record<string, unknown>[]> {
  let query = client.from(table).select(columns).eq(column, value);
  if (order) query = query.order(order.col, { ascending: order.asc });
  const { data, error } = await query.range(0, clampLimit(limit) - 1);
  if (error) throw upstream(`Failed to load ${table}`);
  return ((data as unknown as Record<string, unknown>[] | null) ?? []);
}

export function indexBy(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) map.set(String(row.id), row);
  return map;
}
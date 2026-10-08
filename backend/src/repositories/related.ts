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

/**
 * Canonical uuid shape.
 *
 * This exists because of a real production failure mode: callers derive id
 * lists from nullable foreign keys with `String(row.some_uuid)`, and
 * `String(null)` is the four-character *truthy* string `"null"`. PostgREST then
 * serialises it into the request as `id=in.(null)` and Postgres rejects the
 * entire query with `22P02 invalid input syntax for type uuid: "null"` — taking
 * down the whole endpoint, not just the one row.
 *
 * Because `"null"` is truthy, a downstream `.filter(Boolean)` or falsy check
 * does not catch it. Only a shape check does.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Collect the well-formed uuids from a list of raw column values.
 *
 * Replaces `.map((row) => String(row.some_uuid))` at call sites, which is the
 * direct cause of the 22P02 failures. SQL NULL, the strings `"null"` /
 * `"undefined"`, and any other non-uuid value are dropped. Duplicates are
 * removed and input order is preserved.
 */
export function uuidList(values: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!UUID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * De-duplicate and bound an id list.
 *
 * Only strings are considered: `listWhereIn` is also used for slug and country
 * code lookups, so shape is validated by the caller (`uuidList`) rather than
 * here.
 */
function clampIds(ids: readonly unknown[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
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
  ids: readonly unknown[],
  order: OrderSpec | undefined,
  limit: number,
): Promise<Record<string, unknown>[]> {
  // `id` is always the uuid primary key here, so this is the last line of
  // defence: a value that is not a well-formed uuid is dropped rather than
  // handed to Postgres, which would reject the whole query with 22P02.
  const unique = clampIds(uuidList(ids));
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
  values: readonly unknown[],
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
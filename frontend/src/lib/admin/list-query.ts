/**
 * URL → list-query parsing for the Control Center list pages.
 *
 * Filtering and paging live in the URL so a view is linkable and survives a
 * refresh. Values are clamped here rather than trusted: `limit` is capped at the
 * backend's own maximum and `page` at a sane bound, so a hand-edited query cannot
 * ask for an unbounded scan.
 *
 * Lives outside `app/` because App Router pages may only export the allowed
 * names (`default`, `metadata`, `generateMetadata`, route segment config).
 */

export interface ListQuery {
  page: number;
  limit: number;
  q?: string;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse a positive integer, falling back when the input is not one.
 *
 * A non-positive or non-numeric value is treated as absent rather than clamped:
 * `limit=-5` becoming `1` would silently request a single row and look like data
 * loss. Values above `max` are still clamped, because an oversized page size is
 * a legitimate request for "as many as allowed".
 */
function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

/** Trim and cap a search term; returns undefined when effectively empty. */
function readSearch(value: string | undefined, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

/** Only `true`/`false` pass through; anything else is treated as "no filter". */
export function readBoolean(value: string | string[] | undefined): boolean | undefined {
  const raw = first(value);
  return raw === 'true' ? true : raw === 'false' ? false : undefined;
}

/** Only well-formed UUIDs pass through, so a bad URL cannot reach the API. */
export function readUuid(value: string | string[] | undefined): string | undefined {
  const raw = first(value);
  return raw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : undefined;
}

export function readListQuery(
  params: Record<string, string | string[] | undefined>,
  options: { defaultLimit?: number; extra?: Record<string, string | string[] | undefined> } = {},
): ListQuery {
  const query = {
    page: clampInt(first(params.page), 1, 1, 10_000),
    limit: clampInt(first(params.limit), options.defaultLimit ?? 20, 1, 100),
    q: readSearch(first(params.q)),
  } as ListQuery & Record<string, string | undefined>;

  for (const [key, value] of Object.entries(options.extra ?? {})) {
    const read = readSearch(first(value), 300);
    if (read) query[key] = read;
  }
  return query;
}

/** Query params for pagination links, dropping empty values. */
export function toSearchParams(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const raw = first(value);
    if (raw) search.set(key, raw);
  }
  return search;
}
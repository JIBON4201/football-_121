/**
 * Client-safe option types and pure helpers.
 *
 * This module deliberately imports nothing. Client components need the *shape* of
 * a relationship option list — never the fetchers, which read cookies via
 * `next/headers` and are server-only.
 *
 * Why it exists: `lib/admin/options.ts` and `lib/admin/transfers.ts` are
 * server-only (they import `admin-session` → `next/headers`). Importing even
 * their types from a `'use client'` component pulled that chain into the client
 * graph and failed the build with "You're importing a component that needs
 * next/headers", which took out `/control-center/matches/new`,
 * `/transfers/new` and `/teams/new` — the create forms could never render.
 *
 * This mirrors the convention already documented in `lib/admin/articles.ts`:
 * "client components must import from './article-query' directly (this module is
 * server-only)".
 */

/** One entry in a relationship `<select>`. */
export interface OptionRow {
  id: string;
  label: string;
}

/**
 * Adapt options for `ResourceForm`, which keys selects by `value` (what the
 * backend expects on the wire) rather than `id`.
 */
export function toFieldOptions(rows: OptionRow[]): Array<{ value: string; label: string }> {
  return rows.map((row) => ({ value: row.id, label: row.label }));
}

/** Index options by id so a list row can render a foreign key as a name. */
export type LabelLookup = Map<string, string>;

export function toLabelLookup(rows: OptionRow[]): LabelLookup {
  return new Map(rows.map((row) => [row.id, row.label]));
}
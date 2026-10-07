/**
 * Step 4 — Shared admin list-query building blocks.
 *
 * Composes the project's existing validation primitives (page/limit/search/
 * sort/order, slug/uuid/date/enums) so every admin list endpoint validates
 * before touching the database. Limits are clamped server-side by
 * paginateInput() (max 100) — unrestricted queries are impossible.
 */
import { z } from 'zod';
import { limitSchema, pageSchema, searchSchema, sortOrderSchema } from '../lib/validate';

/** Base pagination for every admin list endpoint. */
export const adminListBase = {
  page: pageSchema,
  limit: limitSchema,
};

/** Base pagination + free-text search. */
export const adminSearchBase = {
  ...adminListBase,
  q: searchSchema,
};

/** Sortable-list helper: whitelisted sort column + asc/desc. */
export function adminSort(fields: readonly [string, ...string[]]) {
  return { sort: z.enum(fields as unknown as [string, ...string[]]).optional(), order: sortOrderSchema };
}

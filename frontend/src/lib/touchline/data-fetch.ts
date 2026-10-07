import { apiGet, type ApiRequestOptions } from "./api-client";
import type { ApiEnvelope, PaginationMeta } from "@/types/api";

/**
 * Server-side fetch helpers shared by the data layer.
 *
 * All calls go through `api-client`. A fresh envelope is never assumed: list
 * helpers tolerate a missing or non-array `data`, and every caller degrades to an
 * empty result rather than throwing, so one failing feed never takes down a page.
 */
export interface FetchListOptions extends ApiRequestOptions {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  rows: T[];
  pagination: PaginationMeta;
}

const FALLBACK_LIMIT = 20;

/** The API clamps `limit` to 100. Mirrored here so the UI never asks for more. */
export const MAX_PAGE_SIZE = 100;

export function normalisePageParams(options: FetchListOptions): { page: number; limit: number } {
  const page = Number.isInteger(options.page) && (options.page as number) > 0 ? (options.page as number) : 1;
  const limit = Number.isInteger(options.limit) && (options.limit as number) > 0
    ? Math.min(options.limit as number, MAX_PAGE_SIZE)
    : FALLBACK_LIMIT;
  return { page, limit };
}

/** Fetches a list endpoint and normalises the envelope into rows + pagination. */
export async function fetchList<T>(path: string, options: FetchListOptions = {}): Promise<PaginatedResult<T>> {
  const { page, limit } = normalisePageParams(options);
  // `page` and `limit` travel as query parameters, so they are removed from the
  // passthrough rather than forwarded as top-level request options.
  const rest: FetchListOptions = { ...options };
  delete rest.page;
  delete rest.limit;
  const envelope = await apiGet<T[]>(path, { ...rest, query: { page, limit, ...rest.query } });
  return toPaginated<T>(envelope, page, limit);
}

/** Unwraps an envelope defensively. A malformed list becomes an empty list. */
export function toPaginated<T>(envelope: { data: unknown; pagination?: PaginationMeta }, page: number, limit: number): PaginatedResult<T> {
  const rows = (Array.isArray(envelope.data) ? envelope.data : []) as T[];
  return {
    rows,
    pagination: envelope.pagination ?? { page, limit, total: rows.length, totalPages: rows.length === 0 ? 0 : 1 },
  };
}

/** Narrowing helper for list rows: the API returns untyped JSON. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean {
  return value === true;
}

/** Narrows an API list to rows that at least have the identity fields the UI links on. */
export function hasIdentity<T extends { slug: string }>(row: T | null | undefined): row is T {
  return isRecord(row) && typeof row.slug === "string" && row.slug.length > 0;
}

/** A failed feed is reported as an empty result so the page keeps rendering. */
export async function fetchListSafely<T>(path: string, options: FetchListOptions = {}): Promise<PaginatedResult<T>> {
  try {
    return await fetchList<T>(path, options);
  } catch {
    const { page, limit } = normalisePageParams(options);
    return { rows: [], pagination: { page, limit, total: 0, totalPages: 0 } };
  }
}

export type { ApiEnvelope };
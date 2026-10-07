/**
 * Shared Control Center data access.
 *
 * Every admin module needs the same five things: list with pagination and
 * filters, read one, create, update, delete — each mapping HTTP status onto a
 * UI state. That was hand-rolled per entity in `articles.ts`, `matches.ts` and
 * `transfers.ts`, which is how the same `fetchPublicList` helper ended up copied
 * three times and the status mapping drifted. This module is the single seam.
 *
 * Transport, retries and envelope handling stay in `lib/api-client`; the
 * backend remains the only authority on filtering, validation and authorization.
 * Nothing here writes to Supabase directly.
 */
import { ApiClientError, createApiClient } from '@/lib/api-client';
import { getAdminAccessToken } from '@/lib/admin-session';
import { siteConfig } from '@/config/site';

/**
 * UI-facing outcome. Deliberately distinct states rather than a single
 * `error: string` so pages can send an expired session back to the login form,
 * render an access-denied panel, surface field problems, and explain a conflict
 * — none of which should share one code path.
 */
export type AdminResult<T> =
  | { status: 'ok'; data: T }
  /** No valid session — redirect to login. */
  | { status: 'unauthenticated' }
  /** Authenticated but the backend refused on RBAC grounds — show AccessDenied. */
  | { status: 'forbidden' }
  /** The record does not exist, or is not visible to this admin. */
  | { status: 'not-found' }
  /** Referential integrity or state-machine refusal (e.g. "has dependents"). */
  | { status: 'conflict'; message: string }
  /** Backend rejected the payload — map `fields` back onto form inputs. */
  | { status: 'invalid'; message: string; fields?: Record<string, string> }
  /** Throttled. `retryAfterSeconds` lets the UI say when to try again. */
  | { status: 'rate-limited'; message: string; retryAfterSeconds?: number }
  | { status: 'error'; message: string };

export interface AdminPage<T> {
  rows: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * Every non-success outcome, as a reusable union.
 *
 * Resource-specific result types intersect this with their own `{ status: 'ok' }`
 * branch so a caller can narrow exhaustively:
 * `if (result.status !== 'ok') return render(result);`
 * That exhaustiveness is the point — it is what stops a page from forgetting a
 * case and silently rendering an empty table where a conflict should be shown.
 */
export type AdminFailure =
  /** No valid session — redirect to login. */
  | { status: 'unauthenticated' }
  /** Authenticated but refused on RBAC grounds — show AccessDenied. */
  | { status: 'forbidden' }
  /** The record does not exist, or is not visible to this admin. */
  | { status: 'not-found' }
  /** Referential integrity or state-machine refusal (e.g. "has dependents"). */
  | { status: 'conflict'; message: string }
  /** Payload rejected — map `fields` back onto form inputs. */
  | { status: 'invalid'; message: string; fields?: Record<string, string> }
  /** Throttled. */
  | { status: 'rate-limited'; message: string; retryAfterSeconds?: number }
  | { status: 'error'; message: string };

/** Pagination block reused by the list-shaped results. */
export interface AdminPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type AdminListQuery = Record<string, string | number | boolean | undefined>;

/**
 * Operator-facing text for any failure state.
 *
 * Lets a page handle `unauthenticated` and `forbidden` specially and then
 * collapse everything else into one banner, instead of writing a branch per
 * status and risking a silently unhandled case.
 */
export function adminFailureMessage(failure: AdminFailure): string {
  switch (failure.status) {
    case 'unauthenticated':
      return 'Your session has expired. Please sign in again.';
    case 'forbidden':
      return 'You do not have permission to perform this action.';
    case 'not-found':
      return 'That record no longer exists.';
    case 'conflict':
      return failure.message;
    case 'invalid':
      return failure.message;
    case 'rate-limited':
      return failure.retryAfterSeconds
        ? `Too many requests. Try again in ${failure.retryAfterSeconds}s.`
        : failure.message;
    default:
      return failure.message;
  }
}

/** Minimal option shape for relationship selects. */
export interface OptionRow {
  id: string;
  label: string;
}

/** Server-only: attaches the admin Bearer token to every request. */
export function adminClient() {
  return createApiClient({
    baseUrl: siteConfig.apiUrl,
    // Read fresh on each call so a rotated session is picked up immediately.
    getToken: () => getAdminAccessToken() ?? null,
  });
}

/**
 * Map a transport failure onto a UI state.
 *
 * Message policy: 4xx bodies come from the backend's own validation and
 * permission layer and are written for an authenticated operator, so they are
 * shown. 5xx bodies are sanitized server-side but can still carry driver text
 * (`UPSTREAM_ERROR` wraps a PostgREST failure), so those are replaced with a
 * fixed string plus the request id an operator can quote in a bug report.
 */
export function toAdminError(error: unknown, fallback: string): AdminFailure {
  if (!(error instanceof ApiClientError)) {
    return { status: 'error', message: fallback };
  }

  switch (error.status) {
    case 401:
      return { status: 'unauthenticated' };
    case 403:
      return { status: 'forbidden' };
    case 404:
      return { status: 'not-found' };
    case 409:
      return { status: 'conflict', message: error.message || 'That change conflicts with existing data.' };
    // The backend rejects schema violations with 400 VALIDATION_ERROR carrying a
    // Zod `flatten()` payload; 422 is accepted too in case a provider surfaces it.
    case 400:
    case 422:
      return {
        status: 'invalid',
        message: error.fields
          ? 'Some fields need attention.'
          : error.message || 'Some fields need attention.',
        fields: error.fields,
      };
    case 429:
      return {
        status: 'rate-limited',
        message: 'Too many requests. Wait a moment and try again.',
        retryAfterSeconds: error.retryAfterSeconds,
      };
    default:
      break;
  }

  if (error.status >= 500) {
    return {
      status: 'error',
      message: error.requestId
        ? `The server could not complete this request (reference ${error.requestId}).`
        : 'The server could not complete this request.',
    };
  }

  // Timeout and offline never reach here with a status; surface them plainly.
  if (error.isTimeout) return { status: 'error', message: 'The request timed out. Check your connection and retry.' };
  if (error.isNetworkError) return { status: 'error', message: 'Could not reach the API. Check that the backend is running.' };

  return { status: 'error', message: error.message || fallback };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Coerce one API row into `T`, dropping it when the identity field is missing.
 * A malformed row must not become a table cell full of `undefined`, and an
 * unknown id is never renderable.
 */
function normalizeRow<T extends { id: string }>(row: unknown): T | null {
  if (!isObject(row) || typeof row.id !== 'string') return null;
  return row as T;
}

/**
 * Build the five operations for one admin resource.
 *
 * `label` is the human noun used in fallback messages ("Team", "Match"); it is
 * never used to build a URL, so it is safe to change for presentation.
 */
export function createAdminResource<T extends { id: string }, Create = Record<string, unknown>, Update = Create>(config: {
  /** Path under /api/v1/admin, e.g. `/teams`. */
  path: string;
  label: string;
  /** Default page size when a caller does not supply `limit`. */
  defaultLimit?: number;
}) {
  const { path, label } = config;
  const defaultLimit = config.defaultLimit ?? 20;

  async function list(query: AdminListQuery = {}): Promise<AdminResult<AdminPage<T>>> {
    const searchParams: Record<string, string | number | boolean | undefined> = { limit: defaultLimit, ...query };
    try {
      const envelope = await adminClient().get<T[]>(path, {
        query: searchParams,
        // Admin reads must never be served from a shared cache.
        cache: 'no-store',
      });
      const rows = Array.isArray(envelope?.data)
        ? envelope.data.map((row) => normalizeRow<T>(row)).filter((row): row is T => row !== null)
        : [];
      const raw = (isObject(envelope?.pagination) ? envelope.pagination : {}) as Record<string, unknown>;
      return {
        status: 'ok',
        data: {
          rows,
          pagination: {
            page: typeof raw.page === 'number' ? raw.page : 1,
            limit: typeof raw.limit === 'number' ? raw.limit : defaultLimit,
            total: typeof raw.total === 'number' ? raw.total : rows.length,
            totalPages: typeof raw.totalPages === 'number' ? raw.totalPages : 1,
          },
        },
      };
    } catch (error) {
      return toAdminError(error, `${label}s unavailable`);
    }
  }

  async function get(id: string): Promise<AdminResult<T>> {
    try {
      const envelope = await adminClient().get<T>(`${path}/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const row = normalizeRow<T>(envelope?.data);
      if (!row) return { status: 'error', message: `${label} response was malformed` };
      return { status: 'ok', data: row };
    } catch (error) {
      return toAdminError(error, `${label} unavailable`);
    }
  }

  async function create(body: Create): Promise<AdminResult<T>> {
    try {
      const envelope = await adminClient().post<T>(path, body);
      const row = normalizeRow<T>(envelope?.data);
      if (!row) return { status: 'error', message: `${label} response was malformed` };
      return { status: 'ok', data: row };
    } catch (error) {
      return toAdminError(error, `${label} could not be created`);
    }
  }

  async function update(id: string, body: Update): Promise<AdminResult<T>> {
    try {
      const envelope = await adminClient().request<T>(`${path}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
      });
      const row = normalizeRow<T>(envelope?.data);
      if (!row) return { status: 'error', message: `${label} response was malformed` };
      return { status: 'ok', data: row };
    } catch (error) {
      return toAdminError(error, `${label} could not be updated`);
    }
  }

  async function remove(id: string): Promise<AdminResult<{ id: string }>> {
    try {
      await adminClient().request<{ id: string }>(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return { status: 'ok', data: { id } };
    } catch (error) {
      return toAdminError(error, `${label} could not be deleted`);
    }
  }

  return { list, get, create, update, remove, path };
}

/**
 * Read-only option list for relationship selects (team picker on a match form,
 * venue picker on a team form, ...).
 *
 * Uses the public endpoint when one exists — it is cheaper, RLS-scoped and
 * already cached for the public site — and falls back to the admin endpoint for
 * entities with no public route. Never hardcodes options, and degrades to `[]`
 * so the form can render "no options / missing permission" instead of crashing.
 */
export async function fetchOptionList(
  source: { kind: 'public' | 'admin'; path: string },
  label: (row: Record<string, unknown>) => string,
): Promise<Array<{ id: string; label: string }>> {
  const map = (row: Record<string, unknown>) => {
    const id = typeof row.id === 'string' ? row.id : '';
    const text = label(row);
    return { id, label: text };
  };

  try {
    let rows: unknown[];
    if (source.kind === 'admin') {
      const envelope = await adminClient().get<Array<Record<string, unknown>>>(source.path, {
        query: { limit: 100 },
        cache: 'no-store',
      });
      rows = Array.isArray(envelope?.data) ? envelope.data : [];
    } else {
      // Public feeds already carry the right cache tags and revalidation window,
      // and RLS scopes them exactly as the reader sees them.
      const { fetchListSafely } = await import('@/lib/touchline/data-fetch');
      rows = (await fetchListSafely<Record<string, unknown>>(source.path, { limit: 100 })).rows;
    }
    return rows
      .filter(isObject)
      .map(map)
      .filter((row) => Boolean(row.id && row.label));
  } catch {
    return [];
  }
}
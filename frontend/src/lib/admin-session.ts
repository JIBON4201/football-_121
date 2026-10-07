import { cookies } from 'next/headers';
import { siteConfig } from '@/config/site';
import { isAdminBypassEnabled } from '@/lib/admin-bypass';

export const ADMIN_ACCESS_COOKIE = 'cc_at';
export const ADMIN_REFRESH_COOKIE = 'cc_rt';

/**
 * Raw Admin access token for server-side calls (server components, route
 * handlers, server actions). Never import this from a client component.
 */
export function getAdminAccessToken(): string | undefined {
  return cookies().get(ADMIN_ACCESS_COOKIE)?.value;
}

export interface AdminSessionUser {
  id: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  /** True when the backend served this identity via the dev-only bypass. */
  bypass?: boolean;
}

export type AdminSession =
  | { status: 'ok'; user: AdminSessionUser }
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  /**
   * The identity could not be established because the API was unreachable or
   * errored. Deliberately distinct from `unauthenticated`: redirecting to
   * /login here would tell a signed-in operator their session expired when the
   * truth is a transient backend failure, and would discard a valid cookie.
   */
  | { status: 'error'; message: string };

function apiBase(): string {
  return siteConfig.apiUrl;
}

/**
 * Server-side Admin session check. Reads the httpOnly session cookie — never
 * localStorage — and asks the backend who it belongs to. Backend verdicts map
 * 1:1: missing/invalid token → unauthenticated, valid token without grants →
 * forbidden. Called on every request; the backend re-verifies each API call,
 * so a stale client cache can never grant access.
 *
 * DEV-ONLY: when the bypass flag is set, a missing cookie is no longer fatal —
 * the call goes out unauthenticated and the backend answers with its synthetic
 * super_admin identity. The backend flag must be on too, or this returns
 * unauthenticated exactly as before.
 */
/**
 * Upper bound for the identity check. The dashboard (and the protected layout)
 * await this on every request inside a Suspense boundary — without a bound, a
 * stalled backend leaves the loading skeleton on screen with no resolve path.
 * Slow here means "backend problem", never "still loading": callers render the
 * retryable error state instead of hanging.
 */
export const ADMIN_SESSION_TIMEOUT_MS = 15_000;

export async function getAdminSession(): Promise<AdminSession> {
  const bypass = isAdminBypassEnabled();
  const accessToken = getAdminAccessToken();
  if (!accessToken && !bypass) return { status: 'unauthenticated' };
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/api/v1/admin/me`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(ADMIN_SESSION_TIMEOUT_MS),
    });
  } catch {
    return { status: 'error', message: 'Could not reach the Admin API. Check that the backend is running, then retry.' };
  }
  if (response.status === 401) return { status: 'unauthenticated' };
  if (response.status === 403) return { status: 'forbidden' };
  // 5xx (and anything else unexpected) is an API failure, not a bad session.
  // A 404 is included: it means the deployment is missing /admin/me entirely.
  if (!response.ok) {
    return {
      status: 'error',
      message: `The Admin API returned ${response.status}. Your session is still valid — retry, or sign in again if it persists.`,
    };
  }
  const body = (await response.json()) as { data?: AdminSessionUser };
  if (!body.data || typeof body.data.id !== 'string') {
    return { status: 'error', message: 'The Admin API returned an unexpected session payload.' };
  }
  return { status: 'ok', user: body.data };
}

/** Backend call with the Admin session token (server components/actions). */
export async function adminApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const accessToken = getAdminAccessToken();
  return fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    cache: 'no-store',
  });
}

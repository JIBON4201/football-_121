'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { siteConfig } from '@/config/site';
import { validateLoginInput } from '@/lib/admin-navigation';
import { ADMIN_ACCESS_COOKIE, ADMIN_REFRESH_COOKIE } from '@/lib/admin-session';

/**
 * Session hand-off. Credentials are verified by the backend (Supabase); this
 * frontend never sees a password again and never stores one. Tokens land in
 * httpOnly cookies so no script — including injected ones — can read them, and
 * nothing is written to localStorage/sessionStorage.
 */
export interface LoginState {
  error?: string;
  fields?: { email: string };
}

const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const ACCESS_MAX_AGE_CEILING = 60 * 60 * 24;

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge,
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const errors = validateLoginInput(email, password);
  if (errors.email || errors.password) {
    return { error: errors.email ?? errors.password, fields: { email } };
  }

  let payload: { data?: { session?: { access_token: string; refresh_token: string; expires_in?: number } } };
  try {
    const response = await fetch(`${siteConfig.apiUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 400) {
      return { error: 'Invalid email or password', fields: { email } };
    }
    if (!response.ok) {
      return { error: 'Sign-in is unavailable right now. Please try again.', fields: { email } };
    }
    payload = (await response.json()) as typeof payload;
  } catch {
    return { error: 'Sign-in is unavailable right now. Please try again.', fields: { email } };
  }

  const session = payload.data?.session;
  if (!session?.access_token || !session.refresh_token) {
    return { error: 'Sign-in is unavailable right now. Please try again.', fields: { email } };
  }

  const jar = cookies();
  const accessMaxAge = Math.min(session.expires_in ?? 3600, ACCESS_MAX_AGE_CEILING);
  jar.set(ADMIN_ACCESS_COOKIE, session.access_token, cookieOptions(accessMaxAge));
  jar.set(ADMIN_REFRESH_COOKIE, session.refresh_token, cookieOptions(REFRESH_MAX_AGE_SECONDS));
  redirect('/control-center/dashboard');
}

export async function logoutAction(): Promise<void> {
  const jar = cookies();
  const accessToken = jar.get(ADMIN_ACCESS_COOKIE)?.value;
  const refreshToken = jar.get(ADMIN_REFRESH_COOKIE)?.value;
  jar.delete(ADMIN_ACCESS_COOKIE);
  jar.delete(ADMIN_REFRESH_COOKIE);
  if (accessToken) {
    // Best effort: local cookies are already gone, so a failed upstream call
    // must not trap the operator on a stale session screen.
    try {
      await fetch(`${siteConfig.apiUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
        cache: 'no-store',
      });
    } catch {
      /* ignore */
    }
  }
  redirect('/control-center/login');
}
import { NextResponse, type NextRequest } from 'next/server';
import { isAdminBypassEnabled } from '@/lib/admin-bypass';

/** Normalize "/path/" → "/path" (308). Root and API routes untouched. */
export function normalizePathname(pathname: string): string | null {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return null;
}

/**
 * Lowercase entity slugs to prevent duplicate URLs from case variations.
 * Slugs are citext UNIQUE in the database (case-insensitive), but `/Teams/Arsenal`
 * and `/teams/arsenal` would otherwise compete as separate canonicals.
 * Returns the lowercased pathname when it differs, else null.
 */
export function normalizeSlugCase(pathname: string): string | null {
  const publicPrefixes = ['/news/', '/matches/', '/teams/', '/players/', '/competitions/', '/transfers/'];
  const lower = pathname.toLowerCase();
  if (lower === pathname) return null;
  // Only normalize public content paths; admin + system paths keep their case.
  if (!publicPrefixes.some((p) => lower.startsWith(p)) && !['/news', '/matches', '/teams', '/players', '/competitions', '/transfers', '/live', '/breaking-news', '/search'].includes(lower)) return null;
  return lower;
}

/**
 * UX-only gate for the Admin Panel (NOT a security boundary — the backend
 * Admin API re-verifies every request). Requests to /control-center without
 * a session cookie are sent to the login page so anonymous users never see
 * the shell. Direct API access stays protected server-side regardless.
 */
export function controlCenterRedirect(pathname: string, hasSession: boolean): string | null {
  if (!pathname.startsWith('/control-center')) return null;
  if (pathname === '/control-center/login') return null;
  if (hasSession) return null;
  return '/control-center/login';
}

export const ADMIN_SESSION_COOKIE = 'cc_at';

export function middleware(request: NextRequest) {
  // Per-request CSP nonce, forwarded on the request headers so Next.js signs
  // its own inline flight-payload/hydration scripts with the same value, and
  // on the response headers so the browser enforces it. Without this the
  // static `script-src 'self'` policy silently blocks every inline script and
  // the app freezes on its streaming loading skeleton.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isProd = process.env.NODE_ENV === 'production';
  const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' https: data:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' ${apiUrl}${isProd ? '' : ' ws://localhost:* ws://127.0.0.1:*'}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  let response: NextResponse | null = null;

  // DEV-ONLY: with the bypass on, /control-center/* is served directly and the
  // login redirect is skipped. Never active in a production build.
  if (!isAdminBypassEnabled()) {
    const loginRedirect = controlCenterRedirect(
      request.nextUrl.pathname,
      request.cookies.has(ADMIN_SESSION_COOKIE),
    );
    if (loginRedirect) {
      const url = request.nextUrl.clone();
      url.pathname = loginRedirect;
      response = NextResponse.redirect(url, 308);
    }
  }
  if (!response) {
    const normalized = normalizePathname(request.nextUrl.pathname);
    if (normalized) {
      const url = request.nextUrl.clone();
      url.pathname = normalized;
      response = NextResponse.redirect(url, 308);
    } else {
      const lower = normalizeSlugCase(request.nextUrl.pathname);
      if (lower) {
        const url = request.nextUrl.clone();
        url.pathname = lower;
        response = NextResponse.redirect(url, 308);
      } else {
        response = NextResponse.next({ request: { headers: requestHeaders } });
      }
    }
  }
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};

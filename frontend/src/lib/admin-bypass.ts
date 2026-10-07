/**
 * DEV-ONLY Admin bypass flag (mirrors backend/src/admin/bypass.ts).
 *
 * When NEXT_PUBLIC_ADMIN_BYPASS is truthy the Control Center is reachable with
 * no login: the middleware stops redirecting to /login and getAdminSession()
 * accepts a cookieless session resolved by the backend's synthetic identity.
 *
 * Fenced off the same way as the backend flag:
 *   1. returns false whenever NODE_ENV=production, so a copied .env.local
 *      cannot open the panel on a production build;
 *   2. the backend refuses to boot with ADMIN_BYPASS_AUTH in production, so
 *      both ends must agree before anything renders.
 *
 * NEXT_PUBLIC_* values are inlined at build time - changing this requires a
 * rebuild, not just a dev-server restart.
 */

export function isAdminBypassEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const raw = (process.env.NEXT_PUBLIC_ADMIN_BYPASS ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
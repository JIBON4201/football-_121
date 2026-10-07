/**
 * DEV-ONLY Admin authentication bypass.
 *
 * Purpose: review the Admin Panel UI without a seeded super_admin account, a
 * live service-role key, or a working login. When enabled, every
 * /api/v1/admin/* request is granted a synthetic super_admin identity and
 * `requireAdmin` / `requirePermission` become no-ops.
 *
 * This is a deliberate authorization bypass. It is fenced off three ways:
 *
 *   1. `adminBypassEnabled()` returns false whenever `config.isProd`, so even
 *      a leaked environment variable cannot activate it on a production box.
 *   2. `assertAdminBypassSafe()` throws at boot if the flag is set in
 *      production, so the process refuses to start rather than serve.
 *   3. `ADMIN_BYPASS_AUTH` is a BLOCKER rule in lib/envRules.ts, so the
 *      verification CLI and `npm run verify` report it alongside every other
 *      production gate.
 *
 * Turning it on does NOT make admin data appear: services still read through
 * `serviceClient()`, so a dead SUPABASE_SERVICE_ROLE_KEY or unapplied
 * migrations 025-027 still surface as empty tables and 5xx responses. This
 * only removes the *authorization* gate, never the data-access one.
 *
 * Set ADMIN_BYPASS_AUTH=false (or unset it) to restore full enforcement.
 */
import { config } from '../config';
import type { AdminIdentity } from './permissions';

/**
 * Every key seeded into public.admin_permissions by migrations 025-027.
 *
 * Duplicated from SQL on purpose: the bypass must resolve a complete grant set
 * even when those migrations have not been applied yet, which is precisely the
 * state it exists to review. Keep in sync when a migration adds a key — a
 * missing entry only hides one admin control in dev, it cannot widen access.
 */
export const ADMIN_BYPASS_PERMISSIONS: readonly string[] = [
  'dashboard.read',
  'articles.read',
  'articles.create',
  'articles.update',
  'articles.delete',
  'articles.publish',
  'categories.read',
  'categories.manage',
  'tags.read',
  'tags.manage',
  'transfers.read',
  'transfers.create',
  'transfers.update',
  'transfers.delete',
  'transfer_windows.read',
  'transfer_windows.manage',
  'matches.read',
  'matches.create',
  'matches.update',
  'matches.delete',
  'match_events.manage',
  'lineups.manage',
  'teams.read',
  'teams.create',
  'teams.update',
  'teams.delete',
  'players.read',
  'players.create',
  'players.update',
  'players.delete',
  'competitions.read',
  'competitions.create',
  'competitions.update',
  'competitions.delete',
  'seasons.read',
  'seasons.manage',
  'venues.read',
  'venues.manage',
  'media.read',
  'media.manage',
  'settings.read',
  'settings.manage',
  'users.read',
  'users.manage',
  'roles.read',
  'roles.manage',
  'permissions.read',
  'audit_logs.read',
];

/** Reserved sentinel id. Not a real auth uid, so it can never collide. */
export const ADMIN_BYPASS_USER_ID = '00000000-0000-0000-0000-000000000000';
export const ADMIN_BYPASS_EMAIL = 'dev-bypass@localhost.invalid';

/**
 * True only when the flag is set AND the process is not production.
 * Checked at every point of use rather than trusted once at import time, so a
 * test that mutates NODE_ENV sees the change immediately.
 */
export function adminBypassEnabled(): boolean {
  return config.adminBypassAuth && !config.isProd;
}

/**
 * Boot-time guard, mirroring lib/envRules.assertEnvIsSane. Throws when the
 * flag is set in production so a misconfigured deploy dies immediately instead
 * of quietly serving an unauthenticated admin API.
 */
export function assertAdminBypassSafe(): void {
  if (!config.adminBypassAuth) return;
  if (!config.isProd) return;
  throw new Error(
    'Refusing to start: ADMIN_BYPASS_AUTH is enabled while NODE_ENV=production. ' +
      'This flag disables all Admin authorization and must never reach production. ' +
      'Unset it and provision a real super_admin instead.',
  );
}

/**
 * Synthetic identity handed to every admin request in bypass mode. A fresh
 * object per call so no handler can mutate shared state.
 */
export function adminBypassIdentity(): AdminIdentity {
  return {
    userId: ADMIN_BYPASS_USER_ID,
    email: ADMIN_BYPASS_EMAIL,
    status: 'active',
    roles: ['super_admin'],
    roleIds: [],
    permissions: [...ADMIN_BYPASS_PERMISSIONS],
  };
}
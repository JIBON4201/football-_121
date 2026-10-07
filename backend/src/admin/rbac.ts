/**
 * Step 3 — Server-side Admin RBAC middleware.
 *
 * Chain per request: authenticate({required:true}) -> requireAdmin* ->
 * validateRequest -> service. Every check runs on the server against
 * database state (src/admin/permissions.ts). Client-supplied `role`,
 * `roles`, `permission`, or `permissions` fields in body/query/headers
 * are never read — they cannot escalate anything.
 *
 * Status contract: 401 = no/invalid token (thrown by authenticate),
 * 403 = authenticated but not an active, granted admin.
 */
import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../lib/async';
import { forbidden, unauthorized } from '../lib/errors';
import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  resolveAdminIdentity,
  type AdminIdentity,
} from './permissions';
import { adminBypassEnabled, adminBypassIdentity } from './bypass';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  namespace Express {
    interface Request {
      admin?: AdminIdentity;
    }
  }
}

/**
 * Resolve the caller's admin identity, or install the synthetic bypass identity.
 *
 * Returns null when the caller is authenticated but not an admin. In bypass
 * mode the identity carries every seeded permission, so the require* helpers
 * below pass unchanged without needing a bypass branch of their own.
 */
async function loadAdmin(req: Request): Promise<AdminIdentity | null> {
  if (adminBypassEnabled()) {
    const identity = adminBypassIdentity();
    req.admin = identity;
    // Handlers and audit helpers read req.user; give them the same identity.
    if (!req.user) req.user = { id: identity.userId, email: identity.email };
    return identity;
  }
  if (!req.user) throw unauthorized();
  const identity = await resolveAdminIdentity(req.user.id);
  if (!identity) throw forbidden();
  req.admin = identity;
  return identity;
}

/**
 * Any active admin (active profile + at least one DB-granted permission).
 * Normal website users (zero grants) and disabled accounts get 403.
 */
export function requireAdmin() {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    await loadAdmin(req);
    next();
  });
}

/** Single granular permission, e.g. requirePermission('articles.read'). */
export function requirePermission(key: string) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const identity = await loadAdmin(req);
    if (identity && !hasPermission(identity, key)) throw forbidden();
    next();
  });
}

/** At least one of the listed permissions. */
export function requireAnyPermission(...keys: string[]) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const identity = await loadAdmin(req);
    if (identity && !hasAnyPermission(identity, keys)) throw forbidden();
    next();
  });
}

/** Every listed permission. */
export function requireAllPermissions(...keys: string[]) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const identity = await loadAdmin(req);
    if (identity && !hasAllPermissions(identity, keys)) throw forbidden();
    next();
  });
}

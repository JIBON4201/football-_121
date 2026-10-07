import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../lib/async';
import { forbidden, unauthorized } from '../lib/errors';
import { ADMIN_ROLES, EDITOR_ROLES, STAFF_ROLES, userHasAnyRole } from '../lib/roles';

/** Centralized authorization. No role logic belongs inside route handlers. */
export function requireRoles(...roles: string[]) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    const allowed = await userHasAnyRole(req.user.id, roles);
    if (!allowed) throw forbidden();
    next();
  });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw unauthorized();
  next();
}

/** Author tier and above (author, moderator, editor, admin, super_admin). */
export const requireStaff = (): ReturnType<typeof requireRoles> => requireRoles(...STAFF_ROLES);

/** Editor tier and above (editor, admin, super_admin). */
export const requireEditor = (): ReturnType<typeof requireRoles> => requireRoles(...EDITOR_ROLES);

/** Admin tier (admin, super_admin). */
export const requireAdmin = (): ReturnType<typeof requireRoles> => requireRoles(...ADMIN_ROLES);

/**
 * Step 13 — Admin roles routes (names mirror app_role; grants via
 * PUT /:id/permissions). Reads use roles.read; writes use roles.manage.
 * super_admin grants immutable; system/member roles undeletable.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminRolesService } from '../../../admin/services/roles.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';

const roleIdParam = z.object({ id: z.coerce.number().int().positive() });

const router = Router();

router.get(
  '/',
  requirePermission('roles.read'),
  validateRequest({ query: z.object({ ...adminListBase }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminRolesService.list>[0];
    const { rows, pagination } = await adminRolesService.list(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:id',
  requirePermission('roles.read'),
  validateRequest({ params: roleIdParam }),
  asyncHandler(async (req, res) => {
    ok(res, await adminRolesService.get(Number(req.params.id)));
  }),
);

router.post(
  '/',
  requirePermission('roles.manage'),
  validateRequest({
    body: z.object({
      name: z.string().trim().min(1).max(50),
      description: z.string().max(500).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const created = await adminRolesService.create(req.admin!.userId, req.body);
    res.status(201);
    ok(res, created);
  }),
);

router.patch(
  '/:id',
  requirePermission('roles.manage'),
  validateRequest({
    params: roleIdParam,
    body: z.object({ description: z.string().max(500).nullable().optional() }),
  }),
  asyncHandler(async (req, res) => {
    ok(res, await adminRolesService.update(req.admin!.userId, Number(req.params.id), req.body));
  }),
);

router.delete(
  '/:id',
  requirePermission('roles.manage'),
  validateRequest({ params: roleIdParam }),
  asyncHandler(async (req, res) => {
    await adminRolesService.remove(req.admin!.userId, Number(req.params.id));
    ok(res, { id: Number(req.params.id), deleted: true });
  }),
);

router.put(
  '/:id/permissions',
  requirePermission('roles.manage'),
  validateRequest({
    params: roleIdParam,
    body: z.object({ permissionIds: z.array(uuidSchema).max(200) }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { permissionIds: string[] };
    ok(res, await adminRolesService.setPermissions(req.admin!.userId, Number(req.params.id), body.permissionIds));
  }),
);

export default router;

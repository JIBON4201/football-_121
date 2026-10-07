/**
 * Step 13 — Admin users routes (identity in Supabase Auth; profiles + roles here).
 * Reads use users.read; invite/update/revoke use users.manage.
 * DELETE revokes admin access (keeps base 'user'), never destroys identity.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminUsersService } from '../../../admin/services/users.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { searchSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';

const listQuery = z.object({
  ...adminListBase,
  q: searchSchema,
  role: z.string().min(1).max(50).optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  sort: z.enum(['created_at', 'display_name']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const url = z.string().max(2000).refine(
  (v) => v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/'),
  'must be an http(s) URL or site path',
);

const inviteBody = z.object({
  email: z.string().trim().email().max(255),
  display_name: z.string().trim().max(100).nullable().optional(),
  roleIds: z.array(z.number().int().positive()).max(20).optional(),
});

const updateBody = z.object({
  display_name: z.string().trim().max(100).nullable().optional(),
  username: z.string().trim().max(100).nullable().optional(),
  avatar_url: url.nullable().optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  roleIds: z.array(z.number().int().positive()).max(20).optional(),
});

const router = Router();

router.get(
  '/',
  requirePermission('users.read'),
  validateRequest({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminUsersService.list>[0];
    const { rows, pagination } = await adminUsersService.list(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:id',
  requirePermission('users.read'),
  validateRequest({ params: z.object({ id: z.string().min(1).max(100) }) }),
  asyncHandler(async (req, res) => {
    ok(res, await adminUsersService.get(req.params.id));
  }),
);

router.post(
  '/',
  requirePermission('users.manage'),
  validateRequest({ body: inviteBody }),
  asyncHandler(async (req, res) => {
    const created = await adminUsersService.invite(req.admin!.userId, req.body);
    res.status(201);
    ok(res, created);
  }),
);

router.patch(
  '/:id',
  requirePermission('users.manage'),
  validateRequest({ params: z.object({ id: z.string().min(1).max(100) }), body: updateBody }),
  asyncHandler(async (req, res) => {
    ok(res, await adminUsersService.update(req.admin!.userId, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  requirePermission('users.manage'),
  validateRequest({ params: z.object({ id: z.string().min(1).max(100) }) }),
  asyncHandler(async (req, res) => {
    ok(res, await adminUsersService.revoke(req.admin!.userId, req.params.id));
  }),
);

export default router;

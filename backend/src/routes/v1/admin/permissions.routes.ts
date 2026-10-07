/**
 * Step 13 — Admin permission catalogue (read-only; grants change via
 * PUT /roles/:id/permissions under roles.manage).
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminPermissionsService } from '../../../admin/services/permissions.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { validateRequest } from '../../../middleware/validateRequest';

const router = Router();

router.get(
  '/',
  requirePermission('permissions.read'),
  validateRequest({ query: z.object({ ...adminListBase }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminPermissionsService.list>[0];
    const { rows, pagination } = await adminPermissionsService.list(q);
    ok(res, rows, { pagination });
  }),
);

export default router;

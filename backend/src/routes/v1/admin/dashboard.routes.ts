/** Step 4 — Admin dashboard aggregates. */
import { Router } from 'express';
import { requirePermission } from '../../../admin/rbac';
import { adminDashboardService } from '../../../admin/services/dashboard.admin.service';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';

const router = Router();

router.get(
  '/',
  requirePermission('dashboard.read'),
  asyncHandler(async (_req, res) => {
    ok(res, await adminDashboardService.summary());
  }),
);

export default router;

/** Step 4 — Admin audit-log reads (newest first). */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminAuditLogsService } from '../../../admin/services/audit-logs.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';

const listQuery = z.object({
  ...adminListBase,
  action: z.string().min(1).max(100).optional(),
  entity_type: z.string().min(1).max(100).optional(),
  user_id: uuidSchema.optional(),
});

const router = Router();

router.get(
  '/',
  requirePermission('audit_logs.read'),
  validateRequest({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminAuditLogsService.list>[0];
    const { rows, pagination } = await adminAuditLogsService.list(q);
    ok(res, rows, { pagination });
  }),
);

export default router;

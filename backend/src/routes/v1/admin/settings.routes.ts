/**
 * Step 12 — Admin site-settings routes (reuses public.system_settings).
 * Reads require settings.read; writes require settings.manage.
 * Values only (PATCH): keys, types and catalogue membership are immutable.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminSettingsService } from '../../../admin/services/settings.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { validateRequest } from '../../../middleware/validateRequest';

const keyParam = z.object({ key: z.string().min(1).max(150).regex(/^[A-Za-z0-9._-]+$/, 'Invalid setting key') });

const router = Router();

router.get(
  '/',
  requirePermission('settings.read'),
  validateRequest({ query: z.object({ ...adminListBase }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminSettingsService.list>[0];
    const { rows, pagination } = await adminSettingsService.list(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:key',
  requirePermission('settings.read'),
  validateRequest({ params: keyParam }),
  asyncHandler(async (req, res) => {
    ok(res, await adminSettingsService.get(req.params.key));
  }),
);

router.patch(
  '/:key',
  requirePermission('settings.manage'),
  validateRequest({
    params: keyParam,
    body: z.object({ value: z.unknown().refine((v) => v !== undefined, 'value is required') }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { value: unknown };
    ok(res, await adminSettingsService.update(req.admin!.userId, req.params.key, body.value));
  }),
);

export default router;

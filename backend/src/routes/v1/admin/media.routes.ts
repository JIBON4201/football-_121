/**
 * Step 11 — Admin media management (reuses media tables + storage + mediaService).
 *
 * Upload reuses the existing pipeline (magic-byte MIME, extension match,
 * size/dimension caps, variant generation, idempotency) with Admin
 * authorization (media.manage + service author+ gate). Deletes are
 * ref-counted (409 when referenced by articles) with storage cleanup.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminMediaService } from '../../../admin/services/media.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { dateSchema, searchSchema, uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';
import { uploadRateLimit } from '../../../middleware/uploadRateLimit';

const listQuery = z.object({
  ...adminListBase,
  q: searchSchema,
  mimeType: z.string().min(1).max(100).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  sort: z.enum(['created_at', 'file_size']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const uploadBody = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100).optional(),
  contentBase64: z.string().min(1).max(10_000_000),
  altText: z.string().max(500).nullable().optional(),
  caption: z.string().max(5000).nullable().optional(),
  credit: z.string().max(255).nullable().optional(),
  entityType: z.string().min(1).max(30).optional(),
  idempotencyKey: z.string().min(1).max(64).optional(),
});

const updateBody = z.object({
  altText: z.string().max(500).nullable().optional(),
  caption: z.string().max(5000).nullable().optional(),
  credit: z.string().max(255).nullable().optional(),
});

const router = Router();

router.get(
  '/',
  requirePermission('media.read'),
  validateRequest({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminMediaService.list>[0];
    const { rows, pagination } = await adminMediaService.list(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:id',
  requirePermission('media.read'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await adminMediaService.get(req.params.id));
  }),
);

router.post(
  '/',
  requirePermission('media.manage'),
  uploadRateLimit(),
  validateRequest({ body: uploadBody }),
  asyncHandler(async (req, res) => {
    const result = await adminMediaService.upload(
      req.admin!.userId,
      req.body,
      req.requestId,
    );
    res.status(result.deduped ? 200 : 201);
    ok(res, result);
  }),
);

router.patch(
  '/:id',
  requirePermission('media.manage'),
  validateRequest({ params: z.object({ id: uuidSchema }), body: updateBody }),
  asyncHandler(async (req, res) => {
    ok(res, await adminMediaService.update(req.admin!.userId, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  requirePermission('media.manage'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    const result = await adminMediaService.remove(req.admin!.userId, req.params.id);
    ok(res, { id: req.params.id, ...result });
  }),
);

export default router;

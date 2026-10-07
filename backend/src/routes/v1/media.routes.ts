import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable, noStore } from '../../lib/cache';
import { badRequest } from '../../lib/errors';
import { ok } from '../../lib/respond';
import { authenticate } from '../../middleware/auth';
import { requireAuth } from '../../middleware/requireRole';
import { uploadRateLimit } from '../../middleware/uploadRateLimit';
import { validateRequest } from '../../middleware/validateRequest';
import { mediaService } from '../../services/media.service';

const router = Router();

// Optional auth at router level: public reads stay public, writes enforce.
router.use(authenticate({ required: false }));

const base64Body = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100).optional(),
  contentBase64: z.string().min(1).max(10_000_000),
  altText: z.string().max(500).nullable().optional(),
  caption: z.string().max(5000).nullable().optional(),
  credit: z.string().max(255).nullable().optional(),
  entityType: z.string().min(1).max(30).optional(),
  idempotencyKey: z.string().min(1).max(64).optional(),
});

function decodeBase64(raw: string): Uint8Array {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(raw.replace(/\s+/g, ''))) throw badRequest('Invalid base64 content');
  try {
    const buf = Buffer.from(raw.replace(/\s+/g, ''), 'base64');
    if (buf.length === 0) throw badRequest('Empty file upload');
    return new Uint8Array(buf);
  } catch {
    throw badRequest('Invalid base64 content');
  }
}

/** Protected upload: author+. Strict per-uploader rate limit. */
router.post(
  '/upload',
  requireAuth,
  uploadRateLimit(),
  noStore(),
  validateRequest({ body: base64Body }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof base64Body>;
    const bytes = decodeBase64(body.contentBase64);
    const result = await mediaService.upload(
      req.user!.id,
      {
        fileName: body.fileName,
        mimeType: body.mimeType,
        bytes,
        altText: body.altText ?? null,
        caption: body.caption ?? null,
        credit: body.credit ?? null,
        entityType: body.entityType,
        idempotencyKey: body.idempotencyKey ?? null,
      },
      res.locals.requestId as string | undefined,
    );
    res.status(result.deduped ? 200 : 201);
    ok(res, { ...result.media, variants: result.variants, deduped: result.deduped });
  }),
);

/** Orphan detection (editor+). Defined before :id so it is not shadowed. */
router.get(
  '/orphans/list',
  requireAuth,
  noStore(),
  asyncHandler(async (req, res) => {
    ok(res, await mediaService.orphans(req.user!.id, 100));
  }),
);

/** Metadata retrieval: public only when referenced by published content. */
router.get(
  '/:id',
  validateRequest({ params: z.object({ id: z.string().uuid('Invalid id') }) }),
  cacheable(config.media.cacheMaxAge),
  asyncHandler(async (req, res) => {
    const viewerId = req.user?.id ?? null;
    const { getUserRoles } = await import('../../lib/roles');
    const roles = viewerId ? await getUserRoles(viewerId) : [];
    ok(res, await mediaService.get(viewerId, roles, req.params.id));
  }),
);

router.get(
  '/:id/variants',
  validateRequest({ params: z.object({ id: z.string().uuid('Invalid id') }) }),
  cacheable(config.media.cacheMaxAge),
  asyncHandler(async (req, res) => {
    const viewerId = req.user?.id ?? null;
    const { getUserRoles } = await import('../../lib/roles');
    const roles = viewerId ? await getUserRoles(viewerId) : [];
    const { variants } = await mediaService.get(viewerId, roles, req.params.id) as { variants: unknown };
    ok(res, variants);
  }),
);

const metaPatch = z.object({
  altText: z.string().max(500).nullable().optional(),
  caption: z.string().max(5000).nullable().optional(),
  credit: z.string().max(255).nullable().optional(),
});

router.patch(
  '/:id',
  requireAuth,
  noStore(),
  validateRequest({ params: z.object({ id: z.string().uuid('Invalid id') }), body: metaPatch }),
  asyncHandler(async (req, res) => {
    ok(res, await mediaService.updateMetadata(req.user!.id, req.params.id, req.body));
  }),
);

/** Safe delete: 409 while referenced, otherwise storage+rows removed. */
router.delete(
  '/:id',
  requireAuth,
  noStore(),
  validateRequest({ params: z.object({ id: z.string().uuid('Invalid id') }) }),
  asyncHandler(async (req, res) => {
    ok(res, await mediaService.remove(req.user!.id, req.params.id));
  }),
);

export default router;

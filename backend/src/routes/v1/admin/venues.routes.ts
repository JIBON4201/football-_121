/**
 * Step 10 — Admin venues CRUD (reuses public.venues).
 * Writes require venues.manage (the seeded write grant); reads use
 * venues.read. Referenced venues (teams/matches) return 409.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminVenuesService } from '../../../admin/services/venues.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { searchSchema, slugSchema, uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';

const listQuery = z.object({
  ...adminListBase,
  q: searchSchema,
  countryId: uuidSchema.optional(),
  sort: z.enum(['name', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const url = z.string().max(2000).refine(
  (v) => v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/'),
  'must be an http(s) URL or site path',
);

const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  city: z.string().trim().max(100).nullable().optional(),
  country_id: uuidSchema.nullable().optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  image_url: url.nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

const updateBody = createBody.partial();

const router = Router();

router.get('/', requirePermission('venues.read'), validateRequest({ query: listQuery }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as Parameters<typeof adminVenuesService.list>[0];
  const { rows, pagination } = await adminVenuesService.list(q);
  ok(res, rows, { pagination });
}));

router.get('/:id', requirePermission('venues.read'), validateRequest({ params: z.object({ id: uuidSchema }) }), asyncHandler(async (req, res) => {
  ok(res, await adminVenuesService.get(req.params.id));
}));

router.post('/', requirePermission('venues.manage'), validateRequest({ body: createBody }), asyncHandler(async (req, res) => {
  const created = await adminVenuesService.create(req.admin!.userId, req.body);
  res.status(201);
  ok(res, created);
}));

router.patch('/:id', requirePermission('venues.manage'), validateRequest({ params: z.object({ id: uuidSchema }), body: updateBody }), asyncHandler(async (req, res) => {
  ok(res, await adminVenuesService.update(req.admin!.userId, req.params.id, req.body));
}));

router.delete('/:id', requirePermission('venues.manage'), validateRequest({ params: z.object({ id: uuidSchema }) }), asyncHandler(async (req, res) => {
  await adminVenuesService.remove(req.admin!.userId, req.params.id);
  ok(res, { id: req.params.id, deleted: true });
}));

export default router;

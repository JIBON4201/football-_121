/**
 * Step 10 — Admin competitions CRUD (reuses public.competitions).
 * Deletes blocked by dependents (409); deactivate via is_active instead.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminCompetitionsService } from '../../../admin/services/competitions.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { searchSchema, slugSchema, uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

const listQuery = z.object({
  ...adminListBase,
  q: searchSchema,
  countryId: uuidSchema.optional(),
  type: z.string().min(1).max(30).optional(),
  active: booleanQuery,
  sort: z.enum(['name', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const url = z.string().max(2000).refine(
  (v) => v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/'),
  'must be an http(s) URL or site path',
);

const createBody = z.object({
  name: z.string().trim().min(1).max(150),
  slug: slugSchema.optional(),
  short_name: z.string().trim().max(80).nullable().optional(),
  country_id: uuidSchema.nullable().optional(),
  logo_url: url.nullable().optional(),
  type: z.string().trim().max(30).nullable().optional(),
  gender: z.string().trim().max(20).nullable().optional(),
  is_active: z.boolean().optional(),
});

const updateBody = createBody.partial();

const router = Router();

router.get('/', requirePermission('competitions.read'), validateRequest({ query: listQuery }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as Parameters<typeof adminCompetitionsService.list>[0];
  const { rows, pagination } = await adminCompetitionsService.list(q);
  ok(res, rows, { pagination });
}));

router.get('/:id', requirePermission('competitions.read'), validateRequest({ params: z.object({ id: uuidSchema }) }), asyncHandler(async (req, res) => {
  ok(res, await adminCompetitionsService.get(req.params.id));
}));

router.post('/', requirePermission('competitions.create'), validateRequest({ body: createBody }), asyncHandler(async (req, res) => {
  const created = await adminCompetitionsService.create(req.admin!.userId, req.body);
  res.status(201);
  ok(res, created);
}));

router.patch('/:id', requirePermission('competitions.update'), validateRequest({ params: z.object({ id: uuidSchema }), body: updateBody }), asyncHandler(async (req, res) => {
  ok(res, await adminCompetitionsService.update(req.admin!.userId, req.params.id, req.body));
}));

router.delete('/:id', requirePermission('competitions.delete'), validateRequest({ params: z.object({ id: uuidSchema }) }), asyncHandler(async (req, res) => {
  await adminCompetitionsService.remove(req.admin!.userId, req.params.id);
  ok(res, { id: req.params.id, deleted: true });
}));

export default router;

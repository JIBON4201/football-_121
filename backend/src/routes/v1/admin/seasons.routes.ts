/**
 * Step 10 — Admin seasons CRUD (reuses public.seasons).
 * Writes require seasons.manage (the seeded write grant); reads use
 * seasons.read. Deletes blocked by dependents (409); seasons carry no
 * archive flag (is_current marks the running season only).
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminSeasonsService } from '../../../admin/services/seasons.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { dateSchema, searchSchema, uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

const listQuery = z.object({
  ...adminListBase,
  q: searchSchema,
  competition_id: uuidSchema.optional(),
  current: booleanQuery,
  sort: z.enum(['name', 'start_date']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const createBody = z.object({
  competition_id: uuidSchema,
  name: z.string().trim().min(1).max(50),
  start_date: dateSchema.nullable().optional(),
  end_date: dateSchema.nullable().optional(),
  is_current: z.boolean().optional(),
});

const updateBody = createBody.partial();

const router = Router();

router.get('/', requirePermission('seasons.read'), validateRequest({ query: listQuery }), asyncHandler(async (req, res) => {
  const raw = req.query as unknown as Parameters<typeof adminSeasonsService.list>[0] & { competition_id?: string };
  const { rows, pagination } = await adminSeasonsService.list({ ...raw, competitionId: raw.competition_id ?? raw.competitionId });
  ok(res, rows, { pagination });
}));

router.get('/:id', requirePermission('seasons.read'), validateRequest({ params: z.object({ id: uuidSchema }) }), asyncHandler(async (req, res) => {
  ok(res, await adminSeasonsService.get(req.params.id));
}));

router.post('/', requirePermission('seasons.manage'), validateRequest({ body: createBody }), asyncHandler(async (req, res) => {
  const created = await adminSeasonsService.create(req.admin!.userId, req.body);
  res.status(201);
  ok(res, created);
}));

router.patch('/:id', requirePermission('seasons.manage'), validateRequest({ params: z.object({ id: uuidSchema }), body: updateBody }), asyncHandler(async (req, res) => {
  ok(res, await adminSeasonsService.update(req.admin!.userId, req.params.id, req.body));
}));

router.delete('/:id', requirePermission('seasons.manage'), validateRequest({ params: z.object({ id: uuidSchema }) }), asyncHandler(async (req, res) => {
  await adminSeasonsService.remove(req.admin!.userId, req.params.id);
  ok(res, { id: req.params.id, deleted: true });
}));

export default router;

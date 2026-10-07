/**
 * Step 8 — Admin teams CRUD (reuses public.teams + related tables).
 *
 * Deletes are SAFE: teams cascade into matches/history/links (and
 * transfers RESTRICT), so teams with dependents return 409 — deactivate
 * via PATCH is_active=false instead.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminTeamsService } from '../../../admin/services/teams.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { searchSchema, slugSchema, uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const listQuery = z.object({
  ...adminListBase,
  q: searchSchema,
  countryId: uuidSchema.optional(),
  competitionId: uuidSchema.optional(),
  seasonId: uuidSchema.optional(),
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
  founded_year: z.number().int().min(1800).max(2100).nullable().optional(),
  venue_id: uuidSchema.nullable().optional(),
  website_url: url.nullable().optional(),
  is_active: z.boolean().optional(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  slug: slugSchema.optional(),
  short_name: z.string().trim().max(80).nullable().optional(),
  country_id: uuidSchema.nullable().optional(),
  logo_url: url.nullable().optional(),
  founded_year: z.number().int().min(1800).max(2100).nullable().optional(),
  venue_id: uuidSchema.nullable().optional(),
  website_url: url.nullable().optional(),
  is_active: z.boolean().optional(),
});

const router = Router();

router.get(
  '/',
  requirePermission('teams.read'),
  validateRequest({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminTeamsService.list>[0];
    const { rows, pagination } = await adminTeamsService.list(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:id',
  requirePermission('teams.read'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await adminTeamsService.get(req.params.id));
  }),
);

router.post(
  '/',
  requirePermission('teams.create'),
  validateRequest({ body: createBody }),
  asyncHandler(async (req, res) => {
    const created = await adminTeamsService.create(req.admin!.userId, req.body);
    res.status(201);
    ok(res, created);
  }),
);

router.patch(
  '/:id',
  requirePermission('teams.update'),
  validateRequest({ params: z.object({ id: uuidSchema }), body: updateBody }),
  asyncHandler(async (req, res) => {
    ok(res, await adminTeamsService.update(req.admin!.userId, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  requirePermission('teams.delete'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    await adminTeamsService.remove(req.admin!.userId, req.params.id);
    ok(res, { id: req.params.id, deleted: true });
  }),
);

export default router;

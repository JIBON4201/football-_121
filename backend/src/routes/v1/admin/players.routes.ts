/**
 * Step 9 — Admin players CRUD (reuses public.players + related tables).
 *
 * Team assignment appends player_team_history rows (history preserved);
 * transfers surface read-only on the detail endpoint. Deletes are SAFE:
 * any dependents across history/transfers/events/lineups/statistics/
 * article links return 409.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminPlayersService } from '../../../admin/services/players.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { searchSchema, slugSchema, uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';

const listQuery = z.object({
  ...adminListBase,
  q: searchSchema,
  teamId: uuidSchema.optional(),
  nationalityId: uuidSchema.optional(),
  position: z.string().min(1).max(40).optional(),
  status: z.string().min(1).max(30).optional(),
  sort: z.enum(['display_name', 'created_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const url = z.string().max(2000).refine(
  (v) => v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/'),
  'must be an http(s) URL or site path',
);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_of_birth must be YYYY-MM-DD');

const createBody = z.object({
  display_name: z.string().trim().min(1).max(150),
  slug: slugSchema.optional(),
  first_name: z.string().trim().max(100).nullable().optional(),
  last_name: z.string().trim().max(100).nullable().optional(),
  date_of_birth: isoDate.nullable().optional(),
  nationality_id: uuidSchema.nullable().optional(),
  position: z.string().trim().max(40).nullable().optional(),
  preferred_foot: z.enum(['left', 'right', 'both']).nullable().optional(),
  height_cm: z.number().int().min(100).max(250).nullable().optional(),
  photo_url: url.nullable().optional(),
  status: z.string().trim().max(30).nullable().optional(),
  team_id: uuidSchema.nullable().optional(),
  season_id: uuidSchema.nullable().optional(),
  shirt_number: z.number().int().min(1).max(99).nullable().optional(),
});

const updateBody = z.object({
  display_name: z.string().trim().min(1).max(150).optional(),
  slug: slugSchema.optional(),
  first_name: z.string().trim().max(100).nullable().optional(),
  last_name: z.string().trim().max(100).nullable().optional(),
  date_of_birth: isoDate.nullable().optional(),
  nationality_id: uuidSchema.nullable().optional(),
  position: z.string().trim().max(40).nullable().optional(),
  preferred_foot: z.enum(['left', 'right', 'both']).nullable().optional(),
  height_cm: z.number().int().min(100).max(250).nullable().optional(),
  photo_url: url.nullable().optional(),
  status: z.string().trim().max(30).nullable().optional(),
  team_id: uuidSchema.nullable().optional(),
  season_id: uuidSchema.nullable().optional(),
  shirt_number: z.number().int().min(1).max(99).nullable().optional(),
});

const router = Router();

router.get(
  '/',
  requirePermission('players.read'),
  validateRequest({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminPlayersService.list>[0];
    const { rows, pagination } = await adminPlayersService.list(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:id',
  requirePermission('players.read'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await adminPlayersService.get(req.params.id));
  }),
);

router.post(
  '/',
  requirePermission('players.create'),
  validateRequest({ body: createBody }),
  asyncHandler(async (req, res) => {
    const created = await adminPlayersService.create(req.admin!.userId, req.body);
    res.status(201);
    ok(res, created);
  }),
);

router.patch(
  '/:id',
  requirePermission('players.update'),
  validateRequest({ params: z.object({ id: uuidSchema }), body: updateBody }),
  asyncHandler(async (req, res) => {
    ok(res, await adminPlayersService.update(req.admin!.userId, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  requirePermission('players.delete'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    await adminPlayersService.remove(req.admin!.userId, req.params.id);
    ok(res, { id: req.params.id, deleted: true });
  }),
);

export default router;

/**
 * Step 7 — Admin matches CRUD (reuses public.matches + related tables).
 *
 * Deletes are SAFE: matches cascade into events, lineups, statistics and
 * article links, so matches with dependents return 409 — cancel via
 * PATCH status=cancelled instead. Writes are audited (matches.*).
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminMatchesService } from '../../../admin/services/matches.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { dateSchema, MATCH_STATUSES, searchSchema, slugSchema, uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';
import events from './match-events.routes';

const listQuery = z.object({
  ...adminListBase,
  q: searchSchema,
  status: z.enum(MATCH_STATUSES).optional(),
  competitionId: uuidSchema.optional(),
  seasonId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  sort: z.enum(['asc', 'desc']).optional(),
});

const score = z.number().int().min(0).max(32767).nullable().optional();

const createBody = z.object({
  slug: slugSchema.optional(),
  competition_id: uuidSchema,
  season_id: uuidSchema.nullable().optional(),
  venue_id: uuidSchema.nullable().optional(),
  home_team_id: uuidSchema,
  away_team_id: uuidSchema,
  scheduled_at: z.string().datetime({ offset: true }),
  status: z.enum(MATCH_STATUSES).optional(),
  home_score: score,
  away_score: score,
  home_score_ht: score,
  away_score_ht: score,
  home_score_et: score,
  away_score_et: score,
  home_score_pen: score,
  away_score_pen: score,
  round: z.string().max(100).nullable().optional(),
  matchday: z.number().int().min(0).nullable().optional(),
  referee_name: z.string().max(150).nullable().optional(),
  attendance: z.number().int().min(0).nullable().optional(),
});

const updateBody = z.object({
  slug: slugSchema.optional(),
  competition_id: uuidSchema.optional(),
  season_id: uuidSchema.nullable().optional(),
  venue_id: uuidSchema.nullable().optional(),
  home_team_id: uuidSchema.optional(),
  away_team_id: uuidSchema.optional(),
  scheduled_at: z.string().datetime({ offset: true }).optional(),
  status: z.enum(MATCH_STATUSES).optional(),
  home_score: score,
  away_score: score,
  home_score_ht: score,
  away_score_ht: score,
  home_score_et: score,
  away_score_et: score,
  home_score_pen: score,
  away_score_pen: score,
  round: z.string().max(100).nullable().optional(),
  matchday: z.number().int().min(0).nullable().optional(),
  referee_name: z.string().max(150).nullable().optional(),
  attendance: z.number().int().min(0).nullable().optional(),
});

const router = Router();

router.get(
  '/',
  requirePermission('matches.read'),
  validateRequest({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminMatchesService.list>[0];
    const { rows, pagination } = await adminMatchesService.list(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:id',
  requirePermission('matches.read'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await adminMatchesService.get(req.params.id));
  }),
);

router.post(
  '/',
  requirePermission('matches.create'),
  validateRequest({ body: createBody }),
  asyncHandler(async (req, res) => {
    const created = await adminMatchesService.create(req.admin!.userId, req.body);
    res.status(201);
    ok(res, created);
  }),
);

router.patch(
  '/:id',
  requirePermission('matches.update'),
  validateRequest({ params: z.object({ id: uuidSchema }), body: updateBody }),
  asyncHandler(async (req, res) => {
    ok(res, await adminMatchesService.update(req.admin!.userId, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  requirePermission('matches.delete'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    await adminMatchesService.remove(req.admin!.userId, req.params.id);
    ok(res, { id: req.params.id, deleted: true });
  }),
);

router.use('/:matchId/events', events);

export default router;

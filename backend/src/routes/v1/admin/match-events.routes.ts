/** Step 7 — Admin match-events nested routes (scoped to :matchId). */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminMatchEventsService } from '../../../admin/services/match-events.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';

const EVENT_TYPES = ['goal', 'own_goal', 'penalty_goal', 'missed_penalty', 'yellow_card', 'red_card', 'substitution', 'var'] as const;

const minute = z.number().int().min(0).max(32767).nullable().optional();

const createBody = z.object({
  team_id: uuidSchema.nullable().optional(),
  player_id: uuidSchema.nullable().optional(),
  assist_player_id: uuidSchema.nullable().optional(),
  type: z.enum(EVENT_TYPES),
  minute,
  extra_minute: minute,
  description: z.string().max(5000).nullable().optional(),
});

const updateBody = z.object({
  team_id: uuidSchema.nullable().optional(),
  player_id: uuidSchema.nullable().optional(),
  assist_player_id: uuidSchema.nullable().optional(),
  type: z.enum(EVENT_TYPES).optional(),
  minute,
  extra_minute: minute,
  description: z.string().max(5000).nullable().optional(),
});

const matchParam = z.object({ matchId: uuidSchema });

const router = Router({ mergeParams: true });

router.get(
  '/',
  requirePermission('match_events.manage'),
  validateRequest({ params: matchParam, query: z.object({ ...adminListBase }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { page: number; limit: number };
    const { rows, pagination } = await adminMatchEventsService.list(req.params.matchId, q);
    ok(res, rows, { pagination });
  }),
);

router.post(
  '/',
  requirePermission('match_events.manage'),
  validateRequest({ params: matchParam, body: createBody }),
  asyncHandler(async (req, res) => {
    const created = await adminMatchEventsService.create(req.admin!.userId, req.params.matchId, req.body);
    res.status(201);
    ok(res, created);
  }),
);

router.patch(
  '/:eventId',
  requirePermission('match_events.manage'),
  validateRequest({ params: matchParam.extend({ eventId: uuidSchema }), body: updateBody }),
  asyncHandler(async (req, res) => {
    ok(res, await adminMatchEventsService.update(req.admin!.userId, req.params.matchId, req.params.eventId, req.body));
  }),
);

router.delete(
  '/:eventId',
  requirePermission('match_events.manage'),
  validateRequest({ params: matchParam.extend({ eventId: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    await adminMatchEventsService.remove(req.admin!.userId, req.params.matchId, req.params.eventId);
    ok(res, { id: req.params.eventId, deleted: true });
  }),
);

export default router;

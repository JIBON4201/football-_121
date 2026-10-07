/**
 * Step 6 — Admin transfers CRUD (reuses public.transfers + transfer_windows).
 *
 * Pipeline: authenticate (router-level) -> requirePermission (DB grants) ->
 * validateRequest -> adminTransfersService (FK/enum/date guards) ->
 * ok() envelope. Mutations are audited (transfers.create/update/delete).
 * Deletes are permanent — the schema has no archived status — and require
 * transfers.delete; nothing references transfers so no cascade is possible.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import {
  ADMIN_TRANSFER_STATUSES,
  ADMIN_TRANSFER_TYPES,
  adminTransfersService,
} from '../../../admin/services/transfers.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import { dateSchema, searchSchema, uuidSchema } from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';

const listQuery = z.object({
  ...adminListBase,
  q: searchSchema,
  status: z.enum(ADMIN_TRANSFER_STATUSES as unknown as [string, ...string[]]).optional(),
  playerId: uuidSchema.optional(),
  fromTeamId: uuidSchema.optional(),
  toTeamId: uuidSchema.optional(),
  windowId: uuidSchema.optional(),
  seasonId: uuidSchema.optional(),
  effectiveFrom: dateSchema.optional(),
  effectiveTo: dateSchema.optional(),
  announcedFrom: dateSchema.optional(),
  announcedTo: dateSchema.optional(),
  sort: z.enum(['asc', 'desc']).optional(),
  sortField: z.enum(['announcement_date', 'effective_date']).optional(),
});

const money = z.number().min(0).max(1e16).nullable().optional();
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter uppercase code')
  .nullable()
  .optional();
const isoDateTime = z.string().datetime({ offset: true }).nullable().optional();
const optionalUuid = uuidSchema.nullable().optional();

const createBody = z.object({
  player_id: uuidSchema,
  season_id: uuidSchema,
  transfer_type: z.enum(ADMIN_TRANSFER_TYPES as unknown as [string, ...string[]]),
  from_team_id: optionalUuid,
  to_team_id: optionalUuid,
  status: z.enum(ADMIN_TRANSFER_STATUSES as unknown as [string, ...string[]]).optional(),
  fee: money,
  currency,
  announcement_date: isoDateTime,
  effective_date: isoDateTime,
  window_id: optionalUuid,
});

const updateBody = z.object({
  player_id: uuidSchema.optional(),
  season_id: uuidSchema.optional(),
  transfer_type: z.enum(ADMIN_TRANSFER_TYPES as unknown as [string, ...string[]]).optional(),
  from_team_id: optionalUuid,
  to_team_id: optionalUuid,
  status: z.enum(ADMIN_TRANSFER_STATUSES as unknown as [string, ...string[]]).optional(),
  fee: money,
  currency,
  announcement_date: isoDateTime,
  effective_date: isoDateTime,
  window_id: optionalUuid,
});

const router = Router();

router.get(
  '/',
  requirePermission('transfers.read'),
  validateRequest({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminTransfersService.list>[0];
    const { rows, pagination } = await adminTransfersService.list(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:id',
  requirePermission('transfers.read'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await adminTransfersService.get(req.params.id));
  }),
);

router.post(
  '/',
  requirePermission('transfers.create'),
  validateRequest({ body: createBody }),
  asyncHandler(async (req, res) => {
    const created = await adminTransfersService.create(req.admin!.userId, req.body);
    res.status(201);
    ok(res, created);
  }),
);

router.patch(
  '/:id',
  requirePermission('transfers.update'),
  validateRequest({ params: z.object({ id: uuidSchema }), body: updateBody }),
  asyncHandler(async (req, res) => {
    ok(res, await adminTransfersService.update(req.admin!.userId, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  requirePermission('transfers.delete'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    await adminTransfersService.remove(req.admin!.userId, req.params.id);
    ok(res, { id: req.params.id, deleted: true });
  }),
);

export default router;

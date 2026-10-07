import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable } from '../../lib/cache';
import { ok } from '../../lib/respond';
import {
  PUBLIC_TRANSFER_STATUSES,
  TRANSFER_TYPES,
  dateSchema,
  limitSchema,
  pageSchema,
  slugSchema,
  sortOrderSchema,
  uuidSchema,
} from '../../lib/validate';
import { validateRequest } from '../../middleware/validateRequest';
import {
  TRANSFER_SORT_FIELDS,
  UNCONFIRMED_TRANSFER_STATUSES,
  type TransferListInput,
} from '../../repositories/transfers.repo';
import { transfersService } from '../../services/transfers.service';

/** Preserves the non-empty tuple shape zod's `enum` requires. */
function statusTuple(...values: string[]): [string, ...string[]] {
  return values as [string, ...string[]];
}

/** All five statuses the model supports: confirmed plus unconfirmed. */
const ALL_TRANSFER_STATUSES = statusTuple(...PUBLIC_TRANSFER_STATUSES, ...UNCONFIRMED_TRANSFER_STATUSES);

const listQuery = z.object({
  page: pageSchema,
  limit: limitSchema,
  /**
   * An unconfirmed status must be requested deliberately and acknowledged with
   * `includeUnconfirmed=true`. Anything else is validated away, so a rumour can
   * never leak into the default confirmed listing.
   */
  status: z.enum(ALL_TRANSFER_STATUSES).optional(),
  includeUnconfirmed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  type: z.enum(TRANSFER_TYPES).optional(),
  player: slugSchema.optional(),
  team: slugSchema.optional(),
  fromTeam: slugSchema.optional(),
  toTeam: slugSchema.optional(),
  season: uuidSchema.optional(),
  window: uuidSchema.optional(),
  announcedFrom: dateSchema.optional(),
  announcedTo: dateSchema.optional(),
  effectiveFrom: dateSchema.optional(),
  effectiveTo: dateSchema.optional(),
  sort: sortOrderSchema,
  sortField: z.enum(TRANSFER_SORT_FIELDS).optional(),
}).superRefine((value, ctx) => {
  // An unconfirmed status is only served when the caller acknowledges it, so a
  // rumour can never appear in the default confirmed listing by accident.
  if (
    value.status &&
    (UNCONFIRMED_TRANSFER_STATUSES as readonly string[]).includes(value.status) &&
    value.includeUnconfirmed !== true
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: `status=${value.status} is not a confirmed transfer; pass includeUnconfirmed=true to request it`,
    });
  }
});

const windowsQuery = z.object({
  page: pageSchema,
  limit: limitSchema,
  season: uuidSchema.optional(),
});

const router = Router();

router.get(
  '/',
  validateRequest({ query: listQuery }),
  cacheable(config.cache.newsTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await transfersService.list(req.query as unknown as TransferListInput);
    ok(res, rows, { pagination });
  }),
);

/**
 * Transfer windows. Registered before `/:id` so the uuid param validator never
 * sees the literal segment "windows". A season is not assumed to have one.
 */
router.get(
  '/windows',
  validateRequest({ query: windowsQuery }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { page: number; limit: number; season?: string };
    const { rows, pagination } = await transfersService.listWindows(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:id/details',
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  cacheable(config.cache.newsTtl),
  asyncHandler(async (req, res) => {
    ok(res, await transfersService.getDetails(req.params.id));
  }),
);

router.get(
  '/:id',
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  cacheable(config.cache.newsTtl),
  asyncHandler(async (req, res) => {
    ok(res, await transfersService.getById(req.params.id));
  }),
);

export default router;

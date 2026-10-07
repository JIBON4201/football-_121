import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable } from '../../lib/cache';
import { ok } from '../../lib/respond';
import { limitSchema, pageSchema, searchSchema, slugSchema, uuidSchema } from '../../lib/validate';
import { validateRequest } from '../../middleware/validateRequest';
import type { CompetitionListInput } from '../../repositories/competitions.repo';
import { competitionsService } from '../../services/competitions.service';
import { standingsService } from '../../services/standings.service';

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const listQuery = z.object({
  page: pageSchema,
  limit: limitSchema,
  q: searchSchema,
  country: slugSchema.optional(),
  active: booleanQuery,
});

const standingsQuery = z.object({
  /** Optional season uuid. Unknown or mismatched seasons resolve to the current one. */
  season: uuidSchema.optional(),
});

const router = Router();

router.get(
  '/',
  validateRequest({ query: listQuery }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await competitionsService.list(
      req.query as unknown as CompetitionListInput,
    );
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:slug',
  validateRequest({ params: z.object({ slug: slugSchema }) }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    ok(res, await competitionsService.getBySlug(req.params.slug));
  }),
);

router.get(
  '/:slug/details',
  validateRequest({ params: z.object({ slug: slugSchema }) }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    ok(res, await competitionsService.getDetails(req.params.slug));
  }),
);

/**
 * League table for a competition, derived server-side from match results.
 * Registered after `/:slug` so the static segment is never shadowed.
 */
router.get(
  '/:slug/standings',
  validateRequest({ params: z.object({ slug: slugSchema }), query: standingsQuery }),
  cacheable(config.cache.matchesTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { season?: string };
    ok(res, await standingsService.get(req.params.slug, q.season ?? null));
  }),
);

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable } from '../../lib/cache';
import { ok } from '../../lib/respond';
import { limitSchema, pageSchema, searchSchema, slugSchema, uuidSchema } from '../../lib/validate';
import { validateRequest } from '../../middleware/validateRequest';
import type { TeamListInput } from '../../repositories/teams.repo';
import { MAX_FORM_RESULTS, teamStatsService } from '../../services/team-stats.service';
import { teamsService } from '../../services/teams.service';

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

const statisticsQuery = z.object({
  /** Optional season uuid. */
  season: uuidSchema.optional(),
  /** Number of recent completed results to include in the form. */
  form: z.coerce.number().int().min(1).max(MAX_FORM_RESULTS).optional(),
});

const router = Router();

router.get(
  '/',
  validateRequest({ query: listQuery }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await teamsService.list(req.query as unknown as TeamListInput);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:slug',
  validateRequest({ params: z.object({ slug: slugSchema }) }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    ok(res, await teamsService.getBySlug(req.params.slug));
  }),
);

router.get(
  '/:slug/details',
  validateRequest({ params: z.object({ slug: slugSchema }) }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    ok(res, await teamsService.getDetails(req.params.slug));
  }),
);

/**
 * Aggregate team statistics and recent form, derived server-side from match
 * results. `/:slug` cannot shadow this because it matches a single segment.
 */
router.get(
  '/:slug/statistics',
  validateRequest({ params: z.object({ slug: slugSchema }), query: statisticsQuery }),
  cacheable(config.cache.matchesTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { season?: string; form?: number };
    ok(res, await teamStatsService.get(req.params.slug, q.season ?? null, q.form));
  }),
);

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable } from '../../lib/cache';
import { ok } from '../../lib/respond';
import { limitSchema, pageSchema, searchSchema, slugSchema, uuidSchema } from '../../lib/validate';
import { validateRequest } from '../../middleware/validateRequest';
import { MAX_PLAYER_STAT_ROWS } from '../../repositories/player-stats.repo';
import type { PlayerListInput } from '../../repositories/players.repo';
import { playerStatsService } from '../../services/player-stats.service';
import { playersService } from '../../services/players.service';

const listQuery = z.object({
  page: pageSchema,
  limit: limitSchema,
  q: searchSchema,
  position: z.string().min(1).max(40).optional(),
  nationality: slugSchema.optional(),
});

const statisticsQuery = z.object({
  /** Optional season uuid. */
  season: uuidSchema.optional(),
  /** Optional competition slug. */
  competition: slugSchema.optional(),
  /** Bound on returned appearances. */
  limit: z.coerce.number().int().min(1).max(MAX_PLAYER_STAT_ROWS).optional(),
});

const router = Router();

router.get(
  '/',
  validateRequest({ query: listQuery }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await playersService.list(req.query as unknown as PlayerListInput);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:slug',
  validateRequest({ params: z.object({ slug: slugSchema }) }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    ok(res, await playersService.getBySlug(req.params.slug));
  }),
);

router.get(
  '/:slug/details',
  validateRequest({ params: z.object({ slug: slugSchema }) }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    ok(res, await playersService.getDetails(req.params.slug));
  }),
);

/**
 * Player statistics, aggregated server-side and scoped by season and/or
 * competition. `/:slug` cannot shadow this because it matches one segment.
 */
router.get(
  '/:slug/statistics',
  validateRequest({ params: z.object({ slug: slugSchema }), query: statisticsQuery }),
  cacheable(config.cache.matchesTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { season?: string; competition?: string; limit?: number };
    ok(
      res,
      await playerStatsService.get(req.params.slug, {
        seasonId: q.season ?? null,
        competitionSlug: q.competition ?? null,
        limit: q.limit,
      }),
    );
  }),
);

export default router;

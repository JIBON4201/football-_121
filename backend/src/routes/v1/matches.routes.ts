import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable } from '../../lib/cache';
import { ok } from '../../lib/respond';
import {
  MATCH_PHASES,
  MATCH_STATUSES,
  dateSchema,
  limitSchema,
  pageSchema,
  slugSchema,
  sortOrderSchema,
  uuidSchema,
} from '../../lib/validate';
import { validateRequest } from '../../middleware/validateRequest';
import type { MatchListInput } from '../../repositories/matches.repo';
import { matchesService } from '../../services/matches.service';

const listQuery = z.object({
  page: pageSchema,
  limit: limitSchema,
  status: z.enum(MATCH_STATUSES).optional(),
  phase: z.enum(MATCH_PHASES).optional(),
  competition: slugSchema.optional(),
  team: slugSchema.optional(),
  season: uuidSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  sort: sortOrderSchema.optional(),
  include: z.enum(['card']).optional(),
});

const feedQuery = z.object({ limit: limitSchema, include: z.enum(['card']).optional() });
const upcomingQuery = z.object({
  limit: limitSchema,
  competition: slugSchema.optional(),
  team: slugSchema.optional(),
  season: uuidSchema.optional(),
  include: z.enum(['card']).optional(),
});

const router = Router();

router.get(
  '/',
  validateRequest({ query: listQuery }),
  cacheable(config.cache.matchesTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as MatchListInput;
    const { rows, pagination } = await matchesService.list(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/live',
  validateRequest({ query: feedQuery }),
  cacheable(config.cache.matchesTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await matchesService.getLive(
      Number(req.query.limit),
      req.query.include === 'card' ? 'card' : undefined,
    );
    // A server-time anchor lets a client compute elapsed time without trusting
    // the device clock. It reveals nothing about the upstream provider.
    ok(res, rows, { pagination, meta: { server_time: new Date().toISOString() } });
  }),
);

router.get(
  '/upcoming',
  validateRequest({ query: upcomingQuery }),
  cacheable(config.cache.matchesTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { limit: number; competition?: string; team?: string; season?: string; include?: string };
    const { rows, pagination } = await matchesService.getUpcoming(Number(q.limit), {
      competition: q.competition,
      team: q.team,
      season: q.season,
      include: q.include === 'card' ? 'card' : undefined,
    });
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/today',
  validateRequest({ query: feedQuery }),
  cacheable(config.cache.matchesTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await matchesService.getToday(
      Number(req.query.limit),
      req.query.include === 'card' ? 'card' : undefined,
    );
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/finished',
  validateRequest({ query: feedQuery }),
  cacheable(config.cache.matchesTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await matchesService.getFinished(
      Number(req.query.limit),
      req.query.include === 'card' ? 'card' : undefined,
    );
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:slug',
  validateRequest({ params: z.object({ slug: slugSchema }) }),
  cacheable(config.cache.matchesTtl),
  asyncHandler(async (req, res) => {
    ok(res, await matchesService.getBySlug(req.params.slug));
  }),
);

router.get(
  '/:slug/details',
  validateRequest({ params: z.object({ slug: slugSchema }) }),
  cacheable(config.cache.matchesTtl),
  asyncHandler(async (req, res) => {
    ok(res, await matchesService.getDetails(req.params.slug));
  }),
);

export default router;

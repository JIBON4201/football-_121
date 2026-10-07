import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable } from '../../lib/cache';
import { ok } from '../../lib/respond';
import {
  ARTICLE_TYPES,
  dateSchema,
  limitSchema,
  pageSchema,
  searchSchema,
  slugSchema,
  sortOrderSchema,
} from '../../lib/validate';
import { validateRequest } from '../../middleware/validateRequest';
import type { NewsListInput } from '../../repositories/news.repo';
import { newsService } from '../../services/news.service';

const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
  .optional();

const listQuery = z.object({
  page: pageSchema,
  limit: limitSchema,
  type: z.enum(ARTICLE_TYPES).optional(),
  category: slugSchema.optional(),
  tag: slugSchema.optional(),
  team: slugSchema.optional(),
  player: slugSchema.optional(),
  competition: slugSchema.optional(),
  match: slugSchema.optional(),
  q: searchSchema,
  sort: sortOrderSchema,
  featured: booleanQuery,
  breaking: booleanQuery,
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

const router = Router();

router.get(
  '/',
  validateRequest({ query: listQuery }),
  cacheable(config.cache.newsTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await newsService.list(req.query as unknown as NewsListInput);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/breaking',
  validateRequest({ query: z.object({ limit: limitSchema }) }),
  cacheable(config.cache.newsTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await newsService.getBreaking(Number(req.query.limit));
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/latest',
  validateRequest({ query: z.object({ limit: limitSchema }) }),
  cacheable(config.cache.newsTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await newsService.getLatest(Number(req.query.limit));
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:slug',
  validateRequest({ params: z.object({ slug: slugSchema }) }),
  cacheable(config.cache.newsTtl),
  asyncHandler(async (req, res) => {
    ok(res, await newsService.getBySlug(req.params.slug));
  }),
);

export default router;

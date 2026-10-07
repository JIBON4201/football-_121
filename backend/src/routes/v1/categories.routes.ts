import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable } from '../../lib/cache';
import { ok } from '../../lib/respond';
import { limitSchema, pageSchema, searchSchema, slugSchema } from '../../lib/validate';
import { validateRequest } from '../../middleware/validateRequest';
import type { CategoryListInput } from '../../repositories/categories.repo';
import { categoriesService } from '../../services/categories.service';

const listQuery = z.object({
  page: pageSchema,
  limit: limitSchema,
  q: searchSchema,
});

const router = Router();

router.get(
  '/',
  validateRequest({ query: listQuery }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    const { rows, pagination } = await categoriesService.list(req.query as unknown as CategoryListInput);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:slug',
  validateRequest({ params: z.object({ slug: slugSchema }) }),
  cacheable(config.cache.staticTtl),
  asyncHandler(async (req, res) => {
    ok(res, await categoriesService.getBySlug(req.params.slug));
  }),
);

export default router;

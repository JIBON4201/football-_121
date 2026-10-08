import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable } from '../../lib/cache';
import { ok } from '../../lib/respond';
import { CANONICAL_ENTITY_TYPES } from '../../seo/canonical';
import { validateRequest } from '../../middleware/validateRequest';
import { seoService, type SeoEntityType, SeoRequestScope } from '../../services/seo.service';

const router = Router();

const entityQuery = z.object({
  type: z.enum(CANONICAL_ENTITY_TYPES as unknown as [string, ...string[]]),
  slug: z.string().min(1).max(300),
});

router.get(
  '/metadata',
  validateRequest({ query: entityQuery }),
  cacheable(config.seo.cacheTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { type: SeoEntityType; slug: string };
    ok(res, await seoService.getMetadata(q.type, q.slug, new SeoRequestScope()));
  }),
);

router.get(
  '/structured',
  validateRequest({ query: entityQuery }),
  cacheable(config.seo.cacheTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { type: SeoEntityType; slug: string };
    ok(res, await seoService.getStructuredData(q.type, q.slug, undefined, new SeoRequestScope()));
  }),
);

router.get(
  '/breadcrumbs',
  validateRequest({ query: entityQuery }),
  cacheable(config.seo.cacheTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { type: SeoEntityType; slug: string };
    ok(res, await seoService.getBreadcrumbs(q.type, q.slug, undefined, new SeoRequestScope()));
  }),
);

router.get(
  '/related',
  validateRequest({
    query: entityQuery.extend({ limit: z.coerce.number().int().min(1).max(20).default(5) }),
  }),
  cacheable(config.seo.cacheTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { type: SeoEntityType; slug: string; limit: number };
    ok(res, await seoService.getRelated(q.type, q.slug, q.limit));
  }),
);

router.get(
  '/validate',
  validateRequest({ query: entityQuery }),
  cacheable(60),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { type: SeoEntityType; slug: string };
    ok(res, await seoService.validate(q.type, q.slug, new SeoRequestScope()));
  }),
);

/**
 * Resolve a previously-published path to its current canonical destination.
 *
 * Redirects are recorded whenever a slug changes, but until now nothing
 * served them, so an old URL 404'd instead of issuing a 301. Returns null
 * when no redirect exists, and also when following the chain would loop —
 * in which case the caller should 404 rather than redirect forever.
 */
router.get(
  '/redirect',
  validateRequest({
    query: z.object({ path: z.string().min(1).max(500).regex(/^\/[A-Za-z0-9_\-./]*$/) }),
  }),
  cacheable(300),
  asyncHandler(async (req, res) => {
    const { path } = req.query as unknown as { path: string };
    const target = await seoService.resolveRedirect(path);
    ok(res, { redirect: target });
  }),
);

export default router;
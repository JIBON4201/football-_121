import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable } from '../../lib/cache';
import { robotsTxt } from '../../seo/robots';
import { validateRequest } from '../../middleware/validateRequest';
import { SITEMAP_PARTITIONS, sitemapService, type SitemapPartition } from '../../services/sitemap.service';

const router = Router();

router.get(
  '/robots.txt',
  cacheable(config.seo.cacheTtl),
  asyncHandler(async (_req, res) => {
    res.type('text/plain').send(robotsTxt());
  }),
);

router.get(
  '/sitemap.xml',
  cacheable(config.seo.cacheTtl),
  asyncHandler(async (_req, res) => {
    res.type('application/xml').send(await sitemapService.getIndex());
  }),
);

router.get(
  '/news-sitemap.xml',
  cacheable(config.seo.cacheTtl),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    res.type('application/xml').send(await sitemapService.getNewsXml(page));
  }),
);

router.get(
  '/sitemaps/:partition.xml',
  validateRequest({
    params: z.object({ partition: z.enum(SITEMAP_PARTITIONS as unknown as [string, ...string[]]) }),
    query: z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }),
  }),
  cacheable(config.seo.cacheTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { page: number };
    res.type('application/xml').send(await sitemapService.getPartitionXml(req.params.partition as SitemapPartition, q.page));
  }),
);

export default router;

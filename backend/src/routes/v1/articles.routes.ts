import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async';
import { noStore } from '../../lib/cache';
import { ok } from '../../lib/respond';
import {
  ARTICLE_STATUSES,
  ARTICLE_TYPES,
  slugSchema,
  uuidSchema,
} from '../../lib/validate';
import { authenticate } from '../../middleware/auth';
import { requireAuth } from '../../middleware/requireRole';
import { validateRequest } from '../../middleware/validateRequest';
import { articlesService, type ArticleStatus } from '../../services/articles.service';

const router = Router();

router.use(authenticate({ required: true }), requireAuth, noStore());

const seoBody = z.object({
  metaTitle: z.string().trim().max(70).optional(),
  metaDescription: z.string().trim().max(160).optional(),
  canonicalUrl: z.string().trim().max(500).optional(),
  robotsIndex: z.boolean().optional(),
  robotsFollow: z.boolean().optional(),
  ogTitle: z.string().trim().max(200).optional(),
  ogDescription: z.string().max(2000).optional(),
  ogImage: z.string().trim().max(500).optional(),
  twitterTitle: z.string().trim().max(200).optional(),
  twitterDescription: z.string().max(2000).optional(),
  twitterImage: z.string().trim().max(500).optional(),
  schemaType: z.string().trim().max(100).optional(),
});

const relationId = z.string().min(1).max(100);

const createBody = z.object({
  title: z.string().min(5).max(300),
  slug: slugSchema.optional(),
  excerpt: z.string().max(2000).optional(),
  content: z.string().min(20).max(200_000),
  articleType: z.enum(ARTICLE_TYPES).default('news'),
  categoryIds: z.array(relationId).max(20).optional(),
  tagIds: z.array(relationId).max(30).optional(),
  teamIds: z.array(relationId).max(50).optional(),
  playerIds: z.array(relationId).max(50).optional(),
  competitionIds: z.array(relationId).max(50).optional(),
  matchIds: z.array(relationId).max(50).optional(),
  featuredImageId: uuidSchema.nullable().optional(),
  isFeatured: z.boolean().optional(),
  isBreaking: z.boolean().optional(),
  seo: seoBody.optional(),
});

const updateBody = z.object({
  title: z.string().min(5).max(300).optional(),
  slug: slugSchema.optional(),
  excerpt: z.string().max(2000).nullable().optional(),
  content: z.string().min(20).max(200_000).optional(),
  articleType: z.enum(ARTICLE_TYPES).optional(),
  featuredImageId: uuidSchema.nullable().optional(),
  isFeatured: z.boolean().optional(),
  isBreaking: z.boolean().optional(),
});

const scheduleBody = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
});

const relationsBody = z.object({
  ids: z.array(relationId).max(50).default([]),
});

router.post(
  '/',
  validateRequest({ body: createBody }),
  asyncHandler(async (req, res) => {
    const created = await articlesService.create(req.user!.id, req.body);
    res.status(201);
    ok(res, created);
  }),
);

router.get(
  '/',
  validateRequest({
    query: z.object({
      status: z.enum(ARTICLE_STATUSES).optional(),
      mine: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { status?: string; mine?: string; limit: number };
    ok(res, await articlesService.listEditorial(req.user!.id, { status: q.status, mine: q.mine === 'true', limit: q.limit }));
  }),
);

router.get(
  '/publish-due',
  asyncHandler(async (_req, res) => {
    // Operator hook for the scheduler/worker: publish due scheduled articles.
    ok(res, await articlesService.publishDue());
  }),
);

router.get(
  '/sitemap',
  asyncHandler(async (req, res) => {
    const q = req.query as { limit?: string; news?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 1000) || 1000, 1), 5000);
    if (q.news === 'true') ok(res, await articlesService.getNewsSitemapEntries(limit));
    else ok(res, await articlesService.getSitemapEntries(limit));
  }),
);

router.get(
  '/:id',
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await articlesService.getEditorial(req.user!.id, req.params.id));
  }),
);

router.patch(
  '/:id',
  validateRequest({ params: z.object({ id: uuidSchema }), body: updateBody }),
  asyncHandler(async (req, res) => {
    ok(res, await articlesService.update(req.user!.id, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    await articlesService.remove(req.user!.id, req.params.id);
    ok(res, { id: req.params.id, deleted: true });
  }),
);

function lifecycle(route: string, to: ArticleStatus, needsSchedule = false) {
  router.post(
    `/:id/${route}`,
    validateRequest({
      params: z.object({ id: uuidSchema }),
      body: needsSchedule ? scheduleBody : z.object({}).strict().optional(),
    }),
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as { scheduledAt?: string };
      ok(res, await articlesService.transition(req.user!.id, req.params.id, to, { scheduledAt: body.scheduledAt }));
    }),
  );
}

lifecycle('submit', 'review');
lifecycle('publish', 'published');
lifecycle('schedule', 'scheduled', true);
lifecycle('archive', 'archived');
lifecycle('restore', 'draft');
lifecycle('unpublish', 'archived');

router.put(
  '/:id/categories',
  validateRequest({ params: z.object({ id: uuidSchema }), body: relationsBody }),
  asyncHandler(async (req, res) => {
    ok(res, { ids: await articlesService.setRelations(req.user!.id, req.params.id, 'categories', req.body.ids) });
  }),
);

router.put(
  '/:id/tags',
  validateRequest({ params: z.object({ id: uuidSchema }), body: relationsBody }),
  asyncHandler(async (req, res) => {
    ok(res, { ids: await articlesService.setRelations(req.user!.id, req.params.id, 'tags', req.body.ids) });
  }),
);

router.put(
  '/:id/teams',
  validateRequest({ params: z.object({ id: uuidSchema }), body: relationsBody }),
  asyncHandler(async (req, res) => {
    ok(res, { ids: await articlesService.setRelations(req.user!.id, req.params.id, 'teams', req.body.ids) });
  }),
);

router.put(
  '/:id/players',
  validateRequest({ params: z.object({ id: uuidSchema }), body: relationsBody }),
  asyncHandler(async (req, res) => {
    ok(res, { ids: await articlesService.setRelations(req.user!.id, req.params.id, 'players', req.body.ids) });
  }),
);

router.put(
  '/:id/competitions',
  validateRequest({ params: z.object({ id: uuidSchema }), body: relationsBody }),
  asyncHandler(async (req, res) => {
    ok(res, { ids: await articlesService.setRelations(req.user!.id, req.params.id, 'competitions', req.body.ids) });
  }),
);

router.put(
  '/:id/matches',
  validateRequest({ params: z.object({ id: uuidSchema }), body: relationsBody }),
  asyncHandler(async (req, res) => {
    ok(res, { ids: await articlesService.setRelations(req.user!.id, req.params.id, 'matches', req.body.ids) });
  }),
);

router.put(
  '/:id/seo',
  validateRequest({ params: z.object({ id: uuidSchema }), body: seoBody }),
  asyncHandler(async (req, res) => {
    ok(res, (await articlesService.setSeo(req.user!.id, req.params.id, req.body)) ?? {});
  }),
);

export default router;

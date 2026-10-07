/**
 * Step 5 — Admin articles CRUD (reuses public.articles + articlesService).
 *
 * Pipeline: authenticate (router-level) -> requirePermission (DB grants) ->
 * validateRequest -> articlesService (role/ownership/lifecycle guards) ->
 * ok() envelope. Audit rows are written by the service layer itself
 * (recordAudit -> audit_logs); no duplicate audit writes here.
 *
 * Lifecycle (unchanged): draft -> review -> published/scheduled/archived;
 * published slugs frozen; breaking_news <=> is_breaking enforced;
 * published/scheduled hard-delete requires super_admin/admin (else archive).
 */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../admin/rbac';
import { adminArticlesService } from '../../../admin/services/articles.admin.service';
import { adminListBase } from '../../../admin/validate';
import { asyncHandler } from '../../../lib/async';
import { ok } from '../../../lib/respond';
import {
  ARTICLE_STATUSES,
  ARTICLE_TYPES,
  dateSchema,
  searchSchema,
  slugSchema,
  uuidSchema,
} from '../../../lib/validate';
import { validateRequest } from '../../../middleware/validateRequest';
import { articlesService } from '../../../services/articles.service';

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const relationId = z.string().min(1).max(100);

const listQuery = z.object({
  ...adminListBase,
  q: searchSchema,
  status: z.enum(ARTICLE_STATUSES).optional(),
  article_type: z.enum(ARTICLE_TYPES).optional(),
  categoryId: relationId.optional(),
  authorId: relationId.optional(),
  featured: booleanQuery,
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  sort: z.enum(['created_at', 'published_at', 'updated_at']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

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

const router = Router();

router.get(
  '/',
  requirePermission('articles.read'),
  validateRequest({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as Parameters<typeof adminArticlesService.list>[0];
    const { rows, pagination } = await adminArticlesService.list(q);
    ok(res, rows, { pagination });
  }),
);

router.get(
  '/:id',
  requirePermission('articles.read'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await articlesService.getEditorial(req.admin!.userId, req.params.id));
  }),
);

router.post(
  '/',
  requirePermission('articles.create'),
  validateRequest({ body: createBody }),
  asyncHandler(async (req, res) => {
    const created = await articlesService.create(req.admin!.userId, req.body);
    res.status(201);
    ok(res, created);
  }),
);

router.patch(
  '/:id',
  requirePermission('articles.update'),
  validateRequest({ params: z.object({ id: uuidSchema }), body: updateBody }),
  asyncHandler(async (req, res) => {
    ok(res, await articlesService.update(req.admin!.userId, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  requirePermission('articles.delete'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    await articlesService.remove(req.admin!.userId, req.params.id);
    ok(res, { id: req.params.id, deleted: true });
  }),
);

router.post(
  '/:id/submit',
  requirePermission('articles.update'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await articlesService.transition(req.admin!.userId, req.params.id, 'review'));
  }),
);

router.post(
  '/:id/publish',
  requirePermission('articles.publish'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await articlesService.transition(req.admin!.userId, req.params.id, 'published'));
  }),
);

router.post(
  '/:id/schedule',
  requirePermission('articles.publish'),
  validateRequest({ params: z.object({ id: uuidSchema }), body: z.object({ scheduledAt: z.string().datetime({ offset: true }) }) }),
  asyncHandler(async (req, res) => {
    ok(res, await articlesService.transition(req.admin!.userId, req.params.id, 'scheduled', { scheduledAt: req.body.scheduledAt }));
  }),
);

router.post(
  '/:id/archive',
  requirePermission('articles.update'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await articlesService.transition(req.admin!.userId, req.params.id, 'archived'));
  }),
);

router.post(
  '/:id/restore',
  requirePermission('articles.update'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await articlesService.transition(req.admin!.userId, req.params.id, 'draft'));
  }),
);

router.post(
  '/:id/unpublish',
  requirePermission('articles.publish'),
  validateRequest({ params: z.object({ id: uuidSchema }) }),
  asyncHandler(async (req, res) => {
    ok(res, await articlesService.transition(req.admin!.userId, req.params.id, 'archived'));
  }),
);

export default router;

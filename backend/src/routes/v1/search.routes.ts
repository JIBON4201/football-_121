import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { cacheable } from '../../lib/cache';
import { ok } from '../../lib/respond';
import { SEARCHABLE_ENTITY_TYPES } from '../../lib/urls';
import { dateSchema, limitSchema, pageSchema, uuidSchema } from '../../lib/validate';
import { validateRequest } from '../../middleware/validateRequest';
import type { SearchInput } from '../../services/search.service';
import { searchService } from '../../services/search.service';

const searchQuery = z.object({
  q: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value.trim().length > 0, 'Query must not be blank'),
  type: z.enum(SEARCHABLE_ENTITY_TYPES).optional(),
  competition_id: uuidSchema.optional(),
  team_id: uuidSchema.optional(),
  player_id: uuidSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: pageSchema,
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const router = Router();

router.get(
  '/',
  validateRequest({ query: searchQuery }),
  cacheable(config.cache.newsTtl),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as {
      q: string;
      type?: SearchInput['type'];
      competition_id?: string;
      team_id?: string;
      player_id?: string;
      from?: string;
      to?: string;
      page: number;
      limit: number;
    };
    const { results, pagination } = await searchService.search({
      q: q.q,
      type: q.type,
      competitionId: q.competition_id,
      teamId: q.team_id,
      playerId: q.player_id,
      from: q.from,
      to: q.to,
      page: q.page,
      limit: q.limit,
    });
    ok(res, results, { pagination });
  }),
);

export default router;

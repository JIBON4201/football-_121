import { Router } from 'express';
import { asyncHandler } from '../../lib/async';
import { noStore } from '../../lib/cache';
import { ok } from '../../lib/respond';
import { getUserRoles } from '../../lib/roles';
import { requireAuth } from '../../middleware/requireRole';

const router = Router();

/** Authenticated identity probe. Private — never cached. */
router.get(
  '/',
  requireAuth,
  noStore(),
  asyncHandler(async (req, res) => {
    const roles = await getUserRoles(req.user!.id);
    ok(res, { id: req.user!.id, email: req.user!.email ?? null, roles });
  }),
);

export default router;

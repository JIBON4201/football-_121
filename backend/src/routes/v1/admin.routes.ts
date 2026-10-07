/**
 * Step 4 — Protected Admin API namespace (/api/v1/admin/*).
 *
 * Pipeline per request: authenticate({required:true}) -> admin guard
 * (requireAdmin/requirePermission, server-side DB checks) -> noStore() ->
 * validateRequest -> admin service (serviceClient) -> ok() envelope.
 * No business logic lives in handlers; no writes exist yet (reads only).
 *
 * Module map: dashboard, articles (breaking-news via ?article_type=),
 * transfers (windows via transfer_windows table), matches (events/lineups
 * pending Step 5), teams, players, competitions (seasons nested via
 * ?competition_id=), seasons, venues, media, users, roles, audit-logs.
 * Pending: categories, tags, settings, permissions (Step 5).
 */
import { Router } from 'express';
import { noStore } from '../../lib/cache';
import { ok } from '../../lib/respond';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/async';
import { requireAdmin } from '../../admin/rbac';
import { adminBypassEnabled } from '../../admin/bypass';
import articles from './admin/articles.routes';
import auditLogs from './admin/audit-logs.routes';
import competitions from './admin/competitions.routes';
import dashboard from './admin/dashboard.routes';
import matches from './admin/matches.routes';
import media from './admin/media.routes';
import permissions from './admin/permissions.routes';
import players from './admin/players.routes';
import roles from './admin/roles.routes';
import seasons from './admin/seasons.routes';
import settings from './admin/settings.routes';
import teams from './admin/teams.routes';
import transfers from './admin/transfers.routes';
import users from './admin/users.routes';
import venues from './admin/venues.routes';

const router = Router();

// DEV-ONLY: in bypass mode there is no session cookie to verify, so the token
// requirement is skipped entirely and requireAdmin* install a synthetic
// super_admin. Never active when NODE_ENV=production (admin/bypass.ts).
if (!adminBypassEnabled()) {
  router.use(authenticate({ required: true }));
}
router.use(noStore());

router.get(
  '/ping',
  requireAdmin(),
  asyncHandler(async (req, res) => {
    ok(res, { ok: true, userId: req.admin?.userId ?? null });
  }),
);

/** Identity + grants for the Admin Panel shell (sidebar filtering). */
router.get(
  '/me',
  requireAdmin(),
  asyncHandler(async (req, res) => {
    ok(res, {
      id: req.admin?.userId ?? null,
      email: req.user?.email ?? null,
      roles: req.admin?.roles ?? [],
      permissions: req.admin?.permissions ?? [],
      // Tells the frontend it may render without a session cookie.
      bypass: adminBypassEnabled(),
    });
  }),
);

router.use('/dashboard', dashboard);
router.use('/articles', articles);
router.use('/transfers', transfers);
router.use('/matches', matches);
router.use('/teams', teams);
router.use('/players', players);
router.use('/competitions', competitions);
router.use('/seasons', seasons);
router.use('/venues', venues);
router.use('/media', media);
router.use('/settings', settings);
router.use('/users', users);
router.use('/roles', roles);
router.use('/permissions', permissions);
router.use('/audit-logs', auditLogs);

export default router;

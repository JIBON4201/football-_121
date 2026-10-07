/**
 * Step 16 — Public auth exchange for the Admin Panel (Supabase-backed).
 *
 * The frontend (which holds no Supabase keys by design) posts credentials
 * here; Supabase verifies them. Sessions live in httpOnly cookies set by
 * the frontend route handler — this API returns tokens in-body only so the
 * caller can decide cookie scope. Failures are generic (no user-oracle).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/async';
import { noStore } from '../../lib/cache';
import { ok } from '../../lib/respond';
import { unauthorized } from '../../lib/errors';
import { validateRequest } from '../../middleware/validateRequest';
import { passwordSignIn, passwordSignOut } from '../../auth/passwordAuth';

const router = Router();

router.use(noStore());

router.post(
  '/login',
  validateRequest({
    body: z.object({
      email: z.string().trim().email().max(255),
      password: z.string().min(1).max(1024),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { email: string; password: string };
    try {
      const session = await passwordSignIn(body.email, body.password);
      ok(res, {
        user: session.user,
        session: {
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
          expires_in: session.expiresIn,
          token_type: 'bearer',
        },
      });
    } catch {
      throw unauthorized('Invalid email or password');
    }
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization;
    const accessToken = header?.toLowerCase().startsWith('bearer ')
      ? header.slice(7)
      : undefined;
    const refreshToken =
      (req.body as { refresh_token?: unknown } | undefined)?.refresh_token &&
      typeof (req.body as { refresh_token?: unknown }).refresh_token === 'string'
        ? ((req.body as { refresh_token?: string }).refresh_token as string)
        : undefined;
    await passwordSignOut(accessToken, refreshToken);
    ok(res, { ok: true });
  }),
);

export default router;

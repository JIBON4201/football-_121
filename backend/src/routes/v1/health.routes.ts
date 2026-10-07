import { Router } from 'express';
import { config } from '../../config';
import { asyncHandler } from '../../lib/async';
import { noStore } from '../../lib/cache';
import { ok } from '../../lib/respond';
import { anonClient } from '../../lib/supabase';

const router = Router();
const VERSION = '1.0.0';

router.get('/', (_req, res) => {
  ok(res, {
    status: 'ok',
    service: config.serviceName,
    version: VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

/** Database liveness. Never exposes credentials or connection details. */
router.get(
  '/database',
  noStore(),
  asyncHandler(async (req, res) => {
    const requestId = (res.locals as { requestId?: string }).requestId ?? 'unknown';
    const degraded = (): void => {
      res.status(503).json({
        data: { status: 'degraded', service: config.serviceName, version: VERSION },
        requestId,
      });
    };

    // Three failure modes must all be reported as degraded, never as "ok":
    //   1. the client constructor throws (missing/invalid SUPABASE_URL);
    //   2. the query errors (unreachable, auth failure, RLS denial);
    //   3. the schema is absent.
    //
    // Mode 3 is why this must not use `head: true`. A HEAD request against a
    // missing table returns 404 with no body, which left `error` null and made
    // this endpoint report "ok" against a database where no migrations had ever
    // been applied. A one-row select costs ~30 bytes and surfaces the failure.
    try {
      const { error, count, data } = await anonClient()
        .from('countries')
        .select('id', { count: 'exact' })
        .limit(1);
      if (error || data === null || count === null || count === undefined) {
        degraded();
        return;
      }
    } catch {
      degraded();
      return;
    }
    ok(res, { status: 'ok', service: config.serviceName, version: VERSION });
  }),
);

export default router;

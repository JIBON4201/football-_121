import express, { type Express } from 'express';
import { config } from './config';
import { MemoryCacheStore, setCacheStore } from './lib/cache';
import { rateLimit } from './lib/rateLimit';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestContext } from './middleware/requestContext';
import { applySecurity } from './middleware/security';
import v1 from './routes';

export function createApp(): Express {
  // Install the read-through service cache. Per-process memory only: on
  // serverless each instance holds its own store, a cold instance simply
  // starts empty (correct by design), and admin writes invalidate namespaces
  // through the same hooks. Bounded by CACHE_MAX_ENTRIES.
  setCacheStore(new MemoryCacheStore(config.cache.maxEntries));

  const app = express();

  // Behind N trusted proxy hops so req.ip reflects the client, not the
  // proxy — otherwise IP-keyed rate limits collapse all users into one
  // bucket. Configure TRUST_PROXY_HOPS per the deployment.
  app.set('trust proxy', config.trustProxyHops);

  app.use(requestContext);
  applySecurity(app);
  // Single optional authentication point: verifies one Bearer token per
  // request (if present) so rate-limit tiers and RBAC share one identity.
  app.use(authenticate({ required: false }));
  app.use(rateLimit());

  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

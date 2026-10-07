import express, { type Express } from 'express';
import { config } from './config';
import { rateLimit } from './lib/rateLimit';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestContext } from './middleware/requestContext';
import { applySecurity } from './middleware/security';
import v1 from './routes';

export function createApp(): Express {
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

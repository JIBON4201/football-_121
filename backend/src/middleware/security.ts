import cors from 'cors';
import type { Express, NextFunction, Request, Response } from 'express';
import { json } from 'express';
import helmet from 'helmet';
import { config } from '../config';
import { ApiError } from '../lib/errors';

function contentTypeGuard(req: Request, _res: Response, next: NextFunction): void {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const length = Number(req.headers['content-length'] ?? '0');
    const hasBody = length > 0 || Boolean(req.headers['transfer-encoding']);
    if (hasBody) {
      const rawType = String(req.headers['content-type'] ?? '');
      const mime = rawType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
      if (mime !== 'application/json') {
        next(new ApiError(415, 'VALIDATION_ERROR', 'Content-Type must be application/json'));
        return;
      }
    }
  }
  next();
}

export function applySecurity(app: Express): void {
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      // Strict allowlist — never '*' for credentialed/authenticated APIs.
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new ApiError(403, 'FORBIDDEN', 'Origin not allowed'));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      credentials: false,
      maxAge: 600,
    }),
  );
  // JSON body cap covers the largest legitimate payload (media base64
  // uploads). Other routes validate much smaller shapes via zod; the
  // reverse proxy should enforce its own tighter edge limits.
  const jsonLimit = `${Math.ceil((config.media.maxUploadBytes * 1.4 + 1024 * 1024) / 1024 / 1024)}mb`;
  app.use(json({ limit: jsonLimit, strict: true }));
  app.use(contentTypeGuard);
}

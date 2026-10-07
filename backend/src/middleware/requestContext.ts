import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { log } from '../lib/logger';

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    log({
      requestId,
      method: req.method,
      route: req.originalUrl,
      status: res.statusCode,
      latencyMs: Date.now() - startedAt,
      userId: req.user?.id ?? null,
    });
  });
  next();
}

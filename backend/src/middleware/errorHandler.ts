import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { ApiError, notFound } from '../lib/errors';
import { logError } from '../lib/logger';

/** 404 for unknown routes. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(notFound(`Route ${req.method} ${req.path}`));
}

/** Centralized error mapping. Production 500s never leak internals. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = (res.locals as { requestId?: string }).requestId ?? 'unknown';

  if (err instanceof ApiError) {
    if (err.status >= 500) {
      logError({ requestId, code: err.code, message: err.message, route: req.originalUrl });
    }
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      requestId,
    });
    return;
  }

  if (err instanceof Error && /cors/i.test(err.message)) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Origin not allowed' }, requestId });
    return;
  }

  // Body-parser failures are client errors, not server faults. Without this
  // mapping an oversized or malformed body produced a 500 and was logged as an
  // internal error.
  const bodyParserType = (err as { type?: string } | null)?.type;
  if (bodyParserType === 'entity.too.large') {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
      requestId,
    });
    return;
  }
  if (bodyParserType === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body' },
      requestId,
    });
    return;
  }

  logError({
    requestId,
    route: req.originalUrl,
    message: err instanceof Error ? err.message : 'Unknown error',
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: config.isProd ? 'Unexpected server error' : 'Unexpected server error',
    },
    requestId,
  });
}

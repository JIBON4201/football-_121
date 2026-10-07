import type { Response } from 'express';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface OkOptions {
  pagination?: PaginationMeta;
  meta?: Record<string, unknown>;
}

function requestIdOf(res: Response): string {
  const id = (res.locals as { requestId?: unknown }).requestId;
  return typeof id === 'string' && id.length > 0 ? id : 'unknown';
}

export function ok(res: Response, data: unknown, options: OkOptions = {}): void {
  res.json({
    data,
    ...(options.pagination ? { pagination: options.pagination } : {}),
    ...(options.meta ? { meta: options.meta } : {}),
    requestId: requestIdOf(res),
  });
}

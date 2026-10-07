import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { rateLimited } from '../lib/errors';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Test seam: clear upload buckets. */
export function resetUploadRateLimits(): void {
  buckets.clear();
}

/**
 * Strict per-uploader rate limiter for media uploads (default 30/min).
 * Separate from the global API limiter so abusive uploads never starve reads.
 */
export function uploadRateLimit() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    const key = `media-upload:${userId ?? req.ip ?? 'unknown'}`;
    const now = Date.now();
    const max = config.media.uploadRateLimitPerMin;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + 60_000 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      next(rateLimited('Too many uploads, please slow down'));
      return;
    }
    next();
  };
}

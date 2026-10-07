import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { rateLimited } from './errors';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Step 41 — cost classes.
 *
 * A single flat limit treats a trivial `/health` probe exactly like a trigram
 * search or a full sitemap generation, so an expensive endpoint can exhaust the
 * budget that ordinary browsing relies on. Each class gets its own budget and
 * its own bucket, which also stops an attacker from blending classes to bypass
 * one limiter.
 */
export type RateLimitClass = 'default' | 'expensive' | 'media' | 'auth';

export interface RateLimitClassConfig {
  /** Max requests per window for this class. */
  max: number;
}

function sweep(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

const sweeper = setInterval(sweep, 60_000);
sweeper.unref();

/** Test seam: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Classify a request by path.
 */
export function classifyRequest(path: string): RateLimitClass {
  // Express `req.path` excludes the query string, but strip it defensively so
  // classification cannot be bypassed by appending `?...` when called directly.
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? '';
  const normalized = withoutQuery.replace(/^\/api\/v1/, '') || '/';

  if (normalized === '/media/upload') return 'media';
  // Credential endpoints get the tightest budget to blunt password spraying.
  if (normalized === '/auth/login' || normalized === '/auth/register' || normalized === '/auth/forgot-password' || normalized === '/auth/reset-password') return 'auth';
  if (normalized === '/search' || normalized.startsWith('/search/')) return 'expensive';
  // Sitemap generation walks whole tables and is never on a user-critical path.
  if (
    normalized === '/sitemap.xml' ||
    normalized === '/news-sitemap.xml' ||
    normalized.startsWith('/sitemaps/')
  ) {
    return 'expensive';
  }
  return 'default';
}

function limitsFor(authed: boolean): Record<RateLimitClass, number> {
  const base = authed ? config.rateLimit.authedMax : config.rateLimit.publicMax;
  return {
    default: base,
    // Expensive reads are capped well below ordinary browsing.
    expensive: Math.max(5, Math.floor(base / 6)),
    // Uploads are already separately limited by uploadRateLimit; this is the
    // coarse global guard so uploads cannot dominate the request budget.
    media: Math.max(10, Math.floor(base / 2)),
    // Auth endpoints: 10/min max, blunts credential stuffing.
    auth: Math.max(5, Math.floor(base / 12)),
  };
}

/**
 * Tiered in-memory rate limiter with per-class budgets and standard
 * `RateLimit-*` headers.
 *
 * Replace the backing Map with Redis for multi-instance deployments; the
 * per-instance map means limits are enforced per process.
 */
export function rateLimit() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authed = Boolean((req as Request & { user?: unknown }).user);
    const tier = classifyRequest(req.path ?? '/');
    const max = limitsFor(authed)[tier];

    const key = `${req.ip ?? 'unknown'}:${authed ? 'authed' : 'public'}:${tier}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + config.rateLimit.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const resetSeconds = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));

    // Consistent, machine-readable limit signalling on every response.
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));
    res.setHeader('RateLimit-Policy', `${max};w=${Math.floor(config.rateLimit.windowMs / 1000)}`);

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, resetSeconds)));
      next(rateLimited('Too many requests, please slow down'));
      return;
    }
    next();
  };
}
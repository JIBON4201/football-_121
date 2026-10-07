import type { NextFunction, Request, Response } from 'express';

/**
 * Caching abstraction. Public GET resources emit Cache-Control so a future
 * Redis/CDN layer (or edge cache) can be introduced without touching
 * controllers. Private/user data must use noStore().
 */
export type CacheVisibility = 'public' | 'private';

export function cacheHeaderValue(maxAgeSeconds: number, visibility: CacheVisibility = 'public'): string {
  return `${visibility}, max-age=${maxAgeSeconds}, stale-while-revalidate=${Math.max(0, Math.floor(maxAgeSeconds / 2))}`;
}

export function cacheable(maxAgeSeconds: number, visibility: CacheVisibility = 'public') {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Cache-Control', cacheHeaderValue(maxAgeSeconds, visibility));
    res.setHeader('Vary', 'Authorization, Accept-Encoding');
    next();
  };
}

export function noStore() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  };
}

/** Future Redis/CDN adapter shape. Default backends below are no-ops. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export class NoopCacheStore implements CacheStore {
  async get(): Promise<null> {
    return null;
  }
  async set(): Promise<void> {
    return undefined;
  }
  async del(): Promise<void> {
    return undefined;
  }
}

/** Stable cache-key builder for future response caching. */
export function cacheKey(prefix: string, parts: Record<string, unknown>): string {
  const serialized = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${JSON.stringify(parts[k])}`)
    .join('&');
  return `v1:${prefix}:${serialized}`;
}

/** In-memory store. Single-instance only — swap for Redis via setCacheStore. */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      // Evict the oldest entry (Map preserves insertion order) to bound memory.
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  size(): number {
    return this.entries.size;
  }
}

let activeStore: CacheStore = new NoopCacheStore();

/** Swap the backing store (e.g. Redis adapter). Services stay unchanged. */
export function setCacheStore(store: CacheStore): void {
  activeStore = store;
}

export function resetCacheStore(): void {
  activeStore = new NoopCacheStore();
  keyRegistry.clear();
}

/** Keys issued per namespace, enabling explicit invalidation hooks. */
const keyRegistry = new Map<string, Set<string>>();

function registerKey(namespace: string, key: string): void {
  let keys = keyRegistry.get(namespace);
  if (!keys) {
    keys = new Set();
    keyRegistry.set(namespace, keys);
  }
  keys.add(key);
}

/**
 * Read-through cache for public service results. Failures fall back to the
 * loader — a cache outage must never break reads. Never use for private data.
 */
export async function cached<T>(
  namespace: string,
  parts: Record<string, unknown>,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const key = cacheKey(namespace, parts);
  try {
    const hit = await activeStore.get(key);
    if (hit !== null) {
      registerKey(namespace, key);
      return JSON.parse(hit) as T;
    }
  } catch {
    // Fall through to loader on cache errors.
  }
  const value = await loader();
  try {
    await activeStore.set(key, JSON.stringify(value), ttlSeconds);
    registerKey(namespace, key);
  } catch {
    // Caching is best-effort.
  }
  return value;
}

/**
 * Invalidation hook for service-layer updates (article/match/team/player/
 * competition/transfer changes). Deletes every key issued under the
 * namespace. Single-instance registry — pair with Redis keyspace
 * notifications or pub/sub when scaling horizontally.
 */
export async function invalidateNamespace(namespace: string): Promise<void> {
  const keys = keyRegistry.get(namespace);
  if (!keys) return;
  await Promise.all([...keys].map((key) => activeStore.del(key).catch(() => undefined)));
  keys.clear();
}

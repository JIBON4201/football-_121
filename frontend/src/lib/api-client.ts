import type { ApiEnvelope } from '@/types/api';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Normalized client for /api/v1. All components go through here — no raw fetch. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly isTimeout: boolean;
  readonly isNetworkError: boolean;
  /**
   * Per-field validation messages, when the backend reported them. The
   * Control Center maps these straight back onto form inputs so an operator
   * sees which field failed instead of one opaque banner.
   */
  readonly fields?: Record<string, string>;
  /** Parsed `Retry-After`, in seconds. Only set for 429. */
  readonly retryAfterSeconds?: number;

  constructor(options: {
    message: string;
    status: number;
    code: string;
    requestId?: string;
    isTimeout?: boolean;
    isNetworkError?: boolean;
    fields?: Record<string, string>;
    retryAfterSeconds?: number;
  }) {
    super(options.message);
    this.name = 'ApiClientError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.isTimeout = options.isTimeout ?? false;
    this.isNetworkError = options.isNetworkError ?? false;
    this.fields = options.fields;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface ApiRequestOptions {
  method?: HttpMethod;
  /** Query params; undefined values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Caller-owned cancellation signal (linked, never replaced). */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Retry budget for safe idempotent requests. Defaults: GET → 2, others → 0. */
  retry?: number;
  /** Bearer token for authenticated requests. */
  authToken?: string;
  /**
   * Next.js fetch cache tiers. Forwarded verbatim to fetch so server
   * components can set per-request revalidation without a second client.
   * Ignored outside the App Router (e.g. unit tests with mocked fetch).
   */
  next?: { revalidate?: number; tags?: string[] };
  /**
   * Explicit fetch cache policy (e.g. 'no-store' for admin reads). Forwarded
   * verbatim; Next treats dynamic-route fetches as uncached, but admin calls
   * should never rely on that implication.
   */
  cache?: RequestCache;
}

export interface ApiClientConfig {
  baseUrl: string;
  defaultTimeoutMs?: number;
  getToken?: () => string | null | Promise<string | null>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

function buildUrl(baseUrl: string, path: string, query?: ApiRequestOptions['query']): string {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/v1${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pull per-field messages out of a backend `details` payload.
 *
 * `validateRequest` rejects with `error.flatten()`, i.e.
 * `{ formErrors: string[], fieldErrors: { <field>: string[] } }`. Only the first
 * message per field is kept: a form can render one message per input, and the
 * remaining entries are usually the same rule restated.
 */
function extractFieldErrors(details: unknown): Record<string, string> | undefined {
  if (details === null || typeof details !== 'object') return undefined;
  const container = details as { fieldErrors?: unknown; field_errors?: unknown };
  const source = container.fieldErrors ?? container.field_errors;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return undefined;

  const fields: Record<string, string> = {};
  for (const [field, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === 'string') {
      fields[field] = value;
    } else if (Array.isArray(value)) {
      const first = value.find((entry): entry is string => typeof entry === 'string');
      if (first) fields[field] = first;
    }
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/** `Retry-After` is delta-seconds or an HTTP date; only the former is honoured. */
function parseRetryAfter(headers: Headers | undefined): number | undefined {
  // Defensive: `fetch` always supplies Headers, but partial Response stand-ins
  // (test doubles, some polyfills) may not.
  const header = typeof headers?.get === 'function' ? headers.get('Retry-After') : null;
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const asDate = Date.parse(header);
  if (Number.isNaN(asDate)) return undefined;
  const delta = Math.ceil((asDate - Date.now()) / 1000);
  return delta > 0 ? delta : undefined;
}

/** Only idempotent GET requests may be retried. */
function isRetryable(method: HttpMethod, error: ApiClientError): boolean {
  if (method !== 'GET') return false;
  if (error.isTimeout || error.isNetworkError) return true;
  return error.status === 429 || error.status >= 500;
}

export function createApiClient(config: ApiClientConfig) {
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiEnvelope<T>> {
    const method = options.method ?? 'GET';
    const maxRetries = options.retry ?? (method === 'GET' ? MAX_RETRIES : 0);
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    const url = buildUrl(config.baseUrl, path, options.query);

    const token = options.authToken ?? (await config.getToken?.()) ?? null;
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let attempt = 0;
    for (;;) {
      attempt += 1;
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (options.signal) {
        if (options.signal.aborted) throw new ApiClientError({ message: 'Request cancelled', status: 0, code: 'CANCELLED' });
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const fetchInit = {
        method,
        headers,
        body,
        signal: controller.signal,
        ...(options.next ? { next: options.next } : {}),
        ...(options.cache ? { cache: options.cache } : {}),
      };
      try {
        const response = await fetch(url, fetchInit as RequestInit & { next?: { revalidate?: number; tags?: string[] } });
        const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> & {
          error?: { code?: string; message?: string; details?: unknown };
        } | null;
        if (!response.ok) {
          const error = new ApiClientError({
            message: envelope?.error?.message ?? `Request failed (${response.status})`,
            status: response.status,
            code: envelope?.error?.code ?? 'REQUEST_FAILED',
            requestId: envelope?.requestId,
            fields: extractFieldErrors(envelope?.error?.details),
            retryAfterSeconds: parseRetryAfter(response.headers),
          });
          if (attempt <= maxRetries && isRetryable(method, error)) {
            await sleep(250 * 2 ** (attempt - 1));
            continue;
          }
          throw error;
        }
        if (!envelope || !('data' in envelope)) {
          throw new ApiClientError({ message: 'Malformed API response', status: 502, code: 'BAD_RESPONSE' });
        }
        return envelope as ApiEnvelope<T>;
      } catch (error) {
        if (error instanceof ApiClientError) throw error;
        const name = error instanceof Error ? error.name : '';
        const isTimeout = name === 'AbortError' || name === 'TimeoutError';
        const normalized = new ApiClientError({
          message: options.signal?.aborted ? 'Request cancelled' : isTimeout ? 'Request timed out' : 'Network request failed',
          status: 0,
          code: options.signal?.aborted ? 'CANCELLED' : isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
          isTimeout,
          isNetworkError: !isTimeout && !options.signal?.aborted,
        });
        if (attempt <= maxRetries && isRetryable(method, normalized)) {
          await sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        throw normalized;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
  }

  return {
    request,
    get: <T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'GET' }),
    post: <T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'POST', body }),
  };
}

/** Default client bound to environment config (lazy base URL). */
export function createDefaultClient(getToken?: ApiClientConfig['getToken']) {
  const baseUrl =
    (typeof process !== 'undefined' && process.env.API_URL) ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:4000';
  return createApiClient({ baseUrl, getToken });
}

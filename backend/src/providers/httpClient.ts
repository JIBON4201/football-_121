import { randomUUID } from 'node:crypto';
import { log } from '../lib/logger';

export type HttpErrorCode =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'AUTH'
  | 'NOT_FOUND'
  | 'HTTP'
  | 'TOO_LARGE'
  | 'INVALID_JSON';

/** Structured, secret-free HTTP failure. `retryable` drives backoff. */
export class ProviderHttpError extends Error {
  readonly code: HttpErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(code: HttpErrorCode, message: string, status?: number, retryable = false) {
    super(message);
    this.name = 'ProviderHttpError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  keyHeader?: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  requestsPerMinute?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Server-side provider HTTP client: timeouts, transient-only retries with
 * exponential backoff, 429/Retry-After handling, response-size caps and
 * secret-free structured logging.
 */
export class ProviderHttpClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly minIntervalMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;
  private lastRequestAt = 0;

  constructor(private readonly options: HttpClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.minIntervalMs = 60_000 / (options.requestsPerMinute ?? 60);
    this.maxResponseBytes = options.maxResponseBytes ?? 5_000_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.options.baseUrl);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const correlationId = randomUUID();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Correlation-Id': correlationId,
    };
    if (this.options.apiKey) {
      headers[this.options.keyHeader ?? 'X-Api-Key'] = this.options.apiKey;
    }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    await this.pace();
    const startedAt = Date.now();
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let response: Response;
        try {
          response = await this.fetchImpl(url.toString(), {
            method: opts.method ?? 'GET',
            headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        const durationMs = Date.now() - startedAt;
        log({
          msg: 'provider_http',
          method: opts.method ?? 'GET',
          host: url.host,
          path: url.pathname,
          status: response.status,
          attempt,
          durationMs,
        });

        if (response.status === 429) {
          const rawRetryAfter = response.headers.get('retry-after') ?? '1';
          const parsed = Number(rawRetryAfter);
          const retryAfter = Number.isFinite(parsed) ? Math.min(60, Math.max(1, parsed)) : 1;
          if (attempt <= this.maxRetries) {
            await sleep(retryAfter * 1000);
            continue;
          }
          throw new ProviderHttpError('RATE_LIMITED', 'Provider rate limit exceeded', 429, true);
        }
        if (response.status >= 500) {
          if (attempt <= this.maxRetries && response.status !== 501) {
            await this.backoff(attempt);
            continue;
          }
          throw new ProviderHttpError('HTTP', `Provider error ${response.status}`, response.status, response.status !== 501);
        }
        if (response.status === 401 || response.status === 403) {
          throw new ProviderHttpError('AUTH', 'Provider authentication failed', response.status, false);
        }
        if (response.status === 404) {
          throw new ProviderHttpError('NOT_FOUND', 'Provider resource not found', 404, false);
        }
        if (response.status < 200 || response.status >= 300) {
          throw new ProviderHttpError('HTTP', `Provider request failed (${response.status})`, response.status, false);
        }

        const declared = Number(response.headers.get('content-length') ?? '0');
        if (declared > this.maxResponseBytes) {
          throw new ProviderHttpError('TOO_LARGE', 'Provider response exceeds size limit', 200, false);
        }
        const text = await this.readCapped(response);
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ProviderHttpError('INVALID_JSON', 'Provider returned malformed JSON', 200, false);
        }
      } catch (error) {
        if (error instanceof ProviderHttpError) {
          if (!error.retryable || attempt > this.maxRetries) throw error;
        } else if (error instanceof Error && error.name === 'AbortError') {
          if (attempt > this.maxRetries) throw new ProviderHttpError('TIMEOUT', 'Provider request timed out', undefined, true);
        } else {
          if (attempt > this.maxRetries) {
            throw new ProviderHttpError('NETWORK', 'Provider network failure', undefined, true);
          }
        }
        await this.backoff(attempt);
      }
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const jitter = Math.floor(Math.random() * 250);
    await sleep(this.baseDelayMs * 2 ** (attempt - 1) + jitter);
  }

  private async pace(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private async readCapped(response: Response): Promise<string> {
    if (!response.body) {
      const text = await response.text();
      if (text.length > this.maxResponseBytes) {
        throw new ProviderHttpError('TOO_LARGE', 'Provider response exceeds size limit', 200, false);
      }
      return text;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > this.maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderHttpError('TOO_LARGE', 'Provider response exceeds size limit', 200, false);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

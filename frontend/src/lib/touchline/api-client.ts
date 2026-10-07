import { createDefaultClient, ApiClientError, type ApiRequestOptions as SharedRequestOptions } from '@/lib/api-client';
import type { ApiEnvelope } from '@/types/api';

/**
 * The single HTTP access point for `/api/v1`.
 *
 * Server-side only. Every route in this app is a React Server Component and no
 * browser code reaches the API, so the base URL is read from `API_URL` and falls
 * back to `NEXT_PUBLIC_API_URL` for parity with the shared configuration.
 *
 * Transport, retry budget, timeout handling and envelope validation all live in
 * the shared client (`@/lib/api-client`). This module only exposes the small
 * GET-only surface the UI data layer expects, so the app keeps exactly one HTTP
 * implementation.
 *
 * Envelopes are returned intact: unwrapping `data` / `pagination` is the job of
 * `data-fetch.ts` so that every caller handles a missing `data` key the same way.
 */
/** GET-only view of the shared options: this client never writes. */
export type ApiRequestOptions = Omit<SharedRequestOptions, 'method' | 'body' | 'authToken'>;

/**
 * One client per process. `createDefaultClient` resolves the base URL from the
 * environment on each call, so a module-level instance stays correct across
 * server-rendered requests.
 */
const client = createDefaultClient();

/** Performs a GET against `/api/v1` and returns the untouched envelope. */
export function apiGet<T>(path: string, options?: ApiRequestOptions): Promise<ApiEnvelope<T>> {
  return client.get<T>(path, options);
}

export { ApiClientError };
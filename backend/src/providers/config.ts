/**
 * Provider credentials live ONLY in server-side environment variables.
 * Never persist them to the database, system_settings, logs, or responses.
 */

export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  keyHeader: string;
  timeoutMs: number;
  maxRetries: number;
  requestsPerMinute: number;
  maxResponseBytes: number;
  enabled: boolean;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Pure reader: builds a provider config from an explicit environment map.
 * `providerConfigFromEnv` delegates here with `process.env`; verification
 * tooling passes an arbitrary map. Single source of truth for the defaults.
 */
export function providerConfigFromRecord(
  env: Record<string, string | undefined>,
  prefix: string,
): ProviderConfig {
  const get = (suffix: string): string | undefined => env[`${prefix}_${suffix}`];
  return {
    baseUrl: get('BASE_URL') ?? '',
    apiKey: get('API_KEY'),
    keyHeader: get('KEY_HEADER') ?? 'X-Api-Key',
    timeoutMs: num(get('TIMEOUT_MS'), 10_000),
    maxRetries: Math.min(5, Math.max(0, Math.floor(num(get('MAX_RETRIES'), 3)))),
    requestsPerMinute: num(get('REQUESTS_PER_MINUTE'), 60),
    maxResponseBytes: num(get('MAX_RESPONSE_BYTES'), 5_000_000),
    enabled: (get('ENABLED') ?? 'false').toLowerCase() === 'true',
  };
}

/** Read `<PREFIX>_BASE_URL`, `<PREFIX>_API_KEY`, … from the process environment. */
export function providerConfigFromEnv(prefix: string): ProviderConfig {
  return providerConfigFromRecord(process.env, prefix);
}

/** Structural validation. Returns human-readable problems (no secrets). */
export function validateProviderConfig(cfg: ProviderConfig): string[] {
  const problems: string[] = [];
  if (!cfg.baseUrl) problems.push('baseUrl is required');
  else {
    try {
      const url = new URL(cfg.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) problems.push('baseUrl must be http(s)');
    } catch {
      problems.push('baseUrl is not a valid URL');
    }
  }
  if (cfg.timeoutMs < 1000) problems.push('timeoutMs is unreasonably low');
  return problems;
}

/** Safe view for logs/diagnostics — the key is never included. */
export function redactedConfig(cfg: ProviderConfig): Record<string, unknown> {
  return {
    baseUrl: cfg.baseUrl,
    hasApiKey: Boolean(cfg.apiKey),
    keyHeader: cfg.keyHeader,
    timeoutMs: cfg.timeoutMs,
    maxRetries: cfg.maxRetries,
    requestsPerMinute: cfg.requestsPerMinute,
    enabled: cfg.enabled,
  };
}

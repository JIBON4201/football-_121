const SENSITIVE_PATTERNS = [/authorization/i, /cookie/i, /api[-_]?key/i, /token/i, /secret/i];

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(key))) return '[redacted]';
  return value;
}

/** Strip credentials from headers before logging. Never log secrets. */
export function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

export function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}

export function logError(fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', ...fields }));
}

/**
 * Step 40 — live HTTP verification against a running deployment.
 *
 * The pure validators (envelope, pagination, error shape, cache headers,
 * security headers, XML well-formedness) are exported separately so they can be
 * unit-tested without a server. The HTTP runners only orchestrate fetch calls.
 *
 * Nothing here mutates state; every request is a safe GET/OPTIONS/HEAD.
 */
import {
  fail,
  makeFinding,
  pass,
  skip,
  warn,
  type CheckResult,
  type Finding,
  type Severity,
} from './types';

// ── Pure validators ─────────────────────────────────────────────────────────

export interface EnvelopeResult {
  ok: boolean;
  problems: string[];
}

/**
 * Every successful API response uses the stable `{ data, requestId }` envelope
 * (plus `pagination`/`meta` where applicable).
 */
export function validateEnvelope(body: unknown, context: string): EnvelopeResult {
  const problems: string[] = [];
  if (typeof body !== 'object' || body === null) {
    return { ok: false, problems: [`${context}: response body is not an object`] };
  }
  const record = body as Record<string, unknown>;
  if (!('data' in record)) problems.push(`${context}: missing "data" envelope key`);
  if (typeof record.requestId !== 'string' || record.requestId.length === 0) {
    problems.push(`${context}: missing or empty "requestId"`);
  }
  // Raw upstream provider payloads must never be echoed to clients.
  const serialized = JSON.stringify(body);
  if (/"(apiKey|api_key|service_role|external_id|rawResponse|raw_response)"/i.test(serialized)) {
    problems.push(`${context}: response appears to contain provider-internal fields`);
  }
  return { ok: problems.length === 0, problems };
}

export function validatePagination(
  body: unknown,
  expected: { page?: number; limit?: number },
  context: string,
): EnvelopeResult {
  const problems: string[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const pagination = record.pagination as Record<string, unknown> | undefined;
  if (!pagination) {
    return { ok: false, problems: [`${context}: list response missing "pagination"`] };
  }
  for (const key of ['page', 'limit', 'total', 'totalPages'] as const) {
    if (typeof pagination[key] !== 'number' || !Number.isFinite(pagination[key] as number)) {
      problems.push(`${context}: pagination.${key} is not a finite number`);
    }
  }
  const limit = pagination.limit as number;
  const total = pagination.total as number;
  if (typeof limit === 'number' && typeof total === 'number' && total < 0) {
    problems.push(`${context}: pagination.total is negative`);
  }
  if (typeof pagination.totalPages === 'number' && total === 0 && pagination.totalPages !== 0) {
    problems.push(`${context}: pagination.totalPages should be 0 when total is 0`);
  }
  if (expected.page !== undefined && pagination.page !== expected.page) {
    problems.push(`${context}: requested page ${expected.page} but got ${String(pagination.page)}`);
  }
  if (expected.limit !== undefined && pagination.limit !== expected.limit) {
    problems.push(`${context}: requested limit ${expected.limit} but got ${String(pagination.limit)}`);
  }
  return { ok: problems.length === 0, problems };
}

/** Error responses must be JSON with a stable code, never a stack trace. */
export function validateErrorEnvelope(body: unknown, context: string): EnvelopeResult {
  const problems: string[] = [];
  if (typeof body !== 'object' || body === null) {
    return { ok: false, problems: [`${context}: error body is not an object`] };
  }
  const record = body as Record<string, unknown>;
  const error = record.error as Record<string, unknown> | undefined;
  if (!error || typeof error !== 'object') {
    problems.push(`${context}: error body missing "error" object`);
  } else {
    if (typeof error.code !== 'string' || error.code.length === 0) {
      problems.push(`${context}: error.code missing`);
    }
    if (typeof error.message !== 'string' || error.message.length === 0) {
      problems.push(`${context}: error.message missing`);
    }
  }
  const serialized = JSON.stringify(body);
  if (/"\s*stack"\s*:|at\s+\w+\s+\(.*:\d+:\d+\)/.test(serialized)) {
    problems.push(`${context}: error body leaks a stack trace`);
  }
  return { ok: problems.length === 0, problems };
}

export interface CacheResult {
  ok: boolean;
  problems: string[];
  cacheControl?: string;
}

/**
 * Public GETs must be explicitly cacheable. Live endpoints must NOT be served
 * from a cache that could outlast the score.
 */
export function validateCacheHeaders(
  headers: Record<string, string>,
  context: string,
  options: { mustBeCacheable?: boolean; mustNotBeStale?: boolean } = {},
): CacheResult {
  const problems: string[] = [];
  const cacheControl = headers['cache-control'];
  if (options.mustBeCacheable) {
    if (!cacheControl) {
      problems.push(`${context}: missing Cache-Control header`);
    } else if (/no-store/i.test(cacheControl)) {
      problems.push(`${context}: public response is marked no-store (caching disabled)`);
    } else if (!/public/i.test(cacheControl) && !/max-age/i.test(cacheControl)) {
      problems.push(`${context}: Cache-Control lacks public/max-age: "${cacheControl}"`);
    }
  }
  if (options.mustNotBeStale) {
    const maxAge = /max-age=(\d+)/i.exec(cacheControl ?? '')?.[1];
    if (maxAge !== undefined && Number(maxAge) > 30) {
      problems.push(`${context}: live data may be cached for ${maxAge}s (max 30s)`);
    }
  }
  return { ok: problems.length === 0, problems, cacheControl };
}

const REQUIRED_SECURITY_HEADERS = [
  'x-content-type-options',
  'referrer-policy',
];

/** Header presence checks; `X-Powered-By` must be absent. */
export function validateSecurityHeaders(
  headers: Record<string, string>,
  context: string,
): EnvelopeResult {
  const problems: string[] = [];
  const lowered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lowered[key.toLowerCase()] = value;

  for (const header of REQUIRED_SECURITY_HEADERS) {
    if (!lowered[header]) problems.push(`${context}: missing ${header}`);
  }
  if ('x-powered-by' in lowered) problems.push(`${context}: x-powered-by must be disabled`);
  if (!lowered['x-frame-options'] && !/frame-ancestors/i.test(lowered['content-security-policy'] ?? '')) {
    problems.push(`${context}: neither X-Frame-Options nor CSP frame-ancestors is set`);
  }
  return { ok: problems.length === 0, problems };
}

/** CORS must echo only allow-listed origins, and never with credentials. */
export function validateCors(
  headers: Record<string, string>,
  requestedOrigin: string,
  context: string,
  options: { allowed: boolean },
): EnvelopeResult {
  const problems: string[] = [];
  const lowered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lowered[key.toLowerCase()] = value;
  const allowOrigin = lowered['access-control-allow-origin'];

  if (options.allowed) {
    if (allowOrigin !== requestedOrigin) {
      problems.push(
        `${context}: allow-listed origin was not echoed (got "${allowOrigin ?? 'none'}", want "${requestedOrigin}")`,
      );
    }
  } else if (allowOrigin === '*') {
    problems.push(`${context}: wildcard CORS origin exposed to a disallowed origin`);
  }
  if (/true/i.test(lowered['access-control-allow-credentials'] ?? '')) {
    problems.push(`${context}: Access-Control-Allow-Credentials must not be enabled on a public API`);
  }
  return { ok: problems.length === 0, problems };
}

/** Sitemap/robots payloads must be well-formed XML/text, not JSON errors. */
export function validateXml(body: string, context: string): EnvelopeResult {
  const problems: string[] = [];
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    problems.push(`${context}: empty body`);
  } else if (!trimmed.startsWith('<?xml')) {
    problems.push(`${context}: missing XML declaration`);
  }
  if (!/<urlset[\s>]|<sitemap[\s>]/i.test(trimmed)) {
    problems.push(`${context}: missing <urlset> or <sitemapindex> root element`);
  }
  const openUrls = (trimmed.match(/<loc>/g) ?? []).length;
  const closeUrls = (trimmed.match(/<\/loc>/g) ?? []).length;
  if (openUrls !== closeUrls) problems.push(`${context}: unbalanced <loc> elements`);
  return { ok: problems.length === 0, problems };
}

export function validateRobotsTxt(body: string, context: string): EnvelopeResult {
  const problems: string[] = [];
  const lowered = body.toLowerCase();
  if (!lowered.includes('user-agent')) problems.push(`${context}: no User-agent directive`);
  const disallowAll = /user-agent:\s*\*\s*\n\s*disallow:\s*\/\s*(\n|$)/.test(lowered);
  if (disallowAll) problems.push(`${context}: robots.txt disallows everything for all agents`);
  if (/\bdisallow:\s*\/(css|js|assets|_next|static)\b/.test(lowered)) {
    problems.push(`${context}: robots.txt blocks CSS/JS/asset paths`);
  }
  if (/\bsitemap:/.test(lowered) === false) problems.push(`${context}: no Sitemap directive`);
  return { ok: problems.length === 0, problems };
}

/** robots.txt must not leak private infrastructure. */
export function findPrivateExposure(text: string): string[] {
  const leaks: string[] = [];
  const patterns: [RegExp, string][] = [
    [/supabase\.co/i, 'Supabase project host'],
    [/\/rest\/v1\//i, 'PostgREST path'],
    [/localhost:\d+/i, 'local address'],
    [/\b10\.\d+\.\d+\.\d+\b/, 'private network address'],
    [/\b192\.168\.\d+\.\d+\b/, 'private network address'],
    [/\bsk_live_|service_role|sb_secret_/i, 'credential material'],
  ];
  for (const [regex, label] of patterns) {
    if (regex.test(text)) leaks.push(label);
  }
  return leaks;
}

/** robots.txt Allow rules must not cover required asset directories. */
export function findBlockedAssets(text: string): string[] {
  const blocked: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*disallow:\s*(\S+)\s*$/i.exec(line);
    if (!match) continue;
    const path = match[1];
    if (/^\/(?:_next|static|assets|images|fonts|css|js)(?:\/|$)/i.test(path)) {
      blocked.push(path);
    }
  }
  return blocked;
}

// ── HTTP orchestration ──────────────────────────────────────────────────────

export interface HttpProbe {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

async function probe(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<HttpProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: response.status, headers, body: await response.text(), durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Public list endpoints that must honor `page`/`limit` and return pagination.
 *
 * `/api/v1/articles` is deliberately excluded: it is the editorial API behind
 * `authenticate({ required: true })` + `requireAuth`, so it must reject
 * anonymous callers rather than serve 200.
 */
export const LIST_ENDPOINTS: { name: string; path: string }[] = [
  { name: 'news', path: '/api/v1/news' },
  { name: 'news/breaking', path: '/api/v1/news/breaking' },
  { name: 'news/latest', path: '/api/v1/news/latest' },
  { name: 'matches', path: '/api/v1/matches' },
  { name: 'matches/live', path: '/api/v1/matches/live' },
  { name: 'matches/upcoming', path: '/api/v1/matches/upcoming' },
  { name: 'matches/today', path: '/api/v1/matches/today' },
  { name: 'matches/finished', path: '/api/v1/matches/finished' },
  { name: 'teams', path: '/api/v1/teams' },
  { name: 'players', path: '/api/v1/players' },
  { name: 'competitions', path: '/api/v1/competitions' },
  { name: 'transfers', path: '/api/v1/transfers' },
  { name: 'categories', path: '/api/v1/categories' },
  { name: 'tags', path: '/api/v1/tags' },
  { name: 'search', path: '/api/v1/search?q=a' },
];

export const OBJECT_ENDPOINTS: { name: string; path: string }[] = [
  { name: 'health', path: '/api/v1/health' },
  { name: 'health/database', path: '/api/v1/health/database' },
  { name: 'docs', path: '/api/v1/docs.json' },
  { name: 'seo/validate', path: '/api/v1/seo/validate' },
];

/**
 * Former admin endpoints (removed). Kept as an empty list so historic imports
 * do not break; no administrative HTTP surface remains.
 */
export const ADMIN_ENDPOINTS: { name: string; path: string }[] = [];

function classify(problems: string[], severity: Severity, id: string, title: string, remedy: string): Finding[] {
  return problems.map(
    (problem, index) =>
      makeFinding(`${id}_${index + 1}`, severity, title, { detail: problem, remedy }),
  );
}

export async function checkApiContract(apiBaseUrl: string): Promise<CheckResult[]> {
  const startedAt = Date.now();
  const findings: Finding[] = [];
  const observed: Record<string, unknown>[] = [];

  for (const endpoint of [...LIST_ENDPOINTS, ...OBJECT_ENDPOINTS]) {
    let result: HttpProbe;
    try {
      result = await probe(`${apiBaseUrl}${endpoint.path}`);
    } catch (error) {
      findings.push(
        makeFinding('API_UNREACHABLE', 'BLOCKER', `${endpoint.name}: request failed`, {
          detail: error instanceof Error ? error.message : 'unknown error',
          remedy: 'Verify the API is deployed and reachable at the configured base URL.',
        }),
      );
      continue;
    }

    if (result.status !== 200) {
      findings.push(
        makeFinding('API_BAD_STATUS', 'BLOCKER', `${endpoint.name}: expected 200, got ${result.status}`, {
          detail: result.body.slice(0, 200),
          remedy: 'Fix the endpoint or its upstream dependency before deploying.',
        }),
      );
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      findings.push(
        makeFinding('API_INVALID_JSON', 'HIGH', `${endpoint.name}: response body is not valid JSON`, {
          remedy: 'Return the stable JSON envelope from every endpoint.',
        }),
      );
      continue;
    }

    const envelope = validateEnvelope(parsed, endpoint.name);
    if (!envelope.ok) {
      findings.push(...classify(envelope.problems, 'HIGH', 'API_ENVELOPE', `${endpoint.name}: envelope invalid`, 'Return { data, requestId } on every success response.'));
    }
    if (LIST_ENDPOINTS.some((item) => item.name === endpoint.name)) {
      const pagination = validatePagination(parsed, {}, endpoint.name);
      if (!pagination.ok) {
        findings.push(...classify(pagination.problems, 'HIGH', 'API_PAGINATION', `${endpoint.name}: pagination invalid`, 'Return a complete { page, limit, total, totalPages } object on list endpoints.'));
      }
    }
    observed.push({ name: endpoint.name, status: result.status, durationMs: result.durationMs });
  }

  // Validation contract: bad input must produce a stable 400 envelope.
  const invalidCases: { name: string; path: string }[] = [
    { name: 'invalid status filter', path: '/api/v1/matches?status=playing' },
    { name: 'invalid date filter', path: '/api/v1/matches?from=not-a-date' },
    { name: 'unknown transfer status', path: '/api/v1/transfers?status=nonsense' },
    { name: 'non-uuid transfer id', path: '/api/v1/transfers/not-a-uuid' },
    { name: 'unknown route', path: '/api/v1/definitely-not-a-route' },
  ];
  for (const invalid of invalidCases) {
    try {
      const result = await probe(`${apiBaseUrl}${invalid.path}`);
      const expected = invalid.name === 'unknown route' ? 404 : 400;
      if (result.status !== expected) {
        findings.push(
          makeFinding('API_VALIDATION_STATUS', 'HIGH', `${invalid.name}: expected ${expected}, got ${result.status}`, {
            remedy: 'Invalid input must be rejected with the documented status code.',
          }),
        );
        continue;
      }
      const errorEnvelope = validateErrorEnvelope(JSON.parse(result.body), invalid.name);
      if (!errorEnvelope.ok) {
        findings.push(...classify(errorEnvelope.problems, 'MEDIUM', 'API_ERROR_SHAPE', `${invalid.name}: error shape invalid`, 'Return { error: { code, message }, requestId }.'));
      }
    } catch (error) {
      findings.push(
        makeFinding('API_VALIDATION_UNREACHABLE', 'HIGH', `${invalid.name}: request failed`, {
          detail: error instanceof Error ? error.message : 'unknown error',
        }),
      );
    }
  }

  const durationMs = Date.now() - startedAt;
  const data = { endpointsChecked: LIST_ENDPOINTS.length + OBJECT_ENDPOINTS.length, observed };
  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return [fail('api.contract', 'api', 'Public API contract (status codes, schema, pagination, validation, errors)', findings, { data, durationMs })];
  }
  if (findings.length > 0) {
    return [warn('api.contract', 'api', 'Public API contract (status codes, schema, pagination, validation, errors)', findings, { data, durationMs })];
  }
  return [pass('api.contract', 'api', 'Public API contract (status codes, schema, pagination, validation, errors)', {
    detail: `${data.endpointsChecked} endpoints verified with stable envelopes, pagination and error shapes.`,
    data,
    durationMs,
  })];
}

export async function checkApiCaching(apiBaseUrl: string): Promise<CheckResult> {
  const startedAt = Date.now();
  const findings: Finding[] = [];
  const cacheable = ['/api/v1/news', '/api/v1/matches', '/api/v1/teams', '/api/v1/competitions'];
  const volatile_ = ['/api/v1/matches/live'];

  for (const path of cacheable) {
    try {
      const result = await probe(`${apiBaseUrl}${path}`);
      const check = validateCacheHeaders(result.headers, path, { mustBeCacheable: true });
      if (!check.ok) {
        findings.push(...classify(check.problems, 'HIGH', 'API_CACHE_MISSING', `${path}: cache headers invalid`, 'Serve public GET responses with an explicit Cache-Control/max-age.'));
      }
    } catch (error) {
      findings.push(makeFinding('API_CACHE_UNREACHABLE', 'HIGH', `${path}: request failed`, { detail: error instanceof Error ? error.message : 'unknown error' }));
    }
  }

  for (const path of volatile_) {
    try {
      const result = await probe(`${apiBaseUrl}${path}`);
      const check = validateCacheHeaders(result.headers, path, { mustBeCacheable: false, mustNotBeStale: true });
      if (!check.ok) {
        findings.push(...classify(check.problems, 'BLOCKER', 'API_LIVE_CACHE_STALE', `${path}: live data may be served stale`, 'Reduce the live-data TTL so scores cannot outrun the source.'));
      }
    } catch (error) {
      findings.push(makeFinding('API_CACHE_UNREACHABLE', 'HIGH', `${path}: request failed`, { detail: error instanceof Error ? error.message : 'unknown error' }));
    }
  }

  const durationMs = Date.now() - startedAt;
  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('api.cache', 'api', 'Response caching and live-cache invalidation', findings, { durationMs });
  }
  if (findings.length > 0) {
    return warn('api.cache', 'api', 'Response caching and live-cache invalidation', findings, { durationMs });
  }
  return pass('api.cache', 'api', 'Response caching and live-cache invalidation', {
    detail: 'Public reads are cacheable and live reads have a short TTL.',
    durationMs,
  });
}

export async function checkSecurityPosture(
  apiBaseUrl: string,
  allowedOrigin: string,
): Promise<CheckResult> {
  const startedAt = Date.now();
  const findings: Finding[] = [];

  try {
    const base = await probe(`${apiBaseUrl}/api/v1/news`);
    const headerCheck = validateSecurityHeaders(base.headers, 'GET /api/v1/news');
    if (!headerCheck.ok) {
      findings.push(...classify(headerCheck.problems, 'HIGH', 'SEC_MISSING_HEADER', 'Security headers incomplete', 'Ensure helmet is applied with X-Content-Type-Options, Referrer-Policy and frame protection.'));
    }

    const allowed = await probe(`${apiBaseUrl}/api/v1/news`, { headers: { Origin: allowedOrigin } });
    const allowedCheck = validateCors(allowed.headers, allowedOrigin, 'allowed origin', { allowed: true });
    if (!allowedCheck.ok) {
      findings.push(...classify(allowedCheck.problems, 'MEDIUM', 'SEC_CORS_ALLOWED', 'CORS rejected an allow-listed origin', 'Add the production origin to CORS_ORIGINS.'));
    }

    const evil = await probe(`${apiBaseUrl}/api/v1/news`, {
      headers: { Origin: 'https://attacker.example' },
    });
    const evilCheck = validateCors(evil.headers, 'https://attacker.example', 'disallowed origin', {
      allowed: false,
    });
    if (!evilCheck.ok) {
      findings.push(...classify(evilCheck.problems, 'BLOCKER', 'SEC_CORS_WILDCARD', 'CORS is permissive for a disallowed origin', 'Keep the strict origin allowlist; never use "*".'));
    }
  } catch (error) {
    findings.push(
      makeFinding('SEC_UNREACHABLE', 'BLOCKER', 'Could not probe API security headers', {
        detail: error instanceof Error ? error.message : 'unknown error',
      }),
    );
  }

  const durationMs = Date.now() - startedAt;
  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('security.posture', 'security', 'CORS, headers, rate limiting and authorization boundaries', findings, { durationMs });
  }
  if (findings.length > 0) {
    return warn('security.posture', 'security', 'CORS, headers, rate limiting and authorization boundaries', findings, { durationMs });
  }
  return pass('security.posture', 'security', 'CORS, headers, rate limiting and authorization boundaries', {
    detail: 'Security headers present and CORS allow-list enforced.',
    durationMs,
  });
}

export async function checkSeoArtifacts(apiBaseUrl: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const xmlTargets = [
    { id: 'seo.sitemap', title: 'Sitemap index', path: '/api/v1/sitemap.xml' },
    { id: 'seo.sitemap.news', title: 'News sitemap', path: '/api/v1/news-sitemap.xml' },
    { id: 'seo.sitemap.matches', title: 'Match sitemap', path: '/api/v1/sitemaps/matches.xml' },
    { id: 'seo.sitemap.teams', title: 'Team sitemap', path: '/api/v1/sitemaps/teams.xml' },
    { id: 'seo.sitemap.players', title: 'Player sitemap', path: '/api/v1/sitemaps/players.xml' },
    { id: 'seo.sitemap.competitions', title: 'Competition sitemap', path: '/api/v1/sitemaps/competitions.xml' },
    { id: 'seo.sitemap.articles', title: 'Article sitemap', path: '/api/v1/sitemaps/articles.xml' },
  ];

  const startedAt = Date.now();
  const findings: Finding[] = [];
  const observed: Record<string, unknown>[] = [];

  for (const target of xmlTargets) {
    try {
      const result = await probe(`${apiBaseUrl}${target.path}`);
      if (result.status !== 200) {
        findings.push(
          makeFinding('SEO_SITEMAP_STATUS', 'HIGH', `${target.title}: expected 200, got ${result.status}`, {
            remedy: 'The sitemap must be publicly reachable without authentication.',
          }),
        );
        continue;
      }
      const check = validateXml(result.body, target.title);
      if (!check.ok) {
        findings.push(...classify(check.problems, 'HIGH', 'SEO_SITEMAP_XML', `${target.title}: invalid sitemap XML`, 'Emit well-formed sitemaps with balanced <loc> elements.'));
      }
      const urls = (result.body.match(/<loc>/g) ?? []).length;
      observed.push({ name: target.title, urlCount: urls });
      if (urls === 0) {
        findings.push(
          makeFinding('SEO_SITEMAP_EMPTY', 'MEDIUM', `${target.title}: sitemap contains no URLs`, {
            detail: 'An empty sitemap is valid but indicates no data has been imported.',
          }),
        );
      }
    } catch (error) {
      findings.push(
        makeFinding('SEO_SITEMAP_UNREACHABLE', 'HIGH', `${target.title}: request failed`, {
          detail: error instanceof Error ? error.message : 'unknown error',
        }),
      );
    }
  }

  const durationMs = Date.now() - startedAt;
  results.push(
    findings.some((f) => f.severity === 'BLOCKER')
      ? fail('seo.sitemap', 'seo', 'Sitemap index and child sitemaps', findings, { data: { observed }, durationMs })
      : findings.length > 0
        ? warn('seo.sitemap', 'seo', 'Sitemap index and child sitemaps', findings, { data: { observed }, durationMs })
        : pass('seo.sitemap', 'seo', 'Sitemap index and child sitemaps', {
            detail: `${xmlTargets.length} sitemaps verified as well-formed XML.`,
            data: { observed },
            durationMs,
          }),
  );

  // robots.txt
  const robotsStartedAt = Date.now();
  const robotsFindings: Finding[] = [];
  try {
    const result = await probe(`${apiBaseUrl}/api/v1/robots.txt`);
    if (result.status !== 200) {
      robotsFindings.push(
        makeFinding('SEO_ROBOTS_STATUS', 'HIGH', `robots.txt: expected 200, got ${result.status}`, {
          remedy: 'Serve /robots.txt publicly.',
        }),
      );
    } else {
      const check = validateRobotsTxt(result.body, 'robots.txt');
      if (!check.ok) {
        robotsFindings.push(...classify(check.problems, 'HIGH', 'SEO_ROBOTS_INVALID', 'robots.txt is invalid', 'Include a User-agent, allow public pages, and reference the sitemap.'));
      }
      const blocked = findBlockedAssets(result.body);
      if (blocked.length > 0) {
        robotsFindings.push(
          makeFinding('SEO_ROBOTS_BLOCKS_ASSETS', 'BLOCKER', `robots.txt blocks required asset paths: ${blocked.join(', ')}`, {
            remedy: 'Remove Disallow rules for CSS, JavaScript and asset directories.',
          }),
        );
      }
      const leaks = findPrivateExposure(result.body);
      if (leaks.length > 0) {
        robotsFindings.push(
          makeFinding('SEO_ROBOTS_PRIVATE_EXPOSURE', 'HIGH', `robots.txt exposes private infrastructure: ${leaks.join(', ')}`, {
            remedy: 'Reference only the public sitemap URL.',
          }),
        );
      }
    }
  } catch (error) {
    robotsFindings.push(
      makeFinding('SEO_ROBOTS_UNREACHABLE', 'HIGH', 'robots.txt: request failed', {
        detail: error instanceof Error ? error.message : 'unknown error',
      }),
    );
  }

  const robotsDuration = Date.now() - robotsStartedAt;
  results.push(
    robotsFindings.some((f) => f.severity === 'BLOCKER')
      ? fail('seo.robots', 'seo', 'robots.txt asset and page accessibility', robotsFindings, { durationMs: robotsDuration })
      : robotsFindings.length > 0
        ? warn('seo.robots', 'seo', 'robots.txt asset and page accessibility', robotsFindings, { durationMs: robotsDuration })
        : pass('seo.robots', 'seo', 'robots.txt asset and page accessibility', {
            detail: 'robots.txt is reachable, does not block assets, and exposes no private infrastructure.',
            durationMs: robotsDuration,
          }),
  );

  return results;
}

export interface PerfBudget {
  /** Page/API budgets in milliseconds. */
  apiP95: number;
  page: number;
}

export const DEFAULT_PERF_BUDGET: PerfBudget = { apiP95: 800, page: 2500 };

export async function checkApiPerformance(
  apiBaseUrl: string,
  budget: PerfBudget = DEFAULT_PERF_BUDGET,
): Promise<CheckResult> {
  const startedAt = Date.now();
  const findings: Finding[] = [];
  const timings: { name: string; durationMs: number; status: number }[] = [];

  for (const endpoint of [...LIST_ENDPOINTS.slice(0, 8), { name: 'search', path: '/api/v1/search?q=real madrid' }]) {
    try {
      const result = await probe(`${apiBaseUrl}${endpoint.path}`, { timeoutMs: 15_000 });
      timings.push({ name: endpoint.name, durationMs: result.durationMs, status: result.status });
      if (result.durationMs > budget.apiP95) {
        findings.push(
          makeFinding('PERF_SLOW_ENDPOINT', 'MEDIUM', `${endpoint.name}: ${result.durationMs}ms exceeds the ${budget.apiP95}ms budget`, {
            detail: 'Slow list endpoints hurt every page that depends on them.',
            remedy: 'Check for N+1 query patterns and confirm response caching is active.',
          }),
        );
      }
    } catch (error) {
      findings.push(
        makeFinding('PERF_UNREACHABLE', 'HIGH', `${endpoint.name}: request failed`, {
          detail: error instanceof Error ? error.message : 'unknown error',
        }),
      );
    }
  }

  const durations = timings.map((timing) => timing.durationMs).sort((a, b) => a - b);
  const p95 = durations.length > 0 ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] : 0;
  const data = { timings, p95, budget };
  const durationMs = Date.now() - startedAt;

  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('perf.pages', 'performance', 'Page and endpoint latency', findings, { data, durationMs });
  }
  if (findings.length > 0) {
    return warn('perf.pages', 'performance', 'Page and endpoint latency', findings, { data, durationMs });
  }
  return pass('perf.pages', 'performance', 'Page and endpoint latency', {
    detail: `All sampled endpoints responded within ${budget.apiP95}ms (p95 ${p95}ms).`,
    data,
    durationMs,
  });
}

/** Public routes the smoke test must load successfully. */
export const PUBLIC_ROUTES = [
  '/',
  '/news',
  '/breaking-news',
  '/matches',
  '/live',
  '/competitions',
  '/teams',
  '/players',
  '/transfers',
  '/search',
] as const;

export async function checkFrontendRoutes(
  siteBaseUrl: string,
  budget: PerfBudget = DEFAULT_PERF_BUDGET,
): Promise<CheckResult> {
  const startedAt = Date.now();
  const findings: Finding[] = [];
  const observed: { route: string; status: number; durationMs: number }[] = [];

  for (const route of PUBLIC_ROUTES) {
    try {
      const result = await probe(`${siteBaseUrl}${route}`, { timeoutMs: 20_000 });
      observed.push({ route, status: result.status, durationMs: result.durationMs });
      if (result.status !== 200) {
        findings.push(
          makeFinding('FRONTEND_ROUTE_STATUS', 'BLOCKER', `${route}: expected 200, got ${result.status}`, {
            remedy: 'Every public route must render successfully for logged-out visitors.',
          }),
        );
        continue;
      }
      if (result.body.includes('Application error')) {
        findings.push(
          makeFinding('FRONTEND_ROUTE_ERROR_PAGE', 'HIGH', `${route}: rendered an error boundary`, {
            remedy: 'The page threw during server rendering; check its data layer degradation path.',
          }),
        );
      }
      if (result.durationMs > budget.page) {
        findings.push(
          makeFinding('FRONTEND_SLOW_PAGE', 'MEDIUM', `${route}: ${result.durationMs}ms exceeds the ${budget.page}ms budget`, {
            remedy: 'Check for N+1 API fan-out and oversized payloads.',
          }),
        );
      }
    } catch (error) {
      findings.push(
        makeFinding('FRONTEND_ROUTE_UNREACHABLE', 'BLOCKER', `${route}: request failed`, {
          detail: error instanceof Error ? error.message : 'unknown error',
          remedy: 'Verify the frontend is deployed and reachable.',
        }),
      );
    }
  }

  const durationMs = Date.now() - startedAt;
  const data = { observed };
  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('frontend.routes', 'frontend', 'Public route smoke test (home → news → article → matches → …)', findings, { data, durationMs });
  }
  if (findings.length > 0) {
    return warn('frontend.routes', 'frontend', 'Public route smoke test (home → news → article → matches → …)', findings, { data, durationMs });
  }
  return pass('frontend.routes', 'frontend', 'Public route smoke test (home → news → article → matches → …)', {
    detail: `${PUBLIC_ROUTES.length} public routes returned 200.`,
    data,
    durationMs,
  });
}

/**
 * Live pipeline verification. When no match is currently live, this reports
 * SKIP rather than PASS: absence of a live match is not evidence that the
 * pipeline works, and live data is never fabricated.
 */
export async function checkLivePipeline(apiBaseUrl: string): Promise<CheckResult> {
  const startedAt = Date.now();
  const findings: Finding[] = [];

  let live: HttpProbe;
  try {
    live = await probe(`${apiBaseUrl}/api/v1/matches/live`);
  } catch (error) {
    return fail('live.pipeline', 'live', 'Live match pipeline (status, clock, events, lineups, statistics)', [
      makeFinding('LIVE_UNREACHABLE', 'BLOCKER', 'Could not reach the live matches endpoint', {
        detail: error instanceof Error ? error.message : 'unknown error',
      }),
    ]);
  }

  if (live.status !== 200) {
    return fail('live.pipeline', 'live', 'Live match pipeline (status, clock, events, lineups, statistics)', [
      makeFinding('LIVE_BAD_STATUS', 'BLOCKER', `/matches/live returned ${live.status}`, {
        remedy: 'The live feed must be publicly reachable and never fail during a match.',
      }),
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(live.body);
  } catch {
    return fail('live.pipeline', 'live', 'Live match pipeline (status, clock, events, lineups, statistics)', [
      makeFinding('LIVE_INVALID_JSON', 'HIGH', '/matches/live did not return JSON'),
    ]);
  }

  const envelope = validateEnvelope(parsed, 'matches/live');
  if (!envelope.ok) {
    findings.push(...classify(envelope.problems, 'HIGH', 'LIVE_ENVELOPE', 'matches/live: envelope invalid', 'Return { data, requestId, pagination }.'));
  }

  const rows = ((parsed as { data?: unknown[] }).data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    // Honest outcome: unverifiable right now, not a pass.
    return skip(
      'live.pipeline',
      'live',
      'Live match pipeline (status, clock, events, lineups, statistics)',
      'No match is currently live, so status/clock/events/lineups/statistics could not be verified ' +
        'against real data. Re-run during a live fixture, or exercise the provider sandbox. ' +
        'Live data was deliberately not fabricated.',
      { data: { liveMatches: 0, durationMs: Date.now() - startedAt } },
    );
  }

  const statuses = new Set<string>();
  for (const row of rows) {
    const status = typeof row.status === 'string' ? row.status : '';
    statuses.add(status);
    if (!LIVE_STATUSES.has(status)) {
      findings.push(
        makeFinding('LIVE_UNKNOWN_STATUS', 'HIGH', `Live match has unrecognized status "${status}"`, {
          remedy: 'Status must be one of the documented live states.',
        }),
      );
    }
    if (row.homeScore === undefined || row.awayScore === undefined) {
      findings.push(
        makeFinding('LIVE_MISSING_SCORE', 'HIGH', 'Live match is missing a score field', {
          remedy: 'Live rows must always carry both scores so the UI cannot render a blank score.',
        }),
      );
    }
    if (row.kickoffAt === undefined && row.kickoff_at === undefined) {
      findings.push(
        makeFinding('LIVE_MISSING_KICKOFF', 'MEDIUM', 'Live match is missing kickoff time'),
      );
    }
  }

  const data = {
    liveMatches: rows.length,
    statuses: [...statuses],
    durationMs: Date.now() - startedAt,
  };

  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('live.pipeline', 'live', 'Live match pipeline (status, clock, events, lineups, statistics)', findings, { data });
  }
  if (findings.length > 0) {
    return warn('live.pipeline', 'live', 'Live match pipeline (status, clock, events, lineups, statistics)', findings, { data });
  }
  return pass('live.pipeline', 'live', 'Live match pipeline (status, clock, events, lineups, statistics)', {
    detail: `${rows.length} live match(es) verified (statuses: ${[...statuses].join(', ')}).`,
    data,
  });
}

/** Documented live states, mirroring the `match_status` enum. */
const LIVE_STATUSES = new Set([
  'live',
  'half_time',
  'extra_time',
  'penalty_shootout',
  'pre_match',
  'scheduled',
]);

/**
 * Worker/scheduler health. No administrative HTTP surface remains (admin
 * routes removed); background work runs via CLI processes. Reported as SKIP.
 */
export async function checkWorkerHealth(
  _apiBaseUrl: string,
  _adminToken?: string,
): Promise<CheckResult> {
  return skip(
    'worker.health',
    'worker',
    'Background worker and scheduler health',
    'Administrative HTTP endpoints were removed. Verify background work via CLI worker/scheduler processes.',
    { durationMs: 0 },
  );
}

/**
 * Media pipeline. Verifies that media detail and variant endpoints return a
 * consistent, resolvable variant set for at least one real media record.
 */
export async function checkMediaPipeline(
  apiBaseUrl: string,
  mediaIds: string[],
): Promise<CheckResult> {
  const startedAt = Date.now();
  const title = 'Media variants, formats and delivery';

  if (mediaIds.length === 0) {
    return skip(
      'media.pipeline',
      'media',
      title,
      'No media id was supplied, so variants, formats and delivery could not be verified. ' +
        'Re-run with --media-id <uuid> (repeatable) using a real media record.',
      { durationMs: Date.now() - startedAt },
    );
  }

  const findings: Finding[] = [];
  const observed: Record<string, unknown>[] = [];

  for (const id of mediaIds.slice(0, 10)) {
    try {
      const detail = await probe(`${apiBaseUrl}/api/v1/media/${id}`);
      if (detail.status !== 200) {
        findings.push(
          makeFinding('MEDIA_NOT_FOUND', 'HIGH', `media ${id}: expected 200, got ${detail.status}`, {
            remedy: 'Media URLs referenced by content must resolve.',
          }),
        );
        continue;
      }
      const parsed = JSON.parse(detail.body) as { data?: Record<string, unknown> };
      const record = (parsed.data ?? {}) as Record<string, unknown>;
      const variants = await probe(`${apiBaseUrl}/api/v1/media/${id}/variants`);
      if (variants.status !== 200) {
        findings.push(
          makeFinding('MEDIA_VARIANTS_STATUS', 'MEDIUM', `media ${id}: variants returned ${variants.status}`),
        );
        continue;
      }
      const variantBody = JSON.parse(variants.body) as { data?: unknown[] };
      const list = Array.isArray(variantBody.data) ? variantBody.data : [];
      if (list.length === 0) {
        findings.push(
          makeFinding('MEDIA_NO_VARIANTS', 'MEDIUM', `media ${id}: no responsive variants available`, {
            detail: 'Without variants, pages fall back to the unprocessed original.',
          }),
        );
      }
      for (const variant of list) {
        const entry = variant as Record<string, unknown>;
        const url = entry.url;
        if (typeof url === 'string' && url.trim().length === 0) {
          findings.push(
            makeFinding('MEDIA_EMPTY_URL', 'HIGH', `media ${id}: a variant has an empty URL`),
          );
        }
      }
      observed.push({ id, hasAlt: Boolean(record.alt ?? record.altText), variantCount: list.length });
    } catch (error) {
      findings.push(
        makeFinding('MEDIA_UNREACHABLE', 'HIGH', `media ${id}: request failed`, {
          detail: error instanceof Error ? error.message : 'unknown error',
        }),
      );
    }
  }

  const data = { observed, checked: Math.min(mediaIds.length, 10) };
  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('media.pipeline', 'media', title, findings, { data });
  }
  if (findings.length > 0) {
    return warn('media.pipeline', 'media', title, findings, { data });
  }
  return pass('media.pipeline', 'media', title, { detail: `${data.checked} media record(s) verified.`, data });
}

export { probe as httpProbe };
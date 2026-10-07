/**
 * Step 40 — verification orchestrator.
 *
 * Runs every check that can produce evidence in the current environment and
 * reports SKIP (with a reason) for the ones that cannot. Never fabricates a
 * PASS: a check that could not run is explicitly unverified.
 *
 * Live HTTP checks (running API / frontend) are supplied by the caller so this
 * module stays free of transport concerns and remains unit-testable.
 */
import type { DbClient } from '../lib/supabase';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectFiles } from './sourceScan';
import { checkCanonicalAndFreshness } from './canonicalAudit';
import { checkEnvInventory, checkEnvSeparation, checkSecretExposure } from './envAudit';
import {
  checkAdapterRegistered,
  checkProviderConfig,
  checkProviderSecretHygiene,
} from './providerCheck';
import {
  checkApiCaching,
  checkApiContract,
  checkApiPerformance,
  checkFrontendRoutes,
  checkLivePipeline,
  checkMediaPipeline,
  checkSecurityPosture,
  checkSeoArtifacts,
  checkWorkerHealth,
} from './httpChecks';
import {
  checkClientBundle,
  checkFrontendHeaderConfig,
  checkPaginationSafety,
  checkProductionConfigHygiene,
  checkRateLimitTiers,
} from './hardening';
import { checkDatabaseConnectivity, checkSchemaConsistency } from './schemaCheck';
import { fail, makeFinding, pass, skip, warn, type CheckResult, type GroupId } from './types';
import { config } from '../config';
import { resolveEnvMode } from '../lib/envRules';

/** Optional live-target checks, supplied by the CLI when a base URL is known. */
export interface LiveTargets {
  apiBaseUrl?: string;
  siteBaseUrl?: string;
  /** Real media record ids used to verify the media pipeline. */
  mediaIds?: string[];
}

export interface RunOptions {
  repoRoot: string;
  env?: Record<string, string | undefined>;
  targets?: LiveTargets;
  /** When false, checks requiring a database are skipped entirely. */
  useDatabase?: boolean;
}

/** Runs the full verification suite. */
export async function runVerification(options: RunOptions): Promise<CheckResult[]> {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot;
  const results: CheckResult[] = [];

  // ── Environment ────────────────────────────────────────────────────────────
  results.push(checkEnvInventory(repoRoot));
  results.push(checkEnvSeparation(env));
  results.push(checkCacheWiring(repoRoot));

  // ── Step 41 hardening ──────────────────────────────────────────────────────
  results.push(checkPaginationSafety(repoRoot));
  results.push(checkRateLimitTiers(config.rateLimit.publicMax, config.rateLimit.authedMax));
  results.push(checkClientBundle(repoRoot));
  results.push(checkFrontendHeaderConfig(repoRoot));
  results.push(checkProductionConfigHygiene(repoRoot));

  // ── Security (offline, always runs) ────────────────────────────────────────
  results.push(checkSecretExposure(repoRoot));

  // ── Provider (offline, always runs) ────────────────────────────────────────
  results.push(checkProviderConfig(env));
  results.push(checkAdapterRegistered());
  results.push(checkProviderSecretHygiene(env));

  // ── Database ───────────────────────────────────────────────────────────────
  if (options.useDatabase === false) {
    const reason =
      'Database checks require Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.';
    results.push(skip('db.connectivity', 'database', 'Supabase connectivity', reason));
    results.push(
      skip(
        'db.schema',
        'database',
        'Schema consistency (extensions, enums, tables, indexes, triggers, RLS)',
        reason,
      ),
    );
    results.push(
      skip('db.canonical', 'database', 'Canonical data audit (duplicates, external IDs, relationships)', reason),
    );
    results.push(skip('data.freshness', 'live', 'Data freshness audit', reason));
  } else {
    let client: DbClient | null = null;
    try {
      // Imported lazily so the DB path stays optional.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { serviceClient } = await import('../lib/supabase');
      client = serviceClient();
    } catch {
      client = null;
    }

    if (!client) {
      const reason =
        'Database checks skipped: no usable Supabase service client (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).';
      results.push(skip('db.connectivity', 'database', 'Supabase connectivity', reason));
      results.push(
        skip(
          'db.schema',
          'database',
          'Schema consistency (extensions, enums, tables, indexes, triggers, RLS)',
          reason,
        ),
      );
      results.push(
        skip('db.canonical', 'database', 'Canonical data audit (duplicates, external IDs, relationships)', reason),
      );
      results.push(skip('data.freshness', 'live', 'Data freshness audit', reason));
    } else {
      results.push(await checkDatabaseConnectivity(client));
      results.push(await checkSchemaConsistency(client));
      results.push(...(await checkCanonicalAndFreshness(client)));
    }
  }

  // ── Live HTTP targets ──────────────────────────────────────────────────────
  results.push(...(await runTargetChecks(options.targets)));

  return results;
}

/**
 * Runs the HTTP-dependent areas against configured live targets. Anything not
 * configured is reported as SKIP with a reason, never as PASS.
 */
async function runTargetChecks(targets: LiveTargets | undefined): Promise<CheckResult[]> {
  const api = targets?.apiBaseUrl;
  const site = targets?.siteBaseUrl;
  const results: CheckResult[] = [];

  if (api) {
    try {
      results.push(...(await checkApiContract(api)));
      results.push(await checkApiCaching(api));
      results.push(...(await checkSeoArtifacts(api)));
      results.push(await checkApiPerformance(api));
    } catch (error) {
      results.push(
        fail('api.contract', 'api', 'Public API contract (status codes, schema, pagination, validation, errors)', [
          makeFinding('API_TARGET_UNREACHABLE', 'BLOCKER', `Could not verify API at ${api}`, {
            detail: error instanceof Error ? error.message : 'unknown error',
          }),
        ]),
      );
    }
    results.push(await checkSecurityPosture(api, allowedOriginFor(targets)));
    results.push(await checkLivePipeline(api));
    results.push(await checkWorkerHealth(api));
    results.push(await checkMediaPipeline(api, targets?.mediaIds ?? []));
  } else {
    results.push(
      ...placeholderSkips([
        { id: 'api.contract', group: 'api', title: 'Public API contract (status codes, schema, pagination, validation, errors)' },
        { id: 'api.cache', group: 'api', title: 'Response caching and live-cache invalidation' },
        { id: 'security.posture', group: 'security', title: 'CORS, headers, rate limiting and authorization boundaries' },
        { id: 'seo.sitemap', group: 'seo', title: 'Sitemap index and child sitemaps' },
        { id: 'seo.robots', group: 'seo', title: 'robots.txt asset and page accessibility' },
        { id: 'perf.pages', group: 'performance', title: 'Page and endpoint latency' },
        { id: 'live.pipeline', group: 'live', title: 'Live match pipeline (status, clock, events, lineups, statistics)' },
        { id: 'worker.health', group: 'worker', title: 'Background worker and scheduler health' },
        { id: 'media.pipeline', group: 'media', title: 'Media variants, formats and delivery' },
      ]),
    );
  }

  if (site) {
    results.push(await checkFrontendRoutes(site));
  } else {
    results.push(
      ...placeholderSkips([
        { id: 'frontend.routes', group: 'frontend', title: 'Public route smoke test (home → news → article → matches → …)' },
      ]),
    );
  }

  return results;
}

/** Origin used for the "allowed" CORS probe: the site origin when known. */
function allowedOriginFor(targets: LiveTargets | undefined): string {
  if (targets?.siteBaseUrl) {
    try {
      return new URL(targets.siteBaseUrl).origin;
    } catch {
      /* fall through */
    }
  }
  return config.corsOrigins[0] ?? 'http://localhost:3000';
}

function placeholderSkips(
  entries: { id: string; group: GroupId; title: string }[],
): CheckResult[] {
  return entries.map((entry) =>
    skip(
      entry.id,
      entry.group,
      entry.title,
      'Not run. No live target configured. Re-run with --api <url> and/or --site <url> ' +
        'against a running deployment.',
    ),
  );
}

/**
 * Reports whether a server-side response cache is actually wired into any
 * production entrypoint. `cacheable()` only emits HTTP Cache-Control, so if no
 * entrypoint calls `setCacheStore`, every read hits PostgREST on each request.
 * Surfaced explicitly so the report cannot imply caching that does not exist.
 */
export function checkCacheWiring(repoRoot: string): CheckResult {
  const startedAt = Date.now();
  const files = collectFiles(join(repoRoot, 'backend', 'src'));
  const usages: { file: string; line: number }[] = [];

  for (const file of files) {
    const normalized = file.path.replace(/\\/g, '/').toLowerCase();
    // The store definitions themselves, and the verification module's own
    // detection strings, are not wiring.
    if (normalized.endsWith('lib/cache.ts') || normalized.endsWith('verify/checks.ts')) continue;
    let content: string;
    try {
      content = readFileSync(file.absolute, 'utf8');
    } catch {
      continue;
    }
    const regex = /setCacheStore\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      usages.push({ file: file.path, line });
    }
  }

  const data = { wiringCallSites: usages };
  const durationMs = Date.now() - startedAt;

  if (usages.length === 0) {
    return warn(
      'cache.wiring',
      'api',
      'Server-side response cache wiring',
      [
        makeFinding(
          'CACHE_STORE_NOT_WIRED',
          'MEDIUM',
          'No production entrypoint installs a cache store; server-side response caching is a no-op',
          {
            detail:
              'HTTP Cache-Control headers are still emitted by cacheable(), so CDN/browser caching works. ' +
              'Every API read otherwise re-queries PostgREST, and the service-level cache/invalidation hooks ' +
              'are exercised only in tests.',
            remedy:
              'Call setCacheStore(new MemoryCacheStore()) (or a Redis adapter) from the API/worker ' +
              'entrypoint when the load justifies it.',
          },
        ),
      ],
      { data, durationMs },
    );
  }

  return pass('cache.wiring', 'api', 'Server-side response cache wiring', {
    detail: `Cache store installed at ${usages.length} call site(s).`,
    data,
    durationMs,
  });
}

/** Verdict used by CI gates and by the human-readable summary. */
export function verdict(results: CheckResult[]): {
  ok: boolean;
  blockers: number;
  failures: number;
  warnings: number;
  unverified: number;
} {
  const findings = results.flatMap((result) => result.findings ?? []);
  const blockers = findings.filter((finding) => finding.severity === 'BLOCKER').length;
  const failures = results.filter((result) => result.status === 'FAIL').length;
  const warnings = results.filter((result) => result.status === 'WARN').length;
  const unverified = results.filter((result) => result.status === 'SKIP').length;
  return { ok: blockers === 0 && failures === 0, blockers, failures, warnings, unverified };
}

/** Sanity check that the configured site URL is not a placeholder in production. */
export function checkSiteUrl(): CheckResult {
  const mode = resolveEnvMode(process.env.NODE_ENV);
  const baseUrl = config.site.baseUrl;
  const findings = [];
  if (mode === 'production' && (baseUrl.includes('example.com') || baseUrl.includes('localhost'))) {
    findings.push(
      makeFinding('SITE_URL_PLACEHOLDER', 'BLOCKER', `SITE_BASE_URL is a placeholder in production (${baseUrl})`, {
        detail: 'Canonical URLs, sitemaps and JSON-LD would all point at a non-existent domain.',
        remedy: 'Set SITE_BASE_URL to the real production origin.',
      }),
    );
  }
  if (findings.length > 0) {
    return fail('site.baseUrl', 'seo', 'Canonical site URL', findings, { data: { baseUrl, mode } });
  }
  return pass('site.baseUrl', 'seo', 'Canonical site URL', { data: { baseUrl, mode } });
}
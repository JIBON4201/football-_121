/**
 * Step 40 — tests for the verification tooling itself.
 *
 * The tooling is only trustworthy if it is itself tested: a verifier that
 * cannot detect a real problem is worse than no verifier.
 */
import { describe, expect, it } from 'vitest';
import { assertEnvIsSane, evaluateEnv, resolveEnvMode } from '../src/lib/envRules';
import { diffEnvDocumentation } from '../src/verify/envAudit';
import { buildCanonicalCheck, buildFreshnessCheck, summarizeAudit } from '../src/verify/canonicalAudit';
import { diffSchemaHealth, REQUIRED_TABLES } from '../src/verify/schemaCheck';
import { buildReport, exitCodeFor } from '../src/verify/report';
import {
  findBlockedAssets,
  findPrivateExposure,
  validateCacheHeaders,
  validateCors,
  validateEnvelope,
  validateErrorEnvelope,
  validatePagination,
  validateRobotsTxt,
  validateSecurityHeaders,
  validateXml,
} from '../src/verify/httpChecks';
import { inventoryEnvVars, parseEnvExampleKeys, scanForSecrets } from '../src/verify/sourceScan';
import { checkProviderConfig, checkProviderSecretHygiene } from '../src/verify/providerCheck';
import { makeFinding, pass, skip, type CheckResult } from '../src/verify/types';

const PROD_ENV = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://real-project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-value-abcdef123456',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-value-abcdef1234567890',
  SITE_BASE_URL: 'https://football.example.org',
  CORS_ORIGINS: 'https://football.example.org,https://www.football.example.org',
  PROVIDER_BASE_URL: 'https://api.provider.test/v3',
  PROVIDER_API_KEY: 'real-provider-key-xyz987',
  PROVIDER_ENABLED: 'true',
};

describe('environment separation rules', () => {
  it('resolves NODE_ENV into a known mode', () => {
    expect(resolveEnvMode('production')).toBe('production');
    expect(resolveEnvMode('test')).toBe('test');
    expect(resolveEnvMode(undefined)).toBe('development');
  });

  it('accepts a fully configured production environment', () => {
    expect(evaluateEnv(PROD_ENV)).toEqual([]);
  });

  it('flags missing production credentials as BLOCKER', () => {
    const violations = evaluateEnv({ NODE_ENV: 'production' });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((violation) => violation.severity === 'BLOCKER')).toBe(true);
    expect(violations.map((violation) => violation.variable)).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('rejects placeholder values that shipped in .env.example', () => {
    const violations = evaluateEnv({
      ...PROD_ENV,
      SUPABASE_URL: 'https://xyzcompany.supabase.co',
      SUPABASE_ANON_KEY: 'public-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-keep-secret',
    });
    const variables = violations.map((violation) => violation.variable);
    expect(variables).toContain('SUPABASE_URL');
    expect(variables).toContain('SUPABASE_ANON_KEY');
    expect(variables).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('prevents development/test credentials from reaching production', () => {
    const violations = evaluateEnv({
      ...PROD_ENV,
      CORS_ORIGINS: 'http://localhost:3000',
      SITE_BASE_URL: 'http://localhost:3000',
    });
    const rules = violations.map((violation) => violation.rule);
    expect(rules).toContain('env-separation');
    expect(violations.filter((violation) => violation.rule === 'env-separation')).toHaveLength(2);
  });

  it('detects a service key equal to the public anon key', () => {
    const violations = evaluateEnv({
      ...PROD_ENV,
      SUPABASE_ANON_KEY: 'same-key-value-1234',
      SUPABASE_SERVICE_ROLE_KEY: 'same-key-value-1234',
    });
    expect(violations.map((violation) => violation.rule)).toContain('privilege-escalation');
  });

  it('rejects a non-http provider base URL in production', () => {
    const violations = evaluateEnv({ ...PROD_ENV, PROVIDER_BASE_URL: 'ftp://provider.test' });
    expect(violations.map((violation) => violation.rule)).toContain('url');
  });

  it('never echoes variable values in violations', () => {
    const violations = evaluateEnv({ ...PROD_ENV, SUPABASE_ANON_KEY: 'public-anon-key' });
    for (const violation of violations) {
      expect(JSON.stringify(violation)).not.toContain('public-anon-key');
    }
  });

  it('assertEnvIsSane throws in production but not in development', () => {
    expect(() => assertEnvIsSane({ NODE_ENV: 'production' })).toThrow(/unsafe environment/i);
    expect(() => assertEnvIsSane({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertEnvIsSane({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertEnvIsSane(PROD_ENV)).not.toThrow();
  });
});

describe('environment documentation audit', () => {
  it('reports variables that are read but undocumented', () => {
    const gaps = diffEnvDocumentation(
      [
        { name: 'SUPABASE_URL', file: 'src/config.ts' },
        { name: 'SOME_NEW_FLAG', file: 'src/config.ts' },
      ],
      ['SUPABASE_URL'],
    );
    expect(gaps).toEqual([
      { variable: 'SOME_NEW_FLAG', readIn: ['src/config.ts'], documented: false },
      { variable: 'SUPABASE_URL', readIn: ['src/config.ts'], documented: true },
    ]);
  });
});

describe('secret scanner', () => {
  it('does not flag its own detection patterns', () => {
    // The scanner module contains the pattern fragments; it must not self-report.
    const hits = scanForSecrets([
      { path: 'backend/src/verify/sourceScan.ts', absolute: `${__dirname}/../src/verify/sourceScan.ts`, size: 1 },
    ]);
    expect(hits).toEqual([]);
  });

  it('ignores files listed in the skip set when inventorying variables', () => {
    const target = `${__dirname}/../src/verify/sourceScan.ts`;
    const withoutSkip = inventoryEnvVars([{ path: 'verify/sourceScan.ts', absolute: target, size: 1 }]);
    const withSkip = inventoryEnvVars([{ path: 'verify/sourceScan.ts', absolute: target, size: 1 }], [
      'verify/sourceScan.ts',
    ]);
    expect(withoutSkip.map((use) => use.name)).toContain('X');
    expect(withSkip.map((use) => use.name)).not.toContain('X');
  });

  it('parses commented-out example keys as documented', () => {
    const keys = parseEnvExampleKeys(`${__dirname}/../.env.example`);
    expect(keys).toContain('SUPABASE_URL');
    expect(keys).toContain('PROVIDER_API_KEY');
    expect(keys).toContain('ADMIN_TOKEN');
  });
});

describe('schema consistency diff', () => {
  it('reports missing extensions, enums and tables', () => {
    const diff = diffSchemaHealth({ extensions: ['citext'], enums: [], tables: ['teams'] });
    expect(diff.missingExtensions).toEqual(['pg_trgm', 'pgcrypto']);
    expect(diff.missingEnums).toContain('match_status');
    expect(diff.missingTables.length).toBe(REQUIRED_TABLES.length - 1);
  });

  it('flags public content tables with RLS disabled', () => {
    const diff = diffSchemaHealth({ tables_without_rls: ['teams', 'sync_jobs'] });
    expect(diff.publicTablesWithoutRls).toEqual(['teams']);
  });

  it('reports nothing missing for a complete inventory', () => {
    const diff = diffSchemaHealth({
      extensions: ['citext', 'pg_trgm', 'pgcrypto'],
      enums: ['app_role', 'article_status', 'article_type', 'match_event_type', 'match_status', 'sync_status', 'transfer_status', 'transfer_type', 'user_status'],
      tables: [...REQUIRED_TABLES],
      indexes: ['idx_teams_name'],
      triggers: [],
      tables_without_rls: [],
      policy_count: 40,
    });
    expect(diff.missingExtensions).toEqual([]);
    expect(diff.missingEnums).toEqual([]);
    expect(diff.missingTables).toEqual([]);
    expect(diff.publicTablesWithoutRls).toEqual([]);
    expect(diff.policyCount).toBe(40);
  });
});

describe('canonical data audit', () => {
  it('summarizes duplicate groups', () => {
    const summary = summarizeAudit({
      duplicate_teams: [{ count: 2 }],
      duplicate_matches: [{ count: 3 }, { count: 2 }],
      broken_relationships: { match_home_team: 2 },
    });
    expect(summary.duplicateTeams).toBe(1);
    expect(summary.duplicateMatches).toBe(2);
    expect(summary.brokenRelationships.match_home_team).toBe(2);
  });

  it('raises BLOCKER findings for duplicate canonical entities', () => {
    const result = buildCanonicalCheck({
      duplicate_teams: [{ count: 2, normalized_name: 'barcelona', names: ['FC Barcelona', 'Barcelona FC'] }],
      duplicate_matches: [{ count: 2 }],
    });
    expect(result.status).toBe('FAIL');
    expect(result.findings?.map((finding) => finding.id)).toContain('DB_DUPLICATE_TEAMS');
    expect(result.findings?.map((finding) => finding.id)).toContain('DB_DUPLICATE_MATCHES');
  });

  it('raises BLOCKER for external-id fan-out', () => {
    const result = buildCanonicalCheck({ external_id_fanout: [{ count: 2, external_id: 'team-7' }] });
    expect(result.status).toBe('FAIL');
    expect(result.findings?.[0].id).toBe('DB_EXTERNAL_ID_FANOUT');
  });

  it('raises HIGH for broken relationships', () => {
    const result = buildCanonicalCheck({ broken_relationships: { match_venue: 4 } });
    expect(result.status).toBe('WARN');
    expect(result.findings?.[0].id).toBe('DB_BROKEN_RELATIONSHIP');
  });

  it('passes a clean audit', () => {
    const result = buildCanonicalCheck({ broken_relationships: { match_venue: 0 } });
    expect(result.status).toBe('PASS');
    expect(result.findings).toBeUndefined();
  });
});

describe('data freshness audit', () => {
  it('treats stale live data as a BLOCKER', () => {
    const result = buildFreshnessCheck({ freshness: { live_matches: 3, live_matches_stale: 2 } });
    expect(result.status).toBe('FAIL');
    expect(result.findings?.map((finding) => finding.id)).toContain('DATA_STALE_LIVE');
  });

  it('warns when fixtures are stuck in scheduled state', () => {
    const result = buildFreshnessCheck({ freshness: { scheduled_past_kickoff: 6 } });
    expect(result.status).toBe('WARN');
    expect(result.findings?.map((finding) => finding.id)).toContain('DATA_STALE_SCHEDULED');
  });

  it('flags finished matches missing a score', () => {
    const result = buildFreshnessCheck({ freshness: { finished_without_score: 1 } });
    expect(result.findings?.map((finding) => finding.id)).toContain('DATA_FINISHED_WITHOUT_SCORE');
  });

  it('flags stuck worker claims', () => {
    const result = buildFreshnessCheck({ freshness: { stuck_running_sync_jobs: 2 } });
    expect(result.findings?.map((finding) => finding.id)).toContain('WORKER_STUCK_JOBS');
  });

  it('passes when nothing is stale', () => {
    expect(buildFreshnessCheck({ freshness: {} }).status).toBe('PASS');
  });
});

describe('API contract validators', () => {
  it('accepts the standard envelope and rejects incomplete ones', () => {
    expect(validateEnvelope({ data: {}, requestId: 'r1' }, 'x').ok).toBe(true);
    expect(validateEnvelope({ data: {} }, 'x').ok).toBe(false);
    expect(validateEnvelope('nope', 'x').ok).toBe(false);
  });

  it('detects provider-internal fields leaking into responses', () => {
    const result = validateEnvelope({ data: { apiKey: 'leak' }, requestId: 'r1' }, 'x');
    expect(result.ok).toBe(false);
  });

  it('validates pagination shape and echoes requested values', () => {
    const body = { data: [], pagination: { page: 2, limit: 5, total: 12, totalPages: 3 }, requestId: 'r' };
    expect(validatePagination(body, { page: 2, limit: 5 }, 'x').ok).toBe(true);
    expect(validatePagination(body, { page: 1 }, 'x').ok).toBe(false);
    expect(validatePagination({ data: [] }, {}, 'x').ok).toBe(false);
  });

  it('requires totalPages to be zero when total is zero', () => {
    const body = { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 2 }, requestId: 'r' };
    expect(validatePagination(body, {}, 'x').ok).toBe(false);
  });

  it('validates the error envelope and rejects stack traces', () => {
    expect(validateErrorEnvelope({ error: { code: 'NOT_FOUND', message: 'nope' }, requestId: 'r' }, 'x').ok).toBe(true);
    expect(validateErrorEnvelope({ error: { message: 'nope' }, requestId: 'r' }, 'x').ok).toBe(false);
    expect(validateErrorEnvelope({ error: { code: 'X', message: 'y', stack: 'a b c' } }, 'x').ok).toBe(false);
  });

  it('requires cache headers on public reads', () => {
    expect(validateCacheHeaders({ 'cache-control': 'public, max-age=60' }, 'x', { mustBeCacheable: true }).ok).toBe(true);
    expect(validateCacheHeaders({}, 'x', { mustBeCacheable: true }).ok).toBe(false);
    expect(validateCacheHeaders({ 'cache-control': 'no-store' }, 'x', { mustBeCacheable: true }).ok).toBe(false);
  });

  it('rejects a stale cache TTL on live data', () => {
    expect(validateCacheHeaders({ 'cache-control': 'public, max-age=300' }, 'x', { mustNotBeStale: true }).ok).toBe(false);
    expect(validateCacheHeaders({ 'cache-control': 'public, max-age=15' }, 'x', { mustNotBeStale: true }).ok).toBe(true);
  });

  it('checks required security headers', () => {
    const good = {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'DENY',
    };
    expect(validateSecurityHeaders(good, 'x').ok).toBe(true);
    expect(validateSecurityHeaders({ ...good, 'x-powered-by': 'Express' }, 'x').ok).toBe(false);
    expect(validateSecurityHeaders({}, 'x').ok).toBe(false);
  });

  it('enforces the CORS allow-list', () => {
    expect(
      validateCors({ 'access-control-allow-origin': 'https://a.test' }, 'https://a.test', 'x', { allowed: true }).ok,
    ).toBe(true);
    expect(
      validateCors({ 'access-control-allow-origin': '*' }, 'https://evil.test', 'x', { allowed: false }).ok,
    ).toBe(false);
    expect(
      validateCors({ 'access-control-allow-credentials': 'true' }, 'https://a.test', 'x', { allowed: true }).ok,
    ).toBe(false);
  });
});

describe('SEO artifact validators', () => {
  it('accepts well-formed sitemaps and rejects malformed ones', () => {
    expect(validateXml('<?xml version="1.0"?><urlset><url><loc>https://a/1</loc></url></urlset>', 'x').ok).toBe(true);
    expect(validateXml('', 'x').ok).toBe(false);
    expect(validateXml('<urlset><loc>https://a/1</urlset>', 'x').ok).toBe(false);
    expect(validateXml('{"error":"nope"}', 'x').ok).toBe(false);
  });

  it('requires a valid robots.txt', () => {
    const valid = 'User-agent: *\nAllow: /\nSitemap: https://football.example.org/sitemap.xml\n';
    expect(validateRobotsTxt(valid, 'x').ok).toBe(true);
    expect(validateRobotsTxt('User-agent: *\nDisallow: /\n', 'x').ok).toBe(false);
    expect(validateRobotsTxt('Sitemap: https://x/sitemap.xml\n', 'x').ok).toBe(false);
  });

  it('detects assets blocked by robots.txt', () => {
    expect(findBlockedAssets('User-agent: *\nDisallow: /_next/static\n')).toContain('/_next/static');
    expect(findBlockedAssets('User-agent: *\nDisallow: /admin\n')).toEqual([]);
  });

  it('detects private infrastructure exposure', () => {
    expect(findPrivateExposure('Sitemap: https://xyz.supabase.co/rest/v1/sitemap.xml')).toContain(
      'Supabase project host',
    );
    expect(findPrivateExposure('Sitemap: http://localhost:4000/sitemap.xml')).toContain('local address');
    expect(findPrivateExposure('Sitemap: https://football.example.org/sitemap.xml')).toEqual([]);
  });
});

describe('provider checks', () => {
  it('skips configuration checks while the provider is disabled', () => {
    const result = checkProviderConfig({ NODE_ENV: 'production' });
    expect(result.status).toBe('SKIP');
    expect(result.detail).toMatch(/not "true"/);
  });

  it('fails an enabled provider with an invalid base URL', () => {
    const result = checkProviderConfig({
      PROVIDER_ENABLED: 'true',
      PROVIDER_BASE_URL: 'not-a-url',
      PROVIDER_API_KEY: 'k',
    });
    expect(result.status).toBe('FAIL');
  });

  it('passes a valid enabled provider without leaking the key', () => {
    const result = checkProviderConfig({
      PROVIDER_ENABLED: 'true',
      PROVIDER_BASE_URL: 'https://api.provider.test/v3',
      PROVIDER_API_KEY: 'super-secret-key',
    });
    expect(result.status).toBe('PASS');
    expect(JSON.stringify(result)).not.toContain('super-secret-key');
  });

  it('flags an example provider key', () => {
    const result = checkProviderSecretHygiene({ PROVIDER_API_KEY: 'your-api-key-example' });
    expect(result.findings?.map((finding) => finding.id)).toContain('PROVIDER_KEY_PLACEHOLDER');
  });

  it('never includes the api key in redacted diagnostics', () => {
    const result = checkProviderSecretHygiene({
      PROVIDER_API_KEY: 'super-secret-key',
      PROVIDER_ENABLED: 'true',
      PROVIDER_BASE_URL: 'https://api.provider.test',
    });
    expect(result.status).toBe('PASS');
    expect(JSON.stringify(result)).not.toContain('super-secret-key');
  });
});

describe('report aggregation and gating', () => {
  const blocker: CheckResult = {
    id: 'x.blocker',
    group: 'database',
    title: 'Broken',
    status: 'FAIL',
    findings: [makeFinding('SOMETHING', 'BLOCKER', 'critical')],
  };
  const skipped = skip('y.skip', 'provider', 'Unverified thing', 'no credentials');

  it('marks the report not production-ready when a blocker exists', () => {
    const report = buildReport([blocker, skipped], 'production');
    expect(report.productionReady).toBe(false);
    expect(exitCodeFor(report)).toBe(1);
    expect(report.blockers).toHaveLength(1);
  });

  it('never counts skipped checks as passing', () => {
    const report = buildReport([pass('a.ok', 'api', 'Fine'), skipped], 'production');
    expect(report.totals.pass).toBe(1);
    expect(report.totals.skipped).toBe(1);
    // A clean run with an unverified check is still not "nothing left to do".
    expect(report.remainingBlockers[0]).toMatch(/UNVERIFIED y\.skip/);
  });

  it('exits zero only when nothing failed and no blocker was raised', () => {
    const report = buildReport([pass('a.ok', 'api', 'Fine')], 'production');
    expect(report.productionReady).toBe(true);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('counts findings per severity', () => {
    const report = buildReport(
      [
        blocker,
        {
          id: 'z.warn',
          group: 'seo',
          title: 'Warned',
          status: 'WARN',
          findings: [makeFinding('W', 'MEDIUM', 'medium issue')],
        },
      ],
      'production',
    );
    expect(report.bySeverity.BLOCKER).toBe(1);
    expect(report.bySeverity.MEDIUM).toBe(1);
  });

  it('includes every report section even when unverified', () => {
    const report = buildReport([skipped], 'development');
    expect(report.groups).toHaveLength(11);
  });
});
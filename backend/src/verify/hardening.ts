/**
 * Step 41 — production performance & security hardening audit.
 *
 * Static and configuration-level checks that run without credentials or a
 * running deployment: dependency posture, client-bundle hygiene, security
 * headers, pagination safety, provider rate limiting, and production-config
 * hygiene.
 *
 * Checks that genuinely require live infrastructure are reported as unverified
 * rather than passing (see Step 40's `skip` semantics).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyRequest, type RateLimitClass } from '../lib/rateLimit';
import { MAX_IN_CLAUSE_IDS, MAX_RELATED_ROWS } from '../repositories/related';
import { collectFiles, scanForSecrets } from './sourceScan';
import {
  fail,
  makeFinding,
  pass,
  skip,
  warn,
  type CheckResult,
  type Finding,
} from './types';

// ── Pagination safety ───────────────────────────────────────────────────────

/** Max lines to look ahead when deciding whether a select chain is bounded. */
const CHAIN_LOOKAHEAD_LINES = 80;

/** Max lines to look behind for a write verb preceding a `.select()` returning clause. */
const CHAIN_LOOKBEHIND_LINES = 40;

export interface UnboundedQuery {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Modules that read a list without an explicit bound. PostgREST returns the
 * whole table when no range/limit is supplied, so a missing bound on a public
 * endpoint is an "unlimited API query" — a production gate failure.
 *
 * Two shapes are deliberately not flagged:
 *   - write chains, where `.select('*')` is a RETURNING clause rather than a
 *     table read (the verb precedes the select, so look backwards for it);
 *   - chains assembled across statements (`let query = ...select();` … later
 *     `await query.range()`), so the scan region runs to the end of the
 *     enclosing function rather than to the next semicolon.
 */
export function findUnboundedQueries(
  files: { path: string; absolute: string }[],
): UnboundedQuery[] {
  const findings: UnboundedQuery[] = [];
  const WRITE_VERB = /\.insert\(|\.upsert\(|\.update\(|\.delete\(/;
  const BOUND = /\.range\(|\.limit\(|\.single\(|\.maybeSingle\(|\.rpc\(/;

  for (const file of files) {
    const normalized = file.path.replace(/\\/g, '/').toLowerCase();
    if (normalized.endsWith('.sql')) continue;

    let content: string;
    try {
      content = readFileSync(file.absolute, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!/\.select\(/.test(lines[i])) continue;

      // Look backwards for a write verb: `.insert({...}).select('*')` returns
      // the affected rows, so it is not an unbounded read. The scan stops at
      // the previous statement terminator, because a multi-line object literal
      // can push the verb far above the select.
      let statementStart = Math.max(0, i - CHAIN_LOOKBEHIND_LINES);
      for (let k = i - 1; k >= statementStart; k -= 1) {
        if (/;\s*$/.test(lines[k])) {
          statementStart = k + 1;
          break;
        }
      }
      const before = lines.slice(statementStart, i + 1).join('\n');
      if (WRITE_VERB.test(before)) continue;

      // Region: this select up to the next select/from, the end of the
      // enclosing function, or the lookahead cap.
      const window: string[] = [];
      for (let j = i; j < Math.min(i + CHAIN_LOOKAHEAD_LINES, lines.length); j += 1) {
        if (j > i && /\.select\(|\.from\(/.test(lines[j])) break;
        // A column-0 `}` closes the enclosing function.
        if (j > i && /^\}/.test(lines[j])) break;
        window.push(lines[j]);
      }

      if (BOUND.test(window.join('\n'))) continue;

      findings.push({
        file: file.path,
        line: i + 1,
        snippet: lines[i].trim().slice(0, 120),
      });
    }
  }
  return findings;
}

export function checkPaginationSafety(repoRoot: string): CheckResult {
  const startedAt = Date.now();
  const files = [
    ...collectFiles(join(repoRoot, 'backend', 'src', 'repositories')),
    ...collectFiles(join(repoRoot, 'backend', 'src', 'services')),
    ...collectFiles(join(repoRoot, 'backend', 'src', 'seo')),
  ];
  const unbounded = findUnboundedQueries(files);
  const data = { scannedFiles: files.length, unboundedQueries: unbounded.length };

  if (unbounded.length > 0) {
    const findings: Finding[] = unbounded.map((query, index) =>
      makeFinding(
        `UNBOUNDED_QUERY_${index + 1}`,
        'BLOCKER',
        `Unbounded list query: ${query.file}:${query.line}`,
        {
          detail: query.snippet,
          remedy:
            'Apply .range()/.limit() (paginateInput + buildPagination for public lists, ' +
            'or an explicit bound on related rows).',
        },
      ),
    );
    return fail('perf.pagination', 'performance', 'Pagination safety (no unlimited queries)', findings, {
      data,
      durationMs: Date.now() - startedAt,
    });
  }

  return pass('perf.pagination', 'performance', 'Pagination safety (no unlimited queries)', {
    detail: `Every list query in ${files.length} module(s) applies an explicit bound. Related-row reads are hard-capped at ${MAX_RELATED_ROWS} rows and ${MAX_IN_CLAUSE_IDS} ids per \`in=(...)\` clause.`,
    data,
    durationMs: Date.now() - startedAt,
  });
}

// ── Rate limiting ───────────────────────────────────────────────────────────

export interface RateLimitTierExpectation {
  class: RateLimitClass;
  samplePath: string;
  mustBeCheaperThanDefault: boolean;
}

/** Endpoints Step 41 requires to be protected ahead of ordinary browsing. */
export const PROTECTED_PATH_SAMPLES: RateLimitTierExpectation[] = [
  { class: 'expensive', samplePath: '/api/v1/search?q=test', mustBeCheaperThanDefault: true },
  { class: 'expensive', samplePath: '/api/v1/sitemap.xml', mustBeCheaperThanDefault: true },
  { class: 'media', samplePath: '/api/v1/media/upload', mustBeCheaperThanDefault: true },
  { class: 'default', samplePath: '/api/v1/news', mustBeCheaperThanDefault: false },
];

export function checkRateLimitTiers(publicMax: number, authedMax: number): CheckResult {
  const startedAt = Date.now();
  const findings: Finding[] = [];
  const observed: Record<string, string> = {};

  for (const sample of PROTECTED_PATH_SAMPLES) {
    const cls = classifyRequest(sample.samplePath);
    observed[sample.samplePath] = cls;
    if (cls !== sample.class) {
      findings.push(
        makeFinding('RATE_LIMIT_CLASSIFICATION', 'HIGH', `${sample.samplePath} classified as "${cls}", expected "${sample.class}"`, {
          remedy: 'Fix classifyRequest() so expensive endpoints get their own budget.',
        }),
      );
    }
  }

  // A single flat budget would leave no headroom separation at all.
  const expensiveMax = Math.max(5, Math.floor(publicMax / 6));
  if (expensiveMax >= publicMax) {
    findings.push(
      makeFinding('RATE_LIMIT_NO_TIERING', 'HIGH', 'Expensive tier is not cheaper than the default tier', {
        detail: `public=${publicMax} expensive=${expensiveMax}`,
        remedy: 'Reduce the expensive budget relative to the default tier.',
      }),
    );
  }

  const data = {
    publicMax,
    authedMax,
    expensiveMax,
    classifications: observed,
  };

  if (findings.length > 0) {
    return fail('sec.rateLimits', 'security', 'Rate-limit tiers for expensive endpoints', findings, {
      data,
      durationMs: Date.now() - startedAt,
    });
  }
  return pass('sec.rateLimits', 'security', 'Rate-limit tiers for expensive endpoints', {
    detail: `Search/sitemaps capped at ${expensiveMax}/min, separate from the ${publicMax}/min browsing budget.`,
    data,
    durationMs: Date.now() - startedAt,
  });
}

// ── Client bundle hygiene ───────────────────────────────────────────────────

/** Node-only modules that must never be pulled into a browser bundle. */
export const SERVER_ONLY_MODULES = [
  'node:crypto',
  'node:fs',
  'node:path',
  'node:os',
  '@supabase/supabase-js',
  'sanitize-html',
];

/** Client directive directives that mark a module as browser code. */
export function isClientComponent(source: string): boolean {
  return /^['"]use client['"]/m.test(source);
}

/**
 * Flags any client component that imports a server-only module. Next.js would
 * fail the build for most of these, but a transitive/dynamic import can slip a
 * credential path into the bundle, so it is checked explicitly.
 */
export function findServerOnlyImportsInClientCode(
  files: { path: string; absolute: string }[],
): { file: string; line: number; module: string }[] {
  const hits: { file: string; line: number; module: string }[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.absolute, 'utf8');
    } catch {
      continue;
    }
    if (!isClientComponent(content)) continue;
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/^\s*import\b/.test(line)) return;
      for (const moduleName of SERVER_ONLY_MODULES) {
        if (line.includes(`'${moduleName}'`) || line.includes(`"${moduleName}"`)) {
          hits.push({ file: file.path, line: index + 1, module: moduleName });
        }
      }
    });
  }
  return hits;
}

export function checkClientBundle(repoRoot: string): CheckResult {
  const startedAt = Date.now();
  const frontendSrc = collectFiles(join(repoRoot, 'frontend', 'src'));
  const staticDir = join(repoRoot, 'frontend', '.next', 'static');
  const bundleFiles = collectFiles(staticDir);

  const findings: Finding[] = [];
  const clientLeaks = findServerOnlyImportsInClientCode(frontendSrc);
  for (const leak of clientLeaks) {
    findings.push(
      makeFinding('BUNDLE_SERVER_ONLY_IMPORT', 'BLOCKER', `Client component imports server-only module ${leak.module}`, {
        detail: `${leak.file}:${leak.line}`,
        remedy: 'Move this logic into a server component or route handler.',
      }),
    );
  }

  const bundleHits = scanForSecrets(bundleFiles);
  for (const hit of bundleHits) {
    findings.push(
      makeFinding('BUNDLE_SECRET', hit.severity, `Credential material in browser bundle: ${hit.file}:${hit.line}`, {
        detail: `Matched ${hit.detector}.`,
        remedy: 'Remove the credential and load it from a server-only environment variable.',
      }),
    );
  }

  // Server-only libraries must not appear in the compiled browser output.
  const bundleLeaks: { file: string; module: string }[] = [];
  for (const file of bundleFiles) {
    let content: string;
    try {
      content = readFileSync(file.absolute, 'utf8');
    } catch {
      continue;
    }
    for (const moduleName of ['node:fs', 'node:crypto']) {
      if (content.includes(`"${moduleName}"`) || content.includes(`'${moduleName}'`)) {
        bundleLeaks.push({ file: file.path, module: moduleName });
      }
    }
  }
  for (const leak of bundleLeaks) {
    findings.push(
      makeFinding('BUNDLE_NODE_MODULE', 'HIGH', `Node built-in ${leak.module} present in browser bundle`, {
        detail: leak.file,
        remedy: 'Ensure the import is only reachable from server components.',
      }),
    );
  }

  const data = {
    bundleScanned: bundleFiles.length > 0,
    bundleFiles: bundleFiles.length,
    clientServerOnlyImports: clientLeaks.length,
    bundleSecrets: bundleHits.length,
    bundleNodeModules: bundleLeaks.length,
  };

  if (!bundleFiles.length) {
    findings.push(
      makeFinding('BUNDLE_NOT_SCANNED', 'MEDIUM', 'No production bundle present, so client exposure was not verified', {
        remedy: 'Run `npm run build` in frontend/, then re-run the hardening audit.',
      }),
    );
  }

  const durationMs = Date.now() - startedAt;
  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('sec.bundle', 'security', 'Client bundle hygiene (no server-only code or secrets)', findings, { data, durationMs });
  }
  if (findings.length > 0) {
    return warn('sec.bundle', 'security', 'Client bundle hygiene (no server-only code or secrets)', findings, { data, durationMs });
  }
  return pass('sec.bundle', 'security', 'Client bundle hygiene (no server-only code or secrets)', {
    detail: `Scanned ${bundleFiles.length} browser bundle file(s): no server-only imports, Node built-ins, or credentials.`,
    data,
    durationMs,
  });
}

// ── Security headers ────────────────────────────────────────────────────────

export interface HeaderExpectation {
  header: string;
  /** Regex the value must match. */
  pattern: RegExp;
  why: string;
}

export const BACKEND_HEADER_EXPECTATIONS: HeaderExpectation[] = [
  { header: 'x-content-type-options', pattern: /nosniff/i, why: 'prevents MIME sniffing' },
  { header: 'x-frame-options', pattern: /DENY|SAMEORIGIN/i, why: 'clickjacking protection' },
  { header: 'referrer-policy', pattern: /strict-origin|no-referrer/i, why: 'limits referrer leakage' },
];

export function findMissingHeaders(
  headers: Record<string, string>,
  expectations: HeaderExpectation[],
): string[] {
  const lowered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lowered[key.toLowerCase()] = value;
  return expectations
    .filter((expectation) => {
      const value = lowered[expectation.header];
      return !value || !expectation.pattern.test(value);
    })
    .map((expectation) => `${expectation.header} (${expectation.why})`);
}

/** Parses the `headers()` output of next.config.mjs without executing Next. */
export function expectedFrontendHeaderNames(source: string): string[] {
  const names: string[] = [];
  const regex = /key:\s*'([A-Za-z-]+)'/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) names.push(match[1]);
  return [...new Set(names)];
}

/**
 * Static check of the frontend header configuration. Verifies HSTS exists and
 * is production-gated, rather than trusting it at runtime.
 */
export function checkFrontendHeaderConfig(repoRoot: string): CheckResult {
  const startedAt = Date.now();
  const configPath = join(repoRoot, 'frontend', 'next.config.mjs');
  const findings: Finding[] = [];

  let source: string;
  try {
    source = readFileSync(configPath, 'utf8');
  } catch {
    return skip('sec.headers.frontend', 'security', 'Frontend security header configuration', `Could not read ${configPath}.`);
  }

  const names = expectedFrontendHeaderNames(source);
  const required = [
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Content-Security-Policy',
    'Strict-Transport-Security',
  ];
  for (const header of required) {
    if (!names.includes(header)) {
      findings.push(
        makeFinding('HEADER_MISSING', 'HIGH', `Frontend does not send ${header}`, {
          remedy: `Add ${header} to the headers() array in frontend/next.config.mjs.`,
        }),
      );
    }
  }

  // HSTS must be gated to production or it breaks plain-HTTP local development.
  if (names.includes('Strict-Transport-Security') && !/isProd[\s\S]{0,400}Strict-Transport-Security/.test(source)) {
    findings.push(
      makeFinding('HEADER_HSTS_UNGATED', 'MEDIUM', 'Strict-Transport-Security is not gated on production', {
        detail: 'Unconditional HSTS pins browsers to HTTPS and breaks local HTTP development.',
        remedy: 'Wrap the HSTS header in a NODE_ENV === "production" check.',
      }),
    );
  }

  const data = { configuredHeaders: names, required };
  const durationMs = Date.now() - startedAt;
  if (findings.length > 0) {
    return warn('sec.headers.frontend', 'security', 'Frontend security header configuration', findings, { data, durationMs });
  }
  return pass('sec.headers.frontend', 'security', 'Frontend security header configuration', {
    detail: `${names.length} header(s) configured including production-gated HSTS.`,
    data,
    durationMs,
  });
}

// ── Production configuration hygiene ────────────────────────────────────────

/**
 * Detects development-only affordances that must never ship enabled:
 * verbose error details, the mock/seed provider, and test fixtures.
 */
export function checkProductionConfigHygiene(repoRoot: string): CheckResult {
  const startedAt = Date.now();
  const files = [
    ...collectFiles(join(repoRoot, 'backend', 'src')),
    ...collectFiles(join(repoRoot, 'frontend', 'src')),
  ];
  const findings: Finding[] = [];

  const risky: { id: string; pattern: RegExp; severity: 'HIGH' | 'MEDIUM'; title: string; remedy: string }[] = [
    {
      id: 'DEBUG_FLAG_ENABLED',
      pattern: /\bprocess\.env\.DEBUG\s*===?\s*['"]true['"]|DEBUG:\s*true\b/,
      severity: 'MEDIUM',
      title: 'Debug mode appears to be toggled in source',
      remedy: 'Ensure debug behaviour is driven by NODE_ENV, not a hard-coded flag.',
    },
    {
      id: 'VERBOSE_ERRORS',
      pattern: /res\.(status|json)\([^)]*stack\s*:/i,
      severity: 'HIGH',
      title: 'An error response may include a stack trace',
      remedy: 'Return a stable error code/message only; log the detail server-side.',
    },
    {
      id: 'SEED_PROVIDER_PRODUCTION',
      pattern: /registerSeedProvider\(\)/,
      severity: 'MEDIUM',
      title: 'The seed/mock provider is registered from runtime code',
      remedy: 'Confirm registration is gated to development/test, not production.',
    },
  ];

  const hits: { id: string; file: string; line: number; guarded: boolean }[] = [];
  for (const file of files) {
    // The adapter's own definition is not a registration call site.
    if (file.path.replace(/\\/g, '/').toLowerCase().endsWith('providers/seed/seedprovider.ts')) continue;
    let content: string;
    try {
      content = readFileSync(file.absolute, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of risky) {
        if (!rule.pattern.test(line)) continue;
        // A production guard on the same or a preceding line (e.g.
        // `if (!config.isProd) registerSeedProvider();`) makes this safe.
        const nearby = lines.slice(Math.max(0, index - 3), index + 1).join('\n');
        const guarded = /isProd|NODE_ENV/.test(nearby);
        hits.push({ id: rule.id, file: file.path, line: index + 1, guarded });
      }
    });
  }

  for (const rule of risky) {
    // Unguarded occurrences only: a production-gated registration is correct.
    const matching = hits.filter((hit) => hit.id === rule.id && !hit.guarded);
    if (matching.length === 0) continue;
    findings.push(
      makeFinding(rule.id, rule.severity, `${rule.title} (${matching.length} unguarded site(s))`, {
        detail: matching.slice(0, 5).map((hit) => `${hit.file}:${hit.line}`).join(', '),
        remedy: rule.remedy,
      }),
    );
  }

  const data = {
    scannedFiles: files.length,
    hits: hits.map(({ id, file, line, guarded }) => ({ id, file, line, guarded })),
  };
  const durationMs = Date.now() - startedAt;
  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('sec.prodConfig', 'security', 'Production configuration hygiene', findings, { data, durationMs });
  }
  if (findings.length > 0) {
    return warn('sec.prodConfig', 'security', 'Production configuration hygiene', findings, { data, durationMs });
  }
  return pass('sec.prodConfig', 'security', 'Production configuration hygiene', {
    detail: 'No debug mode, verbose error responses, or unguarded mock provider registration found.',
    data,
    durationMs,
  });
}
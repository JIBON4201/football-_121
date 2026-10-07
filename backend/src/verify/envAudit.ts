/**
 * Step 40 — environment audit and secret-exposure audit.
 *
 * These checks require no database, no provider and no running server, so they
 * are the ones that always produce evidence. They cover:
 *   * every environment variable the code reads vs. what .env.example documents
 *   * production env-separation rules (no placeholders, no local origins)
 *   * credential material in source files and in the built browser bundle
 *   * frontend code reading server-only variables
 */
import { join } from 'node:path';
import { evaluateEnv, resolveEnvMode, envRules } from '../lib/envRules';
import {
  collectFiles,
  expandProviderFamily,
  findClientSideSecretUse,
  inventoryEnvVars,
  parseEnvExampleKeys,
  scanForSecrets,
} from './sourceScan';
import { fail, makeFinding, pass, skip, warn, type CheckResult, type Finding } from './types';

export interface EnvAuditInput {
  repoRoot: string;
  env: Record<string, string | undefined>;
}

export interface EnvDocumentationGap {
  variable: string;
  readIn: string[];
  documented: boolean;
}

/**
 * Variables the framework/toolchain sets itself. They are read but never
 * operator-configured, so their absence from an example file is not a gap.
 */
export const FRAMEWORK_MANAGED_VARS: readonly string[] = ['NODE_ENV'];

/** Pure: which variables read by the source are absent from the .env.example? */
export function diffEnvDocumentation(
  readVariables: { name: string; file: string }[],
  documented: readonly string[],
): EnvDocumentationGap[] {
  const byName = new Map<string, Set<string>>();
  for (const { name, file } of readVariables) {
    if (FRAMEWORK_MANAGED_VARS.includes(name)) continue;
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name)?.add(file);
  }
  const documentedSet = new Set(documented);
  return [...byName.entries()]
    .map(([name, files]) => ({ variable: name, readIn: [...files].sort(), documented: documentedSet.has(name) }))
    .sort((a, b) => a.variable.localeCompare(b.variable));
}

export function checkEnvInventory(repoRoot: string): CheckResult {
  const startedAt = Date.now();
  const backendSrc = collectFiles(join(repoRoot, 'backend', 'src'));
  const frontendSrc = collectFiles(join(repoRoot, 'frontend', 'src'));
  const frontendConfig = collectFiles(join(repoRoot, 'frontend'), 2_000_000).filter(
    (file) => !file.path.startsWith('src/') && !file.path.startsWith('node_modules'),
  );
  const nextConfig = collectFiles(join(repoRoot, 'frontend'), 2_000_000).filter((file) =>
    file.path.endsWith('next.config.mjs'),
  );

  // This scanner's own module documents and constructs the detection patterns;
  // it performs no real environment reads.
  const SELF = ['verify/sourceScan.ts'];

  const backendUses = inventoryEnvVars(backendSrc, SELF).filter((use) => !use.name.startsWith('<PREFIX>'));
  const providerVars = expandProviderFamily(backendSrc);
  const frontendUses = [
    ...inventoryEnvVars([...frontendSrc, ...nextConfig], SELF),
    ...inventoryEnvVars(frontendConfig, SELF),
  ];

  // Commented-out entries count as documented-but-unset.
  const backendExample = parseEnvExampleKeys(join(repoRoot, 'backend', '.env.example'));
  const frontendExample = parseEnvExampleKeys(join(repoRoot, 'frontend', '.env.example'));

  const backendGaps = diffEnvDocumentation(
    [...backendUses, ...providerVars.map((name) => ({ name, file: 'providers/config.ts' }))],
    backendExample,
  ).filter((gap) => !gap.documented);

  const frontendGaps = diffEnvDocumentation(
    frontendUses.map((use) => ({ name: use.name, file: use.file })),
    frontendExample,
  ).filter((gap) => !gap.documented);

  const findings: Finding[] = [];

  for (const gap of backendGaps) {
    findings.push(
      makeFinding('ENV_UNDOCUMENTED_BACKEND', 'HIGH', `Undocumented backend variable: ${gap.variable}`, {
        detail: `Read in ${gap.readIn.join(', ')} but not present in backend/.env.example.`,
        remedy: 'Document the variable in backend/.env.example so operators can configure it.',
      }),
    );
  }
  for (const gap of frontendGaps) {
    findings.push(
      makeFinding('ENV_UNDOCUMENTED_FRONTEND', 'LOW', `Undocumented frontend variable: ${gap.variable}`, {
        detail: `Read in ${gap.readIn.join(', ')} but not present in frontend/.env.example.`,
        remedy: 'Document the variable in frontend/.env.example.',
      }),
    );
  }

  const data = {
    backendVariablesRead: backendUses.length + providerVars.length,
    frontendVariablesRead: frontendUses.length,
    documentedBackend: backendExample.length,
    documentedFrontend: frontendExample.length,
    undocumentedBackend: backendGaps.map((gap) => gap.variable),
    undocumentedFrontend: frontendGaps.map((gap) => gap.variable),
  };
  const durationMs = Date.now() - startedAt;

  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('env.inventory', 'environment', 'Environment variable documentation', findings, { data, durationMs });
  }
  if (findings.length > 0) {
    return warn('env.inventory', 'environment', 'Environment variable documentation', findings, { data, durationMs });
  }
  return pass('env.inventory', 'environment', 'Environment variable documentation', {
    detail: `All ${data.backendVariablesRead} backend and ${data.frontendVariablesRead} frontend variables are documented.`,
    data,
    durationMs,
  });
}

export function checkEnvSeparation(env: Record<string, string | undefined>): CheckResult {
  const startedAt = Date.now();
  const mode = resolveEnvMode(env.NODE_ENV);
  const violations = evaluateEnv(env);

  if (mode !== 'production') {
    // Rules are only enforceable in production; say so explicitly instead of
    // reporting a green check that proves nothing.
    const ruleNames = envRules().map((rule) => rule.variable);
    const unset = ruleNames.filter((name) => !(env[name] ?? '').trim());
    return skip(
      'env.separation',
      'environment',
      'Production environment separation',
      `NODE_ENV=${mode}. Production rules are enforced by assertEnvIsSane() at boot but cannot be ` +
        `verified here; ${unset.length} production-required variable(s) are currently unset.`,
      {
        data: {
          mode,
          productionRequiredButUnset: unset,
          evaluatedRules: ruleNames,
        },
        durationMs: Date.now() - startedAt,
      },
    );
  }

  const findings: Finding[] = violations.map((violation, index) =>
    makeFinding(`ENV_VIOLATION_${index + 1}`, violation.severity, violation.message, {
      detail: `rule=${violation.rule} variable=${violation.variable}`,
      remedy: 'Correct the deployment environment; see backend/.env.example.',
    }),
  );

  const data = { mode, violationCount: violations.length };
  const durationMs = Date.now() - startedAt;
  if (violations.some((violation) => violation.severity === 'BLOCKER')) {
    return fail('env.separation', 'environment', 'Production environment separation', findings, { data, durationMs });
  }
  if (violations.length > 0) {
    return warn('env.separation', 'environment', 'Production environment separation', findings, { data, durationMs });
  }
  return pass('env.separation', 'environment', 'Production environment separation', {
    detail: 'No placeholder credentials, local origins, or privilege-escalation issues.',
    data,
    durationMs,
  });
}

export interface SecretScanResult {
  sourceHits: ReturnType<typeof scanForSecrets>;
  bundleHits: ReturnType<typeof scanForSecrets>;
  bundleScanned: boolean;
  clientSecretUses: ReturnType<typeof findClientSideSecretUse>;
}

/** Scans source plus the built frontend bundle for credential material. */
export function scanForSecretExposure(repoRoot: string): SecretScanResult {
  const sourceFiles = [
    ...collectFiles(join(repoRoot, 'backend', 'src')),
    ...collectFiles(join(repoRoot, 'frontend', 'src')),
    ...collectFiles(join(repoRoot, 'supabase'), 2_000_000),
    ...collectFiles(join(repoRoot, 'backend'), 2_000_000).filter((file) =>
      ['package.json', 'tsconfig.json', '.env.example'].includes(file.path),
    ),
    ...collectFiles(join(repoRoot, 'frontend'), 2_000_000).filter((file) =>
      ['next.config.mjs', 'package.json', 'tsconfig.json', '.env.example', 'eslint.config.mjs'].includes(file.path),
    ),
  ];

  // The compiled browser bundle is the real leak surface for secrets.
  const bundleDir = join(repoRoot, 'frontend', '.next', 'static');
  const bundleFiles = collectFiles(bundleDir);
  const clientSecretUses = findClientSideSecretUse(collectFiles(join(repoRoot, 'frontend', 'src')));

  return {
    sourceHits: scanForSecrets(sourceFiles),
    bundleHits: scanForSecrets(bundleFiles),
    bundleScanned: bundleFiles.length > 0,
    clientSecretUses,
  };
}

export function checkSecretExposure(repoRoot: string): CheckResult {
  const startedAt = Date.now();
  const scan = scanForSecretExposure(repoRoot);
  const findings: Finding[] = [];

  const allHits = [
    ...scan.sourceHits.map((hit) => ({ ...hit, surface: 'source' as const })),
    ...scan.bundleHits.map((hit) => ({ ...hit, surface: 'browser-bundle' as const })),
  ];

  for (const hit of allHits) {
    findings.push(
      makeFinding(
        hit.surface === 'browser-bundle' ? 'SECRET_IN_BROWSER_BUNDLE' : 'SECRET_IN_SOURCE',
        hit.severity,
        `Credential material detected (${hit.detector}) in ${hit.surface}: ${hit.file}:${hit.line}`,
        {
          detail: `Matched a redacted ${hit.detector} pattern.`,
          remedy: 'Remove the credential, rotate it at the provider, and load it from the environment.',
        },
      ),
    );
  }

  for (const use of scan.clientSecretUses) {
    findings.push(
      makeFinding('SECRET_READ_IN_CLIENT_CODE', 'BLOCKER', `Frontend code reads server-only variable ${use.variable}`, {
        detail: `${use.file}:${use.line}`,
        remedy:
          'Server-only variables must be read in server components or route handlers only; ' +
          'the browser bundle receives them at build time if referenced directly.',
      }),
    );
  }

  const data = {
    sourceHits: scan.sourceHits.length,
    bundleHits: scan.bundleHits.length,
    bundleScanned: scan.bundleScanned,
    clientSecretUses: scan.clientSecretUses.length,
  };

  if (!scan.bundleScanned) {
    findings.push(
      makeFinding(
        'SECRET_BUNDLE_NOT_SCANNED',
        'MEDIUM',
        'Frontend production bundle was not present, so browser-side exposure was not checked',
        { remedy: 'Run `npm run build` in frontend/ then re-run verification.' },
      ),
    );
  }

  const durationMs = Date.now() - startedAt;
  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('env.secrets', 'security', 'Secret exposure', findings, { data, durationMs });
  }
  if (findings.length > 0) {
    return warn('env.secrets', 'security', 'Secret exposure', findings, { data, durationMs });
  }
  return pass('env.secrets', 'security', 'Secret exposure', {
    detail: 'No credential material found in source or the browser bundle; no server-only variables read by frontend code.',
    data,
    durationMs,
  });
}
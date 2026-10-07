/**
 * Environment separation rules (Step 40).
 *
 * Pure, dependency-free predicates describing what a given NODE_ENV is allowed
 * to look like. Kept separate from `config` so the audit CLI can evaluate the
 * rules against an arbitrary environment without booting the app, and so the
 * boot-time guard and the audit share one single source of truth.
 *
 * Rules are intentionally data-driven: a violation is reported by variable
 * name only, never by value, so the guard can log safely.
 */

export type EnvMode = 'development' | 'test' | 'production';

export function resolveEnvMode(nodeEnv: string | undefined): EnvMode {
  if (nodeEnv === 'production' || nodeEnv === 'prod') return 'production';
  if (nodeEnv === 'test') return 'test';
  return 'development';
}

/** Placeholder values that ship in .env.example and must never reach production. */
export const PLACEHOLDER_VALUES: readonly string[] = [
  'xyzcompany.supabase.co',
  'public-anon-key',
  'service-role-key-keep-secret',
  'changeme',
  'your-api-key',
  'placeholder',
  'example',
  'test',
  'dummy',
  'fake',
  'local',
  'localhost',
];

export interface EnvViolation {
  /** Variable name only — values are never included. */
  variable: string;
  rule: string;
  message: string;
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM';
}

interface Rule {
  variable: string;
  /** Required in every mode that is not development. */
  requiredOutsideDev?: boolean;
  /** Must be non-empty in production. */
  requiredInProd?: boolean;
  /** Forbid this value (case-insensitive substring) in production. */
  forbidInProd?: readonly string[];
  /** Overrides the default "placeholder value" wording for forbidInProd. */
  forbidMessage?: string;
  /** Value must be a syntactically valid absolute http(s) URL in production. */
  urlInProd?: boolean;
  /** Only enforced when the matching `<PREFIX>_ENABLED` env is truthy. */
  providerScoped?: boolean;
}

const PROVIDER_PREFIXES = ['PROVIDER'];

function providerRules(): Rule[] {
  const rules: Rule[] = [];
  for (const prefix of PROVIDER_PREFIXES) {
    // Required only when the provider is explicitly enabled; evaluated
    // conditionally in evaluateEnv via `providerScoped`.
    rules.push({ variable: `${prefix}_BASE_URL`, requiredOutsideDev: true, urlInProd: true, providerScoped: true });
    rules.push({ variable: `${prefix}_API_KEY`, requiredInProd: true, forbidInProd: PLACEHOLDER_VALUES, providerScoped: true });
    rules.push({ variable: `${prefix}_ENABLED`, requiredOutsideDev: false });
  }
  return rules;
}

/** The full rule set evaluated in every mode. */
export function envRules(): Rule[] {
  return [
    {
      variable: 'SUPABASE_URL',
      requiredOutsideDev: true,
      // `https://xyzcompany.supabase.co` ships in .env.example and is a
      // syntactically valid URL, so it must be rejected explicitly.
      forbidInProd: PLACEHOLDER_VALUES,
      urlInProd: true,
    },
    { variable: 'SUPABASE_ANON_KEY', requiredOutsideDev: true, forbidInProd: PLACEHOLDER_VALUES },
    {
      variable: 'SUPABASE_SERVICE_ROLE_KEY',
      requiredOutsideDev: true,
      requiredInProd: true,
      forbidInProd: [...PLACEHOLDER_VALUES, 'anon'],
    },
    { variable: 'SITE_BASE_URL', requiredInProd: true, urlInProd: true },
    { variable: 'CORS_ORIGINS', requiredInProd: true },
    // DEV-ONLY admin auth bypass. Truthy values are rejected in production so
    // the Admin API can never boot with authorization switched off. The rule
    // matches on substring, so only the documented truthy spellings trip it.
    {
      variable: 'ADMIN_BYPASS_AUTH',
      forbidInProd: ['1', 'true', 'yes', 'on'],
      forbidMessage:
        'ADMIN_BYPASS_AUTH disables all Admin authorization and must never be enabled in production',
    },
    ...providerRules(),
  ];
}

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_VALUES.some((candidate) => lower.includes(candidate));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Evaluate the rule set against an environment map.
 * Returns every violation; does not throw and never echoes values.
 */
export function evaluateEnv(env: Record<string, string | undefined>): EnvViolation[] {
  const mode = resolveEnvMode(env.NODE_ENV);
  const violations: EnvViolation[] = [];

  const truthy = (v: string | undefined): boolean => {
    const raw = (v ?? '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  };
  // Provider credentials are only mandatory when the provider is enabled.
  const providerEnabled = truthy(env.PROVIDER_ENABLED);

  for (const rule of envRules()) {
    if (rule.providerScoped && !providerEnabled) continue;

    const raw = env[rule.variable];
    const value = raw?.trim() ?? '';
    const set = value.length > 0;

    if (!set) {
      if (rule.requiredOutsideDev && mode !== 'development') {
        violations.push({
          variable: rule.variable,
          rule: 'required',
          message: `${rule.variable} is required when NODE_ENV=${mode}`,
          severity: 'BLOCKER',
        });
      } else if (rule.requiredInProd && mode === 'production') {
        violations.push({
          variable: rule.variable,
          rule: 'required',
          message: `${rule.variable} is required in production`,
          severity: 'BLOCKER',
        });
      }
      continue;
    }

    if (mode !== 'production') continue;

    for (const forbidden of rule.forbidInProd ?? []) {
      if (value.toLowerCase().includes(forbidden.toLowerCase())) {
        violations.push({
          variable: rule.variable,
          rule: 'placeholder',
          message:
            rule.forbidMessage ?? `${rule.variable} still holds a placeholder/example value in production`,
          severity: 'BLOCKER',
        });
        break;
      }
    }

    if (rule.urlInProd && !isHttpUrl(value)) {
      violations.push({
        variable: rule.variable,
        rule: 'url',
        message: `${rule.variable} must be an absolute http(s) URL in production`,
        severity: 'HIGH',
      });
    }
  }

  // Environment separation: production must not advertise local CORS origins.
  if (mode === 'production') {
    const origins = (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim().toLowerCase())
      .filter((origin) => origin.length > 0);
    if (origins.length > 0 && origins.every((origin) => origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      violations.push({
        variable: 'CORS_ORIGINS',
        rule: 'env-separation',
        message: 'CORS_ORIGINS contains only local origins in production',
        severity: 'BLOCKER',
      });
    }
    const siteBase = (env.SITE_BASE_URL ?? '').toLowerCase();
    if (siteBase.includes('example.com') || siteBase.includes('localhost')) {
      violations.push({
        variable: 'SITE_BASE_URL',
        rule: 'env-separation',
        message: 'SITE_BASE_URL is a placeholder/local URL in production (canonical URLs would be wrong)',
        severity: 'BLOCKER',
      });
    }
  }

  // The service-role key must never be the same value as the public anon key.
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const anonKey = (env.SUPABASE_ANON_KEY ?? '').trim();
  if (serviceKey.length > 0 && serviceKey === anonKey) {
    violations.push({
      variable: 'SUPABASE_SERVICE_ROLE_KEY',
      rule: 'privilege-escalation',
      message: 'SUPABASE_SERVICE_ROLE_KEY is identical to SUPABASE_ANON_KEY',
      severity: 'BLOCKER',
    });
  }

  return violations;
}

/**
 * Boot-time guard. Throws when the environment cannot legally serve traffic,
 * so a misconfigured production deploy fails immediately and loudly rather
 * than serving placeholder/empty configuration.
 */
export function assertEnvIsSane(env: Record<string, string | undefined> = process.env): void {
  const mode = resolveEnvMode(env.NODE_ENV);
  if (mode !== 'production') return;

  const violations = evaluateEnv(env);
  if (violations.length === 0) return;

  const detail = violations.map((v) => `  - [${v.severity}] ${v.message}`).join('\n');
  throw new Error(`Refusing to start in production with an unsafe environment:\n${detail}`);
}
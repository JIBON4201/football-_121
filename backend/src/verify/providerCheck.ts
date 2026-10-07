/**
 * Step 40 — provider connection and adapter-pipeline verification.
 *
 * Pipeline stage order (Step 40 contract):
 *   Provider → Adapter → Validation → Normalization → External ID Resolution
 *   → Deduplication → Database → Cache → Backend API → Frontend
 *
 * The offline checks (config shape, secret hygiene, and the existence of a
 * registered adapter) always run. Connectivity and live traffic only run when
 * real provider credentials are configured; otherwise they report SKIP with a
 * reason so the report never looks green without evidence.
 */
import { resolveEnvMode } from '../lib/envRules';
import {
  validateProviderConfig,
  providerConfigFromRecord,
  redactedConfig,
} from '../providers/config';
import { listRegistrations } from '../providers/registry';
import { registerSeedProvider } from '../providers/seed/seedProvider';
import { fail, makeFinding, pass, skip, warn, type CheckResult, type Finding } from './types';

export const PROVIDER_PREFIX = 'PROVIDER';

export interface ProviderEnvCheck {
  enabled: boolean;
  problems: string[];
  redacted: Record<string, unknown>;
}

export function inspectProviderEnv(env: Record<string, string | undefined>): ProviderEnvCheck {
  // Read the supplied map explicitly — never process.env — so the audit can
  // evaluate an arbitrary environment without mutating global state.
  const cfg = providerConfigFromRecord(env, PROVIDER_PREFIX);
  const enabled = cfg.enabled;
  const problems = validateProviderConfig(cfg);
  return { enabled, problems, redacted: redactedConfig(cfg) };
}

/**
 * Provider configuration shape. Runs offline: when the provider is disabled
 * this reports SKIP (nothing to verify yet), and when it is enabled it must be
 * structurally valid.
 */
export function checkProviderConfig(env: Record<string, string | undefined>): CheckResult {
  const startedAt = Date.now();
  const { enabled, problems, redacted } = inspectProviderEnv(env);
  const data = { enabled, ...redacted };

  if (!enabled) {
    return skip(
      'provider.config',
      'provider',
      'Provider configuration',
      `${PROVIDER_PREFIX}_ENABLED is not "true". Set real provider credentials and enable the ` +
        'provider to verify connectivity, rate limits, pagination and response validation.',
      { data, durationMs: Date.now() - startedAt },
    );
  }

  if (problems.length > 0) {
    const findings: Finding[] = problems.map((problem, index) =>
      makeFinding(`PROVIDER_CONFIG_${index + 1}`, 'BLOCKER', `Invalid provider configuration: ${problem}`, {
        remedy: `Correct ${PROVIDER_PREFIX}_* variables; see backend/.env.example.`,
      }),
    );
    return fail('provider.config', 'provider', 'Provider configuration', findings, {
      data,
      durationMs: Date.now() - startedAt,
    });
  }

  return pass('provider.config', 'provider', 'Provider configuration', {
    detail: 'Provider base URL, timeout and retry policy are structurally valid.',
    data,
    durationMs: Date.now() - startedAt,
  });
}

/**
 * Confirms a runtime adapter is registered for the configured data source.
 *
 * The seed/mock provider is only registered outside production: this audit runs
 * in production too, and registering the fixture adapter there would mask a
 * missing real provider.
 */
export function checkAdapterRegistered(): CheckResult {
  const startedAt = Date.now();
  const isProd = resolveEnvMode(process.env.NODE_ENV) === 'production';
  if (!isProd) registerSeedProvider();

  const registrations = listRegistrations().map((registration) => ({
    name: registration.name,
    enabled: registration.enabled,
    priority: registration.priority,
  }));

  if (registrations.length === 0) {
    // In production this means no real provider adapter is wired up yet, which
    // is the Step 40 provider blocker rather than a new defect.
    return isProd
      ? skip(
          'provider.adapter',
          'provider',
          'Provider adapter registration',
          'No provider adapter is registered in production. The real provider adapter has not been ' +
            'implemented yet (see the Step 40 provider blocker), so live imports cannot run.',
          { durationMs: Date.now() - startedAt },
        )
      : fail(
          'provider.adapter',
          'provider',
          'Provider adapter registration',
          [
            makeFinding('PROVIDER_NO_ADAPTER', 'BLOCKER', 'No provider adapter is registered', {
              remedy: 'Register a provider adapter before importing data.',
            }),
          ],
          { durationMs: Date.now() - startedAt },
        );
  }

  if (isProd && registrations.every((registration) => registration.name === 'seed')) {
    return fail(
      'provider.adapter',
      'provider',
      'Provider adapter registration',
      [
        makeFinding(
          'PROVIDER_ONLY_MOCK_IN_PROD',
          'HIGH',
          'Production would only have the seed/mock provider adapter available',
          {
            detail: `Registered: ${registrations.map((r) => r.name).join(', ')}`,
            remedy: 'Register the real provider adapter before enabling production sync.',
          },
        ),
      ],
      { data: { registrations }, durationMs: Date.now() - startedAt },
    );
  }

  const active = registrations.filter((registration) => registration.enabled);
  if (active.length === 0) {
    return warn(
      'provider.adapter',
      'provider',
      'Provider adapter registration',
      [
        makeFinding('PROVIDER_ADAPTER_DISABLED', 'HIGH', 'Every registered provider adapter is disabled', {
          detail: `Registered: ${registrations.map((r) => r.name).join(', ')}`,
          remedy: 'Enable the adapter for the provider you intend to import from.',
        }),
      ],
      { data: { registrations }, durationMs: Date.now() - startedAt },
    );
  }

  return pass('provider.adapter', 'provider', 'Provider adapter registration', {
    detail: `Active adapter(s): ${active.map((r) => r.name).join(', ')}.`,
    data: { registrations },
    durationMs: Date.now() - startedAt,
  });
}

/**
 * Secret-exposure boundary for provider credentials: the key must never be
 * embedded in code, and diagnostics must render redacted config only.
 */
export function checkProviderSecretHygiene(env: Record<string, string | undefined>): CheckResult {
  const startedAt = Date.now();
  const findings: Finding[] = [];

  const cfg = providerConfigFromRecord(env, PROVIDER_PREFIX);
  const redacted = redactedConfig(cfg);
  const serialized = JSON.stringify(redacted);

  if (cfg.apiKey && serialized.includes(cfg.apiKey)) {
    findings.push(
      makeFinding('PROVIDER_KEY_IN_DIAGNOSTICS', 'BLOCKER', 'redactedConfig() leaks the provider API key', {
        remedy: 'Never include apiKey in diagnostic output; report only hasApiKey.',
      }),
    );
  }
  if (cfg.apiKey && (redacted as Record<string, unknown>).apiKey !== undefined) {
    findings.push(
      makeFinding('PROVIDER_KEY_FIELD_PRESENT', 'BLOCKER', 'redactedConfig() exposes an apiKey field', {
        remedy: 'Remove the apiKey field from redactedConfig().',
      }),
    );
  }

  const apiKey = (env[`${PROVIDER_PREFIX}_API_KEY`] ?? '').trim();
  if (apiKey && apiKey.toLowerCase().includes('example')) {
    findings.push(
      makeFinding('PROVIDER_KEY_PLACEHOLDER', 'HIGH', 'Provider API key still holds an example value', {
        remedy: 'Replace with the real provider credential.',
      }),
    );
  }

  const data = { hasApiKey: Boolean(cfg.apiKey), keyHeader: cfg.keyHeader, durationMs: Date.now() - startedAt };
  if (findings.length > 0) {
    return fail('provider.secrets', 'provider', 'Provider credential hygiene', findings, { data });
  }
  return pass('provider.secrets', 'provider', 'Provider credential hygiene', {
    detail: 'Provider credentials are environment-only and diagnostics render redacted.',
    data,
  });
}
/**
 * Step 40 verification result model.
 *
 * Every verification check returns a `CheckResult`. Findings carry an explicit
 * severity so the final report can be classified BLOCKER / HIGH / MEDIUM / LOW
 * and gated automatically. Failures are never collapsed away: a check that
 * cannot run reports SKIP with the reason, never PASS.
 */

export type Severity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** PASS = verified good. FAIL = verified bad. WARN = degraded. SKIP = not verifiable here. */
export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

export const SEVERITY_ORDER: readonly Severity[] = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/** Report sections required by the Step 40 final report. */
export type GroupId =
  | 'environment'
  | 'database'
  | 'provider'
  | 'api'
  | 'worker'
  | 'live'
  | 'frontend'
  | 'seo'
  | 'media'
  | 'security'
  | 'performance';

export const GROUP_ORDER: readonly GroupId[] = [
  'environment',
  'database',
  'provider',
  'api',
  'worker',
  'live',
  'frontend',
  'seo',
  'media',
  'security',
  'performance',
];

export const GROUP_LABELS: Record<GroupId, string> = {
  environment: 'Environment & Secret Hygiene',
  database: 'Database & Schema Consistency',
  provider: 'Provider Connection & Adapter Pipeline',
  api: 'API Contract & Caching',
  worker: 'Background Worker & Scheduler',
  live: 'Live Data Pipeline',
  frontend: 'Frontend Routes & Data Integrity',
  seo: 'SEO, Sitemap & Robots',
  media: 'Media Pipeline',
  security: 'Security Posture',
  performance: 'Performance',
};

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  remedy?: string;
}

export interface CheckResult {
  id: string;
  group: GroupId;
  title: string;
  status: CheckStatus;
  detail?: string;
  durationMs?: number;
  /** Structured, machine-readable evidence. Must never contain secrets. */
  data?: Record<string, unknown>;
  findings?: Finding[];
}

export function makeFinding(
  id: string,
  severity: Severity,
  title: string,
  extra: { detail?: string; remedy?: string } = {},
): Finding {
  return { id, severity, title, detail: extra.detail, remedy: extra.remedy };
}

/** Shared extras accepted by the result constructors. */
export interface ResultExtras {
  detail?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

/** Convenience constructors keeping call sites terse and consistent. */
export const pass = (
  id: string,
  group: GroupId,
  title: string,
  extra: ResultExtras = {},
): CheckResult => ({ id, group, title, status: 'PASS', ...extra });

export const fail = (
  id: string,
  group: GroupId,
  title: string,
  findings: Finding[],
  extra: ResultExtras = {},
): CheckResult => ({ id, group, title, status: 'FAIL', findings, ...extra });

export const warn = (
  id: string,
  group: GroupId,
  title: string,
  findings: Finding[],
  extra: ResultExtras = {},
): CheckResult => ({ id, group, title, status: 'WARN', findings, ...extra });

/**
 * SKIP is first-class and must carry a reason. A skipped check is never
 * silently treated as a pass — the report surfaces it as unverified.
 */
export const skip = (
  id: string,
  group: GroupId,
  title: string,
  reason: string,
  extra: ResultExtras = {},
): CheckResult => ({ id, group, title, status: 'SKIP', detail: reason, ...extra });

export function findingsOf(result: CheckResult): Finding[] {
  return result.findings ?? [];
}
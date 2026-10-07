/**
 * Step 40 verification report: aggregation, severity classification,
 * machine-readable JSON, human-readable Markdown, and CI exit gating.
 *
 * Gating policy (the "Final Rule"): any BLOCKER finding or any FAIL check
 * makes the run exit non-zero. SKIP does not pass silently — it is counted and
 * listed as unverified so a report can never look green while real-data
 * checks were never executed.
 */
import {
  GROUP_LABELS,
  GROUP_ORDER,
  SEVERITY_ORDER,
  findingsOf,
  severityRank,
  type CheckResult,
  type GroupId,
  type Severity,
} from './types';

export interface GroupSummary {
  group: GroupId;
  label: string;
  pass: number;
  fail: number;
  warn: number;
  skip: number;
  /** Worst severity present in this group, or null when clean. */
  worstSeverity: Severity | null;
}

export interface VerificationReport {
  schemaVersion: 1;
  generatedAt: string;
  /** Environment mode the report was produced in. */
  mode: string;
  /** True only when no BLOCKER and no FAIL — i.e. safe to consider shipping. */
  productionReady: boolean;
  totals: {
    checks: number;
    pass: number;
    fail: number;
    warn: number;
    /** Checks that could not be executed here. Never counted as success. */
    skipped: number;
    findings: number;
  };
  bySeverity: Record<Severity, number>;
  groups: GroupSummary[];
  checks: CheckResult[];
  blockers: string[];
  remainingBlockers: string[];
  warnings: string[];
}

function worstSeverity(results: CheckResult[]): Severity | null {
  let worst: Severity | null = null;
  for (const result of results) {
    for (const finding of findingsOf(result)) {
      if (worst === null || severityRank(finding.severity) < severityRank(worst)) worst = finding.severity;
    }
  }
  return worst;
}

function describe(check: CheckResult): string {
  const detail = check.detail ? ` — ${check.detail}` : '';
  return `${check.id}: ${check.title}${detail}`;
}

export function buildReport(checks: CheckResult[], mode: string): VerificationReport {
  const bySeverity = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<Severity, number>;

  const sorted = [...checks].sort((a, b) => {
    const groupDelta = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    return groupDelta !== 0 ? groupDelta : a.id.localeCompare(b.id);
  });

  const allFindings = sorted.flatMap((check) =>
    findingsOf(check).map((finding) => ({ check, finding })),
  );
  for (const { finding } of allFindings) bySeverity[finding.severity] += 1;

  const groups: GroupSummary[] = GROUP_ORDER.map((group) => {
    const scoped = sorted.filter((check) => check.group === group);
    return {
      group,
      label: GROUP_LABELS[group],
      pass: scoped.filter((c) => c.status === 'PASS').length,
      fail: scoped.filter((c) => c.status === 'FAIL').length,
      warn: scoped.filter((c) => c.status === 'WARN').length,
      skip: scoped.filter((c) => c.status === 'SKIP').length,
      worstSeverity: worstSeverity(scoped),
    };
  });

  const failChecks = sorted.filter((c) => c.status === 'FAIL');
  const blockerFindings = allFindings.filter(({ finding }) => finding.severity === 'BLOCKER');

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    productionReady: blockerFindings.length === 0 && failChecks.length === 0,
    totals: {
      checks: sorted.length,
      pass: sorted.filter((c) => c.status === 'PASS').length,
      fail: failChecks.length,
      warn: sorted.filter((c) => c.status === 'WARN').length,
      skipped: sorted.filter((c) => c.status === 'SKIP').length,
      findings: allFindings.length,
    },
    bySeverity,
    groups,
    checks: sorted,
    blockers: blockerFindings.map(({ check, finding }) => `${finding.id} (${check.id}) ${finding.title}`),
    // Anything not verified is an open risk, never a pass.
    remainingBlockers: [
      ...sorted.filter((c) => c.status === 'SKIP').map((c) => `UNVERIFIED ${c.id}: ${describe(c)}`),
    ],
    warnings: [
      ...sorted.filter((c) => c.status === 'WARN').map(describe),
      ...allFindings
        .filter(({ finding }) => finding.severity === 'MEDIUM' || finding.severity === 'LOW')
        .map(({ check, finding }) => `${finding.severity} ${finding.id} (${check.id}) ${finding.title}`),
    ],
  };
}

const ICON: Record<string, string> = { PASS: 'PASS', FAIL: 'FAIL', WARN: 'WARN', SKIP: 'SKIP' };

export function renderMarkdown(report: VerificationReport): string {
  const lines: string[] = [];
  lines.push('# Production Integration & Real-Data Verification Report');
  lines.push('');
  lines.push(`- Generated: \`${report.generatedAt}\``);
  lines.push(`- Mode: \`${report.mode}\``);
  lines.push(
    `- Verdict: **${report.productionReady ? 'NO BLOCKERS' : 'NOT PRODUCTION-READY'}**`,
  );
  lines.push(
    `- Checks: ${report.totals.checks} total — ${report.totals.pass} pass, ${report.totals.fail} fail, ` +
      `${report.totals.warn} warn, ${report.totals.skipped} unverified`,
  );
  lines.push(
    `- Findings: ${report.bySeverity.BLOCKER} blocker, ${report.bySeverity.HIGH} high, ` +
      `${report.bySeverity.MEDIUM} medium, ${report.bySeverity.LOW} low`,
  );
  lines.push('');

  lines.push('## Status by area');
  lines.push('');
  lines.push('| Area | Pass | Fail | Warn | Unverified | Worst |');
  lines.push('| --- | ---: | ---: | ---: | ---: | --- |');
  for (const group of report.groups) {
    lines.push(
      `| ${group.label} | ${group.pass} | ${group.fail} | ${group.warn} | ${group.skip} | ${group.worstSeverity ?? '—'} |`,
    );
  }
  lines.push('');

  if (report.blockers.length > 0) {
    lines.push('## Blockers');
    lines.push('');
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
    lines.push('');
  }

  if (report.remainingBlockers.length > 0) {
    lines.push('## Unverified (not passing — no evidence collected)');
    lines.push('');
    for (const item of report.remainingBlockers) lines.push(`- ${item}`);
    lines.push('');
  }

  if (report.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const warning of report.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  lines.push('## Full check detail');
  lines.push('');
  for (const group of report.groups) {
    const scoped = report.checks.filter((c) => c.group === group.group);
    if (scoped.length === 0) continue;
    lines.push(`### ${group.label}`);
    lines.push('');
    for (const check of scoped) {
      const duration = check.durationMs === undefined ? '' : ` (${check.durationMs}ms)`;
      lines.push(`- **${ICON[check.status]}** \`${check.id}\` ${check.title}${duration}`);
      if (check.detail) lines.push(`  - ${check.detail}`);
      for (const finding of findingsOf(check)) {
        lines.push(`  - **${finding.severity}** ${finding.id}: ${finding.title}`);
        if (finding.detail) lines.push(`    - ${finding.detail}`);
        if (finding.remedy) lines.push(`    - Remedy: ${finding.remedy}`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** Exit code: non-zero on any FAIL or BLOCKER. Warnings and skips do not mask failure. */
export function exitCodeFor(report: VerificationReport): number {
  return report.productionReady ? 0 : 1;
}
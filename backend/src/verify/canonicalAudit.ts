/**
 * Step 40 — canonical data audit and data-freshness audit.
 *
 * Consumes `verify_canonical_data()`. Reports duplicate canonical entities,
 * external-ID fan-out, broken relationships, and freshness signals. These
 * checks never mutate data: they produce evidence for a human decision.
 *
 * The audit is fetched once and projected into both checks by the pure
 * functions below, which are unit-testable without a database.
 */
import type { DbClient } from '../lib/supabase';
import { fail, makeFinding, pass, skip, warn, type CheckResult, type Finding } from './types';

export interface DuplicateGroup {
  normalized_name?: string;
  date_of_birth?: string | null;
  kickoff_at?: string;
  home_team_id?: string;
  away_team_id?: string;
  data_source_id?: string;
  entity_type?: string;
  external_id?: string;
  entity_id?: string;
  count: number;
  ids?: string[];
  names?: string[];
  entity_count?: number;
  entity_ids?: string[];
  external_ids?: string[];
}

export interface CanonicalAudit {
  duplicate_teams?: DuplicateGroup[];
  duplicate_competitions?: DuplicateGroup[];
  duplicate_players?: DuplicateGroup[];
  duplicate_matches?: DuplicateGroup[];
  external_id_fanout?: DuplicateGroup[];
  entity_multi_mapping?: DuplicateGroup[];
  broken_relationships?: Record<string, number>;
  freshness?: Record<string, number | string | null>;
}

export interface AuditSummary {
  duplicateTeams: number;
  duplicateCompetitions: number;
  duplicatePlayers: number;
  duplicateMatches: number;
  externalIdFanout: number;
  entityMultiMapping: number;
  brokenRelationships: Record<string, number>;
  freshness: Record<string, number | string | null>;
}

/** Freshness thresholds, in minutes, for records that must not look stale. */
export const FRESHNESS_BUDGET_MINUTES = {
  liveMatch: 15,
  stuckSyncJob: 30,
} as const;

export function summarizeAudit(audit: CanonicalAudit): AuditSummary {
  return {
    duplicateTeams: (audit.duplicate_teams ?? []).length,
    duplicateCompetitions: (audit.duplicate_competitions ?? []).length,
    duplicatePlayers: (audit.duplicate_players ?? []).length,
    duplicateMatches: (audit.duplicate_matches ?? []).length,
    externalIdFanout: (audit.external_id_fanout ?? []).length,
    entityMultiMapping: (audit.entity_multi_mapping ?? []).length,
    brokenRelationships: audit.broken_relationships ?? {},
    freshness: audit.freshness ?? {},
  };
}

function groupDetail(groups: DuplicateGroup[] | undefined, max = 10): string {
  const list = groups ?? [];
  if (list.length === 0) return 'none';
  return list
    .slice(0, max)
    .map((group) => {
      const label =
        group.normalized_name ?? group.external_id ?? group.entity_id ?? group.kickoff_at ?? 'group';
      const names = group.names?.length ? ` (${group.names.join(' | ')})` : '';
      return `${label} x${group.count}${names}`;
    })
    .join('; ');
}

function severityOf(findings: Finding[]): CheckResult['status'] {
  if (findings.some((f) => f.severity === 'BLOCKER')) return 'FAIL';
  if (findings.length > 0) return 'WARN';
  return 'PASS';
}

/**
 * Pure projection: canonical duplicate + relationship-integrity findings.
 */
export function buildCanonicalCheck(audit: CanonicalAudit): CheckResult {
  const summary = summarizeAudit(audit);
  const findings: Finding[] = [];

  const duplicateRules: {
    count: number;
    id: string;
    label: string;
    groups: DuplicateGroup[] | undefined;
  }[] = [
    { count: summary.duplicateTeams, id: 'DB_DUPLICATE_TEAMS', label: 'teams', groups: audit.duplicate_teams },
    { count: summary.duplicateCompetitions, id: 'DB_DUPLICATE_COMPETITIONS', label: 'competitions', groups: audit.duplicate_competitions },
    { count: summary.duplicatePlayers, id: 'DB_DUPLICATE_PLAYERS', label: 'players', groups: audit.duplicate_players },
    { count: summary.duplicateMatches, id: 'DB_DUPLICATE_MATCHES', label: 'matches', groups: audit.duplicate_matches },
  ];

  for (const rule of duplicateRules) {
    if (rule.count === 0) continue;
    findings.push(
      makeFinding(rule.id, 'BLOCKER', `Duplicate canonical ${rule.label} (${rule.count} group(s))`, {
        detail: groupDetail(rule.groups),
        remedy:
          'Merge or retire the duplicates, then confirm the provider external IDs resolve to a single canonical row.',
      }),
    );
  }

  if (summary.externalIdFanout > 0) {
    findings.push(
      makeFinding(
        'DB_EXTERNAL_ID_FANOUT',
        'BLOCKER',
        `One provider external ID maps to multiple canonical entities (${summary.externalIdFanout} case(s))`,
        {
          detail: groupDetail(audit.external_id_fanout),
          remedy: 'Reconcile external ID mappings so each provider record has exactly one canonical entity.',
        },
      ),
    );
  }

  if (summary.entityMultiMapping > 0) {
    findings.push(
      makeFinding(
        'DB_ENTITY_MULTI_EXTERNAL_ID',
        'HIGH',
        `Canonical entities mapped to multiple external IDs (${summary.entityMultiMapping} entity/ies)`,
        {
          detail: groupDetail(audit.entity_multi_mapping),
          remedy: 'Reconcile provider identifiers; one canonical entity should map to one external record per data source.',
        },
      ),
    );
  }

  for (const [relation, count] of Object.entries(summary.brokenRelationships)) {
    if ((count ?? 0) <= 0) continue;
    findings.push(
      makeFinding(
        'DB_BROKEN_RELATIONSHIP',
        'HIGH',
        `Broken relationship: ${relation} (${count} orphan row(s))`,
        { remedy: 'Repair or remove the orphaned rows; the related pages render incomplete data.' },
      ),
    );
  }

  const data = summary as unknown as Record<string, unknown>;
  const status = severityOf(findings);

  if (status === 'FAIL') {
    return fail('db.canonical', 'database', 'Canonical data audit', findings, { data });
  }
  if (status === 'WARN') {
    return warn('db.canonical', 'database', 'Canonical data audit', findings, { data });
  }
  return pass('db.canonical', 'database', 'Canonical data audit', {
    detail: 'No duplicate canonical entities, no external-ID fan-out, no broken relationships.',
    data,
  });
}

/** Pure projection: freshness findings for live data and worker progress. */
export function buildFreshnessCheck(audit: CanonicalAudit): CheckResult {
  const freshness = summarizeAudit(audit).freshness;
  const findings: Finding[] = [];
  const num = (key: string): number => {
    const value = freshness[key];
    return typeof value === 'number' ? value : 0;
  };

  if (num('live_matches_stale') > 0) {
    findings.push(
      makeFinding(
        'DATA_STALE_LIVE',
        'BLOCKER',
        `${num('live_matches_stale')} live match(es) not refreshed within ${FRESHNESS_BUDGET_MINUTES.liveMatch} minutes`,
        {
          detail: 'Stale scores are still being presented as current — this is shown to end users as live.',
          remedy: 'Check worker health and provider rate limits, then force a live sync.',
        },
      ),
    );
  }
  if (num('finished_without_score') > 0) {
    findings.push(
      makeFinding('DATA_FINISHED_WITHOUT_SCORE', 'HIGH', `${num('finished_without_score')} finished match(es) have no score`, {
        remedy: 'Re-sync those fixtures or correct the provider mapping.',
      }),
    );
  }
  if (num('finished_future_kickoff') > 0) {
    findings.push(
      makeFinding(
        'DATA_FINISHED_FUTURE_KICKOFF',
        'HIGH',
        `${num('finished_future_kickoff')} match(es) marked finished with a future kickoff`,
        { remedy: 'Correct the status mapping or re-import these fixtures.' },
      ),
    );
  }
  if (num('scheduled_past_kickoff') > 0) {
    findings.push(
      makeFinding(
        'DATA_STALE_SCHEDULED',
        'MEDIUM',
        `${num('scheduled_past_kickoff')} match(es) still 'scheduled'/'pre_match' long after kickoff`,
        {
          detail: 'The live sync has not advanced these fixtures to a live or finished state.',
          remedy: 'Run the live sync worker and confirm provider coverage for these competitions.',
        },
      ),
    );
  }
  if (num('stuck_running_sync_jobs') > 0) {
    findings.push(
      makeFinding('WORKER_STUCK_JOBS', 'HIGH', `${num('stuck_running_sync_jobs')} sync job(s) stuck in 'running'`, {
        detail: `A worker likely died mid-claim; leases exceed ${FRESHNESS_BUDGET_MINUTES.stuckSyncJob} minutes.`,
        remedy: 'Run the recovery path so stale claims are released and re-queued.',
      }),
    );
  }
  if (num('failed_sync_jobs') > 0) {
    findings.push(
      makeFinding('WORKER_FAILED_JOBS', 'MEDIUM', `${num('failed_sync_jobs')} sync job(s) in a failed state`, {
        remedy: 'Inspect sync_errors for the failing jobs and re-queue once the cause is fixed.',
      }),
    );
  }

  const data = freshness as Record<string, unknown>;
  const status = severityOf(findings);

  if (status === 'FAIL') {
    return fail('data.freshness', 'live', 'Data freshness audit', findings, { data });
  }
  if (status === 'WARN') {
    return warn('data.freshness', 'live', 'Data freshness audit', findings, { data });
  }
  return pass('data.freshness', 'live', 'Data freshness audit', {
    detail: 'No stale live data, stuck jobs, or score inconsistencies detected.',
    data,
  });
}

/**
 * Fetches the audit once and returns both checks, so a single round trip backs
 * two report sections. A failure to call the function reports SKIP (unverified)
 * for both, never PASS.
 */
export async function checkCanonicalAndFreshness(client: DbClient): Promise<CheckResult[]> {
  const startedAt = Date.now();
  try {
    const { data, error } = await client.rpc('verify_canonical_data' as never);
    if (error) throw new Error(error.message);
    const audit = (data ?? {}) as CanonicalAudit;
    return [buildCanonicalCheck(audit), buildFreshnessCheck(audit)];
  } catch (error) {
    const reason = `Could not run verify_canonical_data(): ${
      error instanceof Error ? error.message : 'unknown error'
    }. Apply supabase/migrations/023_step40_verification.sql to enable this check.`;
    return [
      skip(
        'db.canonical',
        'database',
        'Canonical data audit (duplicates, external IDs, relationships)',
        reason,
        { durationMs: Date.now() - startedAt },
      ),
      skip('data.freshness', 'live', 'Data freshness audit', reason, {
        durationMs: Date.now() - startedAt,
      }),
    ];
  }
}
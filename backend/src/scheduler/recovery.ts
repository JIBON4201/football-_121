import { log } from '../lib/logger';
import { serviceClient, type DbClient } from '../lib/supabase';

export interface RecoverySummary {
  examined: number;
  requeued: number;
  deadLettered: number;
}

/**
 * Stale-job recovery: running rows whose lease expired are requeued while
 * attempts remain, otherwise dead-lettered with a diagnostic sync_errors
 * row. Never requires manual database edits.
 */
export async function recoverStaleJobs(
  options: { nowMs?: number; limit?: number; client?: DbClient } = {},
): Promise<RecoverySummary> {
  const client = options.client ?? serviceClient();
  const now = new Date(options.nowMs ?? Date.now()).toISOString();
  const summary: RecoverySummary = { examined: 0, requeued: 0, deadLettered: 0 };
  const { data, error } = await client
    .from('sync_jobs')
    .select('*')
    .eq('status', 'running')
    .lte('lease_expires_at', now)
    .order('created_at', { ascending: true })
    .range(0, (options.limit ?? 50) - 1);
  if (error || !data) return summary;
  const rows = data as Array<Record<string, unknown>>;
  for (const row of rows) {
    const id = String(row.id);
    summary.examined += 1;
    const attempts = Number(row.attempts ?? 0);
    const maxAttempts = Number(row.max_attempts ?? 5);
    if (attempts >= maxAttempts) {
      await client
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: now,
          error_message: 'Stale job exceeded retry budget',
          claimed_by: null,
          lease_expires_at: null,
        })
        .eq('id', id)
        .eq('status', 'running')
        .lte('lease_expires_at', now);
      await client.from('sync_errors').insert({
        sync_job_id: id,
        entity_type: (row.entity_type as string | null) ?? null,
        error_code: 'STALE_JOB',
        error_message: 'Job left running past its lease and exhausted retries',
      });
      summary.deadLettered += 1;
      log({ msg: 'job_dead_lettered', jobId: id, attempts });
      continue;
    }
    const { data: requeued } = await client
      .from('sync_jobs')
      .update({ status: 'queued', claimed_by: null, lease_expires_at: null, run_after: now })
      .eq('id', id)
      .eq('status', 'running')
      .lte('lease_expires_at', now)
      .select('id');
    if (((requeued as unknown[]) ?? []).length > 0) {
      summary.requeued += 1;
      log({ msg: 'job_recovered', jobId: id, attempts });
    }
  }
  return summary;
}

export type FreshnessState = 'fresh' | 'aging' | 'stale' | 'unavailable';

export interface FreshnessEntry {
  provider: string;
  entityType: string;
  lastCompletedAt: string | null;
  ageMs: number | null;
  state: FreshnessState;
}

/** Freshness windows per entity family (ms). Conservative defaults. */
const MINUTE = 60_000;
const HOUR = 3_600_000;

export const FRESHNESS_WINDOWS: Record<string, { freshMs: number; agingMs: number }> = {
  matches: { freshMs: 15 * MINUTE, agingMs: 2 * HOUR },
  events: { freshMs: 15 * MINUTE, agingMs: 2 * HOUR },
  lineups: { freshMs: 30 * MINUTE, agingMs: 4 * HOUR },
  'team-stats': { freshMs: 30 * MINUTE, agingMs: 4 * HOUR },
  'player-stats': { freshMs: 30 * MINUTE, agingMs: 4 * HOUR },
  transfers: { freshMs: HOUR, agingMs: 12 * HOUR },
  default: { freshMs: 6 * HOUR, agingMs: 24 * HOUR },
};

function classify(ageMs: number, entityType: string): FreshnessState {
  const windows = FRESHNESS_WINDOWS[entityType] ?? FRESHNESS_WINDOWS.default;
  if (ageMs <= windows.freshMs) return 'fresh';
  if (ageMs <= windows.agingMs) return 'aging';
  return 'stale';
}

/**
 * Dataset freshness derived only from real sync history — never fabricated.
 * Groups the latest successful job per (provider, entity).
 */
export async function getFreshness(
  filter: { provider?: string; entityType?: string; nowMs?: number; client?: DbClient } = {},
): Promise<FreshnessEntry[]> {
  const client = filter.client ?? serviceClient();
  const nowMs = filter.nowMs ?? Date.now();
  const { data: sources } = await client.from('data_sources').select('id,provider');
  const providerById = new Map<string, string>();
  for (const row of ((sources as Array<{ id: string; provider: string }> | null) ?? [])) {
    providerById.set(String(row.id), String(row.provider));
  }
  const { data: jobs } = await client
    .from('sync_jobs')
    .select('data_source_id,entity_type,completed_at')
    .in('status', ['completed', 'partial'])
    .order('completed_at', { ascending: false })
    .range(0, 199);
  const latest = new Map<string, { provider: string; entityType: string; at: string }>();
  for (const row of ((jobs as Array<{ data_source_id: string; entity_type: string; completed_at: string }> | null) ?? [])) {
    const provider = providerById.get(String(row.data_source_id)) ?? 'unknown';
    if (filter.provider && provider !== filter.provider) continue;
    if (filter.entityType && String(row.entity_type) !== filter.entityType) continue;
    const key = `${provider}|${String(row.entity_type)}`;
    if (!latest.has(key) && row.completed_at) {
      latest.set(key, { provider, entityType: String(row.entity_type), at: String(row.completed_at) });
    }
  }
  return [...latest.values()].map((entry) => {
    const ageMs = nowMs - Date.parse(entry.at);
    return {
      provider: entry.provider,
      entityType: entry.entityType,
      lastCompletedAt: entry.at,
      ageMs,
      state: classify(ageMs, entry.entityType),
    };
  });
}

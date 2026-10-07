/**
 * Quarantine sinks for records that cannot be imported.
 *
 * Live runs write to the existing `sync_errors` table (source file, entity,
 * source id, error code/message, original record reference and timestamp all
 * fit its columns). Dry runs — which must not touch the database — collect
 * into memory for the report instead. Nothing is ever silently discarded.
 */
import type { DbClient } from '../lib/supabase';
import type { DatasetFile, QuarantineRecord } from './types';

const MAX_RECORD_BYTES = 2048;

function trimRecord(record: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(record);
  if (json.length <= MAX_RECORD_BYTES) return record;
  return { _truncated: true, preview: json.slice(0, MAX_RECORD_BYTES) };
}

export interface QuarantineSink {
  quarantine(entry: Omit<QuarantineRecord, 'timestamp'>): Promise<void>;
}

export function dbQuarantineSink(client: DbClient, jobId: string): QuarantineSink {
  return {
    async quarantine(entry: Omit<QuarantineRecord, 'timestamp'>): Promise<void> {
      const { error } = await client.from('sync_errors').insert({
        sync_job_id: jobId,
        entity_type: entry.entityType,
        external_id: entry.sourceId,
        error_code: entry.code,
        error_message: entry.reason,
        payload: {
          file: entry.file,
          reason: entry.reason,
          record: trimRecord(entry.record),
          quarantined_at: new Date().toISOString(),
        },
      });
      if (error) throw new Error(`Quarantine write failed: ${error.message}`);
    },
  };
}

export function memoryQuarantineSink(collected: QuarantineRecord[]): QuarantineSink {
  return {
    async quarantine(entry: Omit<QuarantineRecord, 'timestamp'>): Promise<void> {
      collected.push({ ...entry, record: trimRecord(entry.record), timestamp: new Date().toISOString() });
    },
  };
}

/** Quarantine reason codes (stable, greppable). */
export const QuarantineCode = {
  MISSING_EXTERNAL_ID: 'MISSING_EXTERNAL_ID',
  UNRESOLVED_TEAM: 'UNRESOLVED_TEAM',
  UNRESOLVED_PLAYER: 'UNRESOLVED_PLAYER',
  UNRESOLVED_COMPETITION: 'UNRESOLVED_COMPETITION',
  UNRESOLVED_SEASON: 'UNRESOLVED_SEASON',
  UNRESOLVED_MATCH: 'UNRESOLVED_MATCH',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  INVALID_NUMERIC: 'INVALID_NUMERIC',
  DUPLICATE_EXTERNAL_ID: 'DUPLICATE_EXTERNAL_ID',
  DB_ERROR: 'DB_ERROR',
} as const;

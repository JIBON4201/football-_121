/**
 * Resumable import jobs on top of the existing `sync_jobs` queue table.
 *
 * One job per (phase, file): `job_type` is 'dataset-import', `entity_type`
 * carries the phase name, and the resume cursor plus extended counters live
 * in the `payload` jsonb column. No schema change required.
 */
import { serviceClient, type DbClient } from '../lib/supabase';
import { DATASET_JOB_TYPE, type DatasetFile, type DatasetPhase, type ImportJobStatus, type JobCheckpoint } from './types';

interface JobRow {
  id: string;
  status: string;
  records_processed: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  error_message: string | null;
  payload: JobCheckpoint | null;
}

export interface ImportJob extends JobRow {
  checkpoint: JobCheckpoint;
}

function toJob(row: JobRow, checkpoint: JobCheckpoint): ImportJob {
  return { ...row, checkpoint };
}

function defaultCheckpoint(phase: DatasetPhase, file: DatasetFile, init: Partial<JobCheckpoint> & { batchSize: number; dryRun: boolean; datasetDir: string; dataSource: string }): JobCheckpoint {
  const now = new Date().toISOString();
  return {
    phase,
    file,
    offset: 0,
    secondaryOffsets: {},
    lastMaxFixture: null,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    quarantined: 0,
    failed: 0,
    startedAt: now,
    updatedAt: now,
    ...init,
  };
}

export async function ensureDataSource(client: DbClient, name: string, provider: string): Promise<string> {
  const { data } = await client.from('data_sources').select('id').eq('name', name).maybeSingle();
  const existing = data as { id: string } | null;
  if (existing) return String(existing.id);
  const { data: inserted, error } = await client.from('data_sources').insert({ name, provider }).select('id');
  if (error) throw new Error(`Could not create data source '${name}': ${error.message}`);
  const id = ((inserted as Array<{ id: string }> | null) ?? [])[0]?.id;
  if (!id) throw new Error(`Could not create data source '${name}'`);
  return String(id);
}

/** Latest incomplete job for (phase, file), if any — the resume candidate. */
export async function findResumeJob(
  client: DbClient,
  dataSourceId: string,
  phase: DatasetPhase,
  file: DatasetFile,
): Promise<ImportJob | null> {
  const { data, error } = await client
    .from('sync_jobs')
    .select('id,status,records_processed,records_created,records_updated,records_failed,error_message,payload')
    .eq('data_source_id', dataSourceId)
    .eq('job_type', DATASET_JOB_TYPE)
    .eq('entity_type', phase)
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Resume lookup failed: ${error.message}`);
  const row = data as JobRow | null;
  if (!row || !row.payload || row.payload.file !== file) return null;
  return toJob(row, row.payload);
}

/** Latest completed job for (phase, file) — reruns skip it unless forced. */
export async function findCompletedJob(
  client: DbClient,
  dataSourceId: string,
  phase: DatasetPhase,
  file: DatasetFile,
): Promise<ImportJob | null> {
  const { data, error } = await client
    .from('sync_jobs')
    .select('id,status,records_processed,records_created,records_updated,records_failed,error_message,payload')
    .eq('data_source_id', dataSourceId)
    .eq('job_type', DATASET_JOB_TYPE)
    .eq('entity_type', phase)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Completed-job lookup failed: ${error.message}`);
  const row = data as JobRow | null;
  if (!row || !row.payload || row.payload.file !== file) return null;
  return toJob(row, row.payload);
}

export async function createJob(
  client: DbClient,
  dataSourceId: string,
  phase: DatasetPhase,
  file: DatasetFile,
  init: Partial<JobCheckpoint> & { batchSize: number; dryRun: boolean; datasetDir: string; dataSource: string },
): Promise<ImportJob> {
  const checkpoint = defaultCheckpoint(phase, file, init);
  const { data, error } = await client
    .from('sync_jobs')
    .insert({
      data_source_id: dataSourceId,
      job_type: DATASET_JOB_TYPE,
      entity_type: phase,
      status: 'running',
      records_processed: 0,
      records_created: 0,
      records_updated: 0,
      records_failed: 0,
      payload: checkpoint,
    })
    .select('id,status,records_processed,records_created,records_updated,records_failed,error_message,payload');
  if (error) throw new Error(`Could not create import job: ${error.message}`);
  const row = ((data as JobRow[] | null) ?? [])[0];
  if (!row) throw new Error('Could not create import job');
  return toJob(row, checkpoint);
}

export async function markJobRunning(client: DbClient, jobId: string): Promise<void> {
  const { error } = await client.from('sync_jobs').update({ status: 'running' }).eq('id', jobId);
  if (error) throw new Error(`Could not mark job running: ${error.message}`);
}

/** Persist a batch checkpoint. The offset advances only after the batch commits. */
export async function checkpointJob(client: DbClient, jobId: string, checkpoint: JobCheckpoint): Promise<void> {
  const { error } = await client
    .from('sync_jobs')
    .update({
      records_processed: checkpoint.processed,
      records_created: checkpoint.created,
      records_updated: checkpoint.updated,
      records_failed: checkpoint.failed + checkpoint.quarantined,
      error_message: checkpoint.lastError ?? null,
      payload: checkpoint,
    })
    .eq('id', jobId);
  if (error) throw new Error(`Checkpoint failed for job ${jobId}: ${error.message}`);
}

export async function finishJob(client: DbClient, jobId: string, checkpoint: JobCheckpoint, status: ImportJobStatus): Promise<void> {
  const { error } = await client
    .from('sync_jobs')
    .update({
      status,
      records_processed: checkpoint.processed,
      records_created: checkpoint.created,
      records_updated: checkpoint.updated,
      records_failed: checkpoint.failed + checkpoint.quarantined,
      completed_at: new Date().toISOString(),
      error_message: checkpoint.lastError ?? null,
      payload: checkpoint,
    })
    .eq('id', jobId);
  if (error) throw new Error(`Could not finish job ${jobId}: ${error.message}`);
}

export function serviceDb(): DbClient {
  return serviceClient();
}

/**
 * Dataset import orchestration: phase order, batching, checkpoints, logging.
 *
 * Atomicity unit is one batch: the job cursor advances only after the whole
 * batch (transform + validate + persist) succeeds. A crashed or failed batch
 * replays from the stored offset, and every persist path is idempotent
 * (update-on-natural-key), so replays converge instead of duplicating.
 *
 * Supabase/PostgREST exposes no multi-statement transactions to this client,
 * so "batch transaction" here means checkpoint-after-commit, stated honestly.
 */
import { serviceClient, type DbClient } from '../lib/supabase';
import type { PersistContext } from '../providers/persist';
import { MappingCache } from './mappings';
import {
  alignFixtureBatch,
  toFixtureRows,
  type FixtureGroup,
} from './merge';
import {
  applyLineup,
  applyMatch,
  buildPlayerStatDto,
  buildTeamStatDto,
  emptyCounters,
  PLAYER_STAT_COMPARE,
  prepareLineupPlayers,
  prepareMatch,
  processCompetitions,
  processCountries,
  processPlayers,
  processSeasons,
  processTeamCompetitions,
  processTeams,
  TEAM_STAT_COMPARE,
  warmEntity,
  type Counters,
  type PhaseContext,
} from './phases';
import { persistPlayerStats, persistTeamStats } from '../providers/persist';
import { shallowEqual, toFloat, toInt } from './normalize';
import { dbQuarantineSink, memoryQuarantineSink, QuarantineCode, type QuarantineSink } from './quarantine';
import { countRows, iterateChunks, readChunk, type DatasetRow } from './reader';
import {
  checkpointJob,
  createJob,
  ensureDataSource,
  findCompletedJob,
  findResumeJob,
  finishJob,
  markJobRunning,
  type ImportJob,
} from './jobs';
import {
  DATASET_JOB_TYPE,
  DATASET_PHASES,
  DATASET_SOURCE_NAME,
  DATASET_SOURCE_PROVIDER,
  DATASET_WRITABLE_TABLES,
  PHASE_FILES,
  SKIPPED_FILES,
  type BatchReport,
  type DatasetFile,
  type DatasetPhase,
  type ImportReport,
  type JobCheckpoint,
  type PhaseReport,
  type QuarantineRecord,
} from './types';

export interface RunnerOptions {
  datasetDir: string;
  phases: DatasetPhase[];
  batchSize: number;
  limit?: number;
  concurrency: number;
  live: boolean;
  allowProduction: boolean;
  force: boolean;
  json: boolean;
  onBatch?: (report: BatchReport) => void;
}

export interface RunnerResult {
  report: ImportReport;
  quarantined: QuarantineRecord[];
  exitCode: number;
}

function datasetPath(dir: string, file: DatasetFile): string {
  return `${dir}/${file}.parquet`;
}

function now(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${now()}] ${message}`);
}

/** Tables each phase may write (subset of DATASET_WRITABLE_TABLES by construction). */
const PHASE_TABLES: Record<DatasetPhase, string[]> = {
  reference: ['countries', 'competitions', 'seasons', 'teams', 'players', 'external_entity_ids', 'data_sources'],
  relationships: ['team_competitions'],
  matches: ['matches', 'external_entity_ids'],
  lineups: ['match_lineups', 'match_lineup_players'],
  'team-stats': ['match_team_statistics'],
  'player-stats': ['match_player_statistics'],
};

export function assertPhaseTables(): void {
  const allowed = new Set<string>(DATASET_WRITABLE_TABLES);
  for (const [phase, tables] of Object.entries(PHASE_TABLES)) {
    for (const table of tables) {
      if (!allowed.has(table)) throw new Error(`Phase ${phase} targets non-allowlisted table '${table}'`);
    }
  }
}

async function pool<T>(items: T[], size: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  const workers = Math.max(1, Math.min(size, items.length));
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
}

interface BatchAccumulator {
  counters: Counters;
}

async function guardedRecord(acc: BatchAccumulator, ctx: PhaseContext, sourceId: string, entityType: string, record: RowLike, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    acc.counters.failed += 1;
    acc.counters.quarantined += 1;
    await ctx.sink.quarantine({
      file: ctx.file,
      entityType,
      sourceId,
      code: QuarantineCode.DB_ERROR,
      reason: error instanceof Error ? error.message.slice(0, 500) : 'unknown error',
      record: record as Record<string, unknown>,
    });
  }
}

type RowLike = Record<string, unknown>;

function makePhaseContext(
  client: DbClient,
  dataSourceId: string,
  opts: { dryRun: boolean; file: DatasetFile; phase: DatasetPhase },
  sink: QuarantineSink,
  acc: BatchAccumulator,
  mappings: MappingCache,
): PhaseContext {
  return {
    client,
    dataSourceId,
    dryRun: opts.dryRun,
    file: opts.file,
    phase: opts.phase,
    sink,
    mappings,
    persist: { client, dataSourceId, prefetch: new Map() },
    counters: acc.counters,
  };
}

export async function runDatasetImport(client: DbClient, options: RunnerOptions): Promise<RunnerResult> {
  const started = Date.now();
  const dryRun = !options.live;
  if (!options.live) log('dry-run mode: no database writes (pass --live to write)');
  assertPhaseTables();

  // Safety: dataset layout check before anything else.
  const { existsSync } = await import('node:fs');
  if (!existsSync(options.datasetDir)) throw new Error(`Dataset directory not found: ${options.datasetDir}`);
  for (const phase of options.phases) {
    for (const file of PHASE_FILES[phase]) {
      if (SKIPPED_FILES.includes(file)) continue;
      if (!existsSync(datasetPath(options.datasetDir, file))) {
        throw new Error(`Dataset file missing for phase '${phase}': ${datasetPath(options.datasetDir, file)}`);
      }
    }
  }

  const dataSourceId = dryRun ? 'dry-run' : await ensureDataSource(client, DATASET_SOURCE_NAME, DATASET_SOURCE_PROVIDER);
  const quarantined: QuarantineRecord[] = [];
  const sink: QuarantineSink = dryRun ? memoryQuarantineSink(quarantined) : null as unknown as QuarantineSink;
  const phaseReports: PhaseReport[] = [];
  // One mapping cache for the whole run: dry-run placeholders from the reference
  // phase must stay visible to relationships/matches, and warm ids stay warm.
  const mappings = new MappingCache();

  const ordered = DATASET_PHASES.filter((phase) => options.phases.includes(phase));
  for (const phase of ordered) {
    const report = await runPhase(client, dataSourceId, phase, options, dryRun, sink, quarantined, mappings);
    phaseReports.push(report);
    if (report.status === 'failed' && options.live) break;
  }

  const report: ImportReport = { dryRun, phases: phaseReports, durationMs: Date.now() - started };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    log(`import ${dryRun ? '(dry-run) ' : ''}done in ${report.durationMs}ms`);
    for (const phase of phaseReports) {
      log(
        `  ${phase.phase}: ${phase.status} processed=${phase.processed} created=${phase.created} ` +
          `updated=${phase.updated} skipped=${phase.skipped} quarantined=${phase.quarantined} failed=${phase.failed}`,
      );
    }
  }
  const failed = phaseReports.some((p) => p.status === 'failed');
  return { report, quarantined, exitCode: failed ? 1 : 0 };
}

async function runPhase(
  client: DbClient,
  dataSourceId: string,
  phase: DatasetPhase,
  options: RunnerOptions,
  dryRun: boolean,
  sharedSink: QuarantineSink,
  sharedQuarantined: QuarantineRecord[],
  sharedMappings: MappingCache,
): Promise<PhaseReport> {
  const totals: Counters = emptyCounters();
  let processed = 0;
  let status: PhaseReport['status'] = 'completed';
  // Reference + relationships run as a single job (several small files plus
  // derived scans); the merge phases run one job per primary file.
  if (phase === 'reference' || phase === 'relationships') {
    const file = phase === 'reference' ? 'leagues' : 'fixtures';
    try {
      const result = await runSingleFileJob(client, dataSourceId, phase, file, options, dryRun, sharedSink, sharedMappings, async (ctx, checkpoint, jobId) => {
        if (phase === 'reference') return runReference(ctx, options, checkpoint, jobId);
        return runRelationships(ctx, options, checkpoint, jobId);
      });
      processed += result.processed;
      for (const key of ['created', 'updated', 'skipped', 'quarantined', 'failed'] as const) totals[key] += result[key];
      status = result.status;
    } catch (error) {
      status = 'failed';
      log(`phase ${phase} aborted: ${error instanceof Error ? error.message : error}`);
    }
    return { phase, files: PHASE_FILES[phase], processed, ...totals, status };
  }
  for (const file of PHASE_FILES[phase]) {
    if (SKIPPED_FILES.includes(file)) {
      log(`phase ${phase}: skipping ${file} (no destination table)`);
      continue;
    }
    try {
      const fileResult = await runPhaseFile(client, dataSourceId, phase, file, options, dryRun, sharedSink, sharedQuarantined, sharedMappings);
      processed += fileResult.processed;
      for (const key of ['created', 'updated', 'skipped', 'quarantined', 'failed'] as const) totals[key] += fileResult[key];
      if (fileResult.status === 'failed') {
        status = 'failed';
        break;
      }
      if (fileResult.quarantined > 0 || fileResult.failed > 0) status = 'partial';
    } catch (error) {
      status = 'failed';
      log(`phase ${phase} file ${file} aborted: ${error instanceof Error ? error.message : error}`);
      break;
    }
  }
  return { phase, files: PHASE_FILES[phase], processed, ...totals, status };
}

/** Single-job wrapper shared by reference/relationships (stage-tracked via offset). */
async function runSingleFileJob(
  client: DbClient,
  dataSourceId: string,
  phase: DatasetPhase,
  file: DatasetFile,
  options: RunnerOptions,
dryRun: boolean,
  sharedSink: QuarantineSink,
  sharedMappings: MappingCache,
  run: (ctx: PhaseContext, checkpoint: JobCheckpoint, jobId: string) => Promise<number>,
): Promise<Counters & { processed: number; status: 'completed' | 'partial' | 'failed' }> {
  const acc: Counters = emptyCounters();
  let processed = 0;
  let job: ImportJob | null = null;
  let sink: QuarantineSink = sharedSink;

  const checkout = async (): Promise<{ checkpoint: JobCheckpoint; jobId: string }> => {
    if (dryRun) {
      return {
        jobId: 'dry-run',
        checkpoint: {
          phase, file, offset: 0, secondaryOffsets: {}, lastMaxFixture: null,
          batchSize: options.batchSize, processed: 0, created: 0, updated: 0,
          skipped: 0, quarantined: 0, failed: 0, dryRun: true,
          datasetDir: options.datasetDir, dataSource: dataSourceId,
          startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      };
    }
    if (!options.force) {
      const completed = await findCompletedJob(client, dataSourceId, phase, file);
      if (completed) {
        log(`phase ${phase}: already complete (job ${completed.id}); use --force to reprocess`);
        return { jobId: completed.id, checkpoint: { ...completed.checkpoint, offset: -1 } };
      }
      job = await findResumeJob(client, dataSourceId, phase, file);
      if (job) {
        log(`phase ${phase}: resuming job ${job.id} at stage ${job.checkpoint.offset}`);
        await markJobRunning(client, job.id);
        sink = dbQuarantineSink(client, job.id);
        return { jobId: job.id, checkpoint: { ...job.checkpoint, batchSize: options.batchSize, updatedAt: new Date().toISOString() } };
      }
    }
    job = await createJob(client, dataSourceId, phase, file, {
      batchSize: options.batchSize,
      dryRun: false,
      datasetDir: options.datasetDir,
      dataSource: dataSourceId,
    });
    sink = dbQuarantineSink(client, job.id);
    log(`phase ${phase}: started job ${job.id}`);
    return { jobId: job.id, checkpoint: job.checkpoint };
  };

  const { jobId, checkpoint } = await checkout();
  if (checkpoint.offset === -1) return { ...emptyCounters(), processed: 0, status: 'completed' };
  const ctx = makePhaseContext(client, dataSourceId, { dryRun, file, phase }, sink, { counters: acc }, sharedMappings);
  try {
    processed = await run(ctx, checkpoint, jobId);
    Object.assign(checkpoint, {
      processed: checkpoint.processed + processed,
      created: checkpoint.created + acc.created,
      updated: checkpoint.updated + acc.updated,
      skipped: checkpoint.skipped + acc.skipped,
      quarantined: checkpoint.quarantined + acc.quarantined,
      failed: checkpoint.failed + acc.failed,
      updatedAt: new Date().toISOString(),
    });
    if (!dryRun && job) {
      await checkpointJob(client, jobId, checkpoint);
      await finishJob(client, jobId, checkpoint, acc.quarantined + acc.failed > 0 ? 'partial' : 'completed');
    }
    return { ...acc, processed, status: 'completed' };
  } catch (error) {
    checkpoint.lastError = error instanceof Error ? error.message.slice(0, 500) : String(error);
    if (!dryRun && job) {
      await checkpointJob(client, jobId, checkpoint).catch(() => undefined);
      await finishJob(client, jobId, checkpoint, 'failed').catch(() => undefined);
    }
    throw error;
  }
}

async function runPhaseFile(
  client: DbClient,
  dataSourceId: string,
  phase: DatasetPhase,
  file: DatasetFile,
  options: RunnerOptions,
  dryRun: boolean,
  sharedSink: QuarantineSink,
  sharedQuarantined: QuarantineRecord[],
  sharedMappings: MappingCache,
): Promise<Counters & { processed: number; status: 'completed' | 'partial' | 'failed' }> {
  const acc: Counters = emptyCounters();
  let processed = 0;
  let job: ImportJob | null = null;
  let sink: QuarantineSink = sharedSink;

  const checkoutJob = async (): Promise<{ checkpoint: JobCheckpoint; jobId: string }> => {
    if (dryRun) {
      return {
        jobId: 'dry-run',
        checkpoint: {
          phase, file, offset: 0, secondaryOffsets: {}, lastMaxFixture: null,
          batchSize: options.batchSize, processed: 0, created: 0, updated: 0,
          skipped: 0, quarantined: 0, failed: 0, dryRun: true,
          datasetDir: options.datasetDir, dataSource: dataSourceId,
          startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      };
    }
    if (!options.force) {
      const completed = await findCompletedJob(client, dataSourceId, phase, file);
      if (completed) {
        log(`phase ${phase} file ${file}: already complete (job ${completed.id}); use --force to reprocess`);
        // Count as skipped without reading: idempotent no-op path.
        return { jobId: completed.id, checkpoint: { ...completed.checkpoint, offset: -1 } };
      }
      job = await findResumeJob(client, dataSourceId, phase, file);
      if (job) {
        log(`phase ${phase} file ${file}: resuming job ${job.id} at offset ${job.checkpoint.offset}`);
        await markJobRunning(client, job.id);
        sink = dbQuarantineSink(client, job.id);
        return { jobId: job.id, checkpoint: { ...job.checkpoint, batchSize: options.batchSize, updatedAt: new Date().toISOString() } };
      }
    }
    job = await createJob(client, dataSourceId, phase, file, {
      batchSize: options.batchSize,
      dryRun: false,
      datasetDir: options.datasetDir,
      dataSource: dataSourceId,
    });
    sink = dbQuarantineSink(client, job.id);
    log(`phase ${phase} file ${file}: started job ${job.id}`);
    return { jobId: job.id, checkpoint: job.checkpoint };
  };

  const { jobId, checkpoint } = await checkoutJob();
  if (checkpoint.offset === -1) {
    return { ...emptyCounters(), processed: 0, status: 'completed' };
  }
  const ctx = makePhaseContext(client, dataSourceId, { dryRun, file, phase }, sink, { counters: acc }, sharedMappings);
  void sharedQuarantined;

  try {
    if (phase === 'reference') {
      processed = await runReference(ctx, options, checkpoint, jobId);
    } else if (phase === 'relationships') {
      processed = await runRelationships(ctx, options, checkpoint, jobId);
    } else {
      processed = await runMergePhase(ctx, options, checkpoint, jobId, phase, file);
    }
    Object.assign(checkpoint, {
      processed: checkpoint.processed + processed,
      created: checkpoint.created + acc.created,
      updated: checkpoint.updated + acc.updated,
      skipped: checkpoint.skipped + acc.skipped,
      quarantined: checkpoint.quarantined + acc.quarantined,
      failed: checkpoint.failed + acc.failed,
      updatedAt: new Date().toISOString(),
    });
    if (!dryRun && job) {
      await checkpointJob(client, jobId, checkpoint);
      await finishJob(client, jobId, checkpoint, acc.quarantined + acc.failed > 0 ? 'partial' : 'completed');
    }
    return { ...acc, processed, status: 'completed' };
  } catch (error) {
    checkpoint.lastError = error instanceof Error ? error.message.slice(0, 500) : String(error);
    if (!dryRun && job) {
      await checkpointJob(client, jobId, checkpoint).catch(() => undefined);
      await finishJob(client, jobId, checkpoint, 'failed').catch(() => undefined);
    }
    throw error;
  }
}

/* ── Reference + relationships (small files / derived scans) ─────── */

/** Persist the running checkpoint (offsets are maintained by the caller). */
async function persistProgress(ctx: PhaseContext, checkpoint: JobCheckpoint, jobId: string): Promise<void> {
  if (ctx.dryRun || jobId === 'dry-run') return;
  await checkpointJob(ctx.client, jobId, {
    ...checkpoint,
    processed: checkpoint.processed,
    created: checkpoint.created + ctx.counters.created,
    updated: checkpoint.updated + ctx.counters.updated,
    skipped: checkpoint.skipped + ctx.counters.skipped,
    quarantined: checkpoint.quarantined + ctx.counters.quarantined,
    failed: checkpoint.failed + ctx.counters.failed,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Reference stages (checkpoint.offset = next stage index):
 * 0 countries+competitions, 1 seasons, 2 teams, 3 players.
 */
async function runReference(
  ctx: PhaseContext,
  options: RunnerOptions,
  checkpoint: JobCheckpoint,
  jobId: string,
): Promise<number> {
  const dir = options.datasetDir;
  const limit = options.limit;
  let processed = 0;
  const stage = checkpoint.offset ?? 0;

  if (stage <= 0) {
    // Countries from leagues file (271 rows, single read).
    const leagueRows = await readChunk(datasetPath(dir, 'leagues'), { rowStart: 0, rowEnd: limit ?? Number.MAX_SAFE_INTEGER });
    processed += leagueRows.length;
    await processCountries(ctx, leagueRows.map((r) => r.country).filter((v): v is string => typeof v === 'string'));
    // Catalogue for competition types (1,235 rows, single read).
    const catRows = await readChunk(datasetPath(dir, 'league_catalogue'), { rowStart: 0, rowEnd: Number.MAX_SAFE_INTEGER });
    const byApi = new Map<number, { apiId: number | null; datasetLeagueId: number | null; type: string | null }>();
    const byDataset = new Map<number, { apiId: number | null; datasetLeagueId: number | null; type: string | null }>();
    for (const r of catRows) {
      const entry = {
        apiId: typeof r.af_league_id === 'number' ? r.af_league_id : null,
        datasetLeagueId: typeof r.dataset_league_id === 'number' ? r.dataset_league_id : null,
        type: typeof r.af_type === 'string' ? r.af_type : null,
      };
      if (entry.apiId !== null) byApi.set(entry.apiId, entry);
      if (entry.datasetLeagueId !== null) byDataset.set(entry.datasetLeagueId, entry);
    }
    await processCompetitions(ctx, leagueRows, byApi, byDataset);
    checkpoint.offset = 1;
    await persistProgress(ctx, checkpoint, jobId);
  }
  if ((checkpoint.offset ?? 0) <= 1) {
    // Seasons: distinct (league, year) scan over fixtures (3 narrow columns).
    const pairs = await scanFixtureSeasons(dir, limit);
    await processSeasons(ctx, pairs);
    checkpoint.offset = 2;
    await persistProgress(ctx, checkpoint, jobId);
  }
  if ((checkpoint.offset ?? 0) <= 2) {
    const teamTotal = await countRows(datasetPath(dir, 'teams'));
    const teamEnd = limit !== undefined ? Math.min(teamTotal, limit) : teamTotal;
    for (let offset = 0; offset < teamEnd; offset += checkpoint.batchSize) {
      const rows = await readChunk(datasetPath(dir, 'teams'), {
        rowStart: offset,
        rowEnd: Math.min(offset + checkpoint.batchSize, teamEnd),
      });
      if (rows.length === 0) break;
      await pool(rows, options.concurrency, async (row) => {
        await processTeams(ctx, [row]);
      });
      processed += rows.length;
      checkpoint.offset = 2;
      await persistProgress(ctx, checkpoint, jobId);
    }
    checkpoint.offset = 3;
    await persistProgress(ctx, checkpoint, jobId);
  }
  if ((checkpoint.offset ?? 0) <= 3) {
    const playerTotal = await countRows(datasetPath(dir, 'players'));
    const playerEnd = limit !== undefined ? Math.min(playerTotal, limit) : playerTotal;
    for (let offset = 0; offset < playerEnd; offset += checkpoint.batchSize) {
      const rows = await readChunk(datasetPath(dir, 'players'), {
        rowStart: offset,
        rowEnd: Math.min(offset + checkpoint.batchSize, playerEnd),
      });
      if (rows.length === 0) break;
      await pool(rows, options.concurrency, async (row) => {
        await processPlayers(ctx, [row]);
      });
      processed += rows.length;
      checkpoint.offset = 3;
      await persistProgress(ctx, checkpoint, jobId);
    }
    checkpoint.offset = 4;
    await persistProgress(ctx, checkpoint, jobId);
  }
  return processed;
}

/** Relationships: distinct (team, league, year) triples from a fixtures scan. */
async function runRelationships(
  ctx: PhaseContext,
  options: RunnerOptions,
  checkpoint: JobCheckpoint,
  jobId: string,
): Promise<number> {
  let processed = 0;
  if ((checkpoint.offset ?? 0) > 0) return processed;
  const triples = await scanFixtureTriples(options.datasetDir, options.limit);
  // Triples are processed in slices to keep mapping warm sets bounded.
  for (let i = 0; i < triples.length; i += checkpoint.batchSize) {
    const slice = triples.slice(i, i + checkpoint.batchSize);
    await warmEntity(ctx, 'team', slice.map((t) => t.teamDatasetId));
    await warmEntity(ctx, 'competition', slice.map((t) => t.leagueDatasetId));
    await warmEntity(ctx, 'season', slice.map((t) => `season:${t.leagueDatasetId}:${t.year}`));
    await processTeamCompetitions(ctx, slice);
    processed += slice.length;
    await persistProgress(ctx, checkpoint, jobId);
  }
  checkpoint.offset = 1;
  await persistProgress(ctx, checkpoint, jobId);
  return processed;
}

/** Distinct (league_id, calendar_year) pairs from the fixtures file. */
async function scanFixtureSeasons(dir: string, limit?: number): Promise<Array<{ leagueDatasetId: string; year: number }>> {
  const total = await countRows(datasetPath(dir, 'fixtures'));
  const seen = new Set<string>();
  const out: Array<{ leagueDatasetId: string; year: number }> = [];
  const end = limit !== undefined ? Math.min(total, limit) : total;
  for await (const { rows } of iterateChunks(datasetPath(dir, 'fixtures'), {
    columns: ['league_id', 'calendar_year'],
    chunkSize: 20000,
    startOffset: 0,
    total: end,
  })) {
    for (const row of rows) {
      const league = row.league_id === null || row.league_id === undefined ? null : String(row.league_id);
      const year = typeof row.calendar_year === 'number' ? row.calendar_year : null;
      if (!league || year === null) continue;
      const key = `${league}|${year}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ leagueDatasetId: league, year });
      }
    }
  }
  return out;
}

/** Distinct (team, league, year) triples from the fixtures file. */
async function scanFixtureTriples(
  dir: string,
  limit?: number,
): Promise<Array<{ teamDatasetId: string; leagueDatasetId: string; year: number }>> {
  const total = await countRows(datasetPath(dir, 'fixtures'));
  const seen = new Set<string>();
  const out: Array<{ teamDatasetId: string; leagueDatasetId: string; year: number }> = [];
  const end = limit !== undefined ? Math.min(total, limit) : total;
  for await (const { rows } of iterateChunks(datasetPath(dir, 'fixtures'), {
    columns: ['league_id', 'home_team_id', 'away_team_id', 'calendar_year'],
    chunkSize: 20000,
    startOffset: 0,
    total: end,
  })) {
    for (const row of rows) {
      const league = row.league_id === null || row.league_id === undefined ? null : String(row.league_id);
      const year = typeof row.calendar_year === 'number' ? row.calendar_year : null;
      if (!league || year === null) continue;
      for (const team of [row.home_team_id, row.away_team_id]) {
        if (team === null || team === undefined) continue;
        const key = `${String(team)}|${league}|${year}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ teamDatasetId: String(team), leagueDatasetId: league, year });
        }
      }
    }
  }
  return out;
}

/* ── Fixture-merge phases (matches, lineups, team-stats, player-stats) ─ */

const MERGE_CONFIG: Record<string, { primary: DatasetFile; primaryColumns: string[]; secondary?: DatasetFile; secondaryColumns?: string[]; shells?: boolean }> = {
  matches: {
    primary: 'fixtures',
    primaryColumns: ['id', 'league_id', 'home_team_id', 'away_team_id', 'date_utc', 'goals_home', 'goals_away', 'status', 'status_norm', 'referee_name'],
    secondary: 'match_stats',
    secondaryColumns: ['fixture_id', 'home_goals_ht', 'away_goals_ht'],
  },
  lineups: {
    primary: 'fixture_lineups',
    primaryColumns: [
      'fixture_id', 'team_id', 'player_id', 'position', 'starter', 'shirt_number',
      'minutes_played', 'match_rating', 'captain',
    ],
    secondary: 'fixture_players',
    secondaryColumns: ['id', 'fixture_id', 'team_id', 'player_id', 'position'],
    shells: true,
  },
  'team-stats': {
    primary: 'match_stats',
    primaryColumns: [
      'fixture_id', 'team_id', 'xg', 'xg_for', 'xg_against', 'shots_total', 'shots_on',
      'shots_off', 'shots_blocked', 'corners', 'fouls', 'offsides', 'passes',
      'passes_completed', 'tackles', 'interceptions', 'saves',
    ],
    secondary: 'fixtures',
    secondaryColumns: ['id', 'home_team_id', 'away_team_id', 'date_utc', 'status'],
  },
  'player-stats': {
    primary: 'fixture_players_stats_flat',
    primaryColumns: [
      'fixture_player_id', 'fixture_id', 'team_id', 'player_id', 'minutes_played',
      'goals', 'assists', 'shots_total', 'shots_on', 'shots_off', 'passes',
      'passes_completed', 'tackles', 'interceptions', 'key_passes',
      'rating', 'position',
    ],
    secondary: 'fixture_players',
    secondaryColumns: ['id', 'fixture_id', 'team_id'],
  },
};

async function runMergePhase(
  ctx: PhaseContext,
  options: RunnerOptions,
  checkpoint: JobCheckpoint,
  jobId: string,
  phase: DatasetPhase,
  file: DatasetFile,
): Promise<number> {
  const config = MERGE_CONFIG[phase];
  const dir = options.datasetDir;
  const primaryTotal = await countRows(datasetPath(dir, config.primary));
  const limit = options.limit;
  const primaryEnd = limit !== undefined ? Math.min(primaryTotal, (checkpoint.offset ?? 0) + limit) : primaryTotal;
  let primaryOffset = checkpoint.offset ?? 0;
  let secondaryOffset = checkpoint.secondaryOffsets[config.secondary ?? ''] ?? 0;
  let prevMaxFixture = checkpoint.lastMaxFixture;
  let processed = 0;
  let batch = 0;

  const secondaryTotal = config.secondary ? await countRows(datasetPath(dir, config.secondary as DatasetFile)) : 0;

  while (primaryOffset < primaryEnd) {
    const primaryRows = await readChunk(datasetPath(dir, config.primary), {
      columns: config.primaryColumns,
      rowStart: primaryOffset,
      rowEnd: Math.min(primaryOffset + checkpoint.batchSize, primaryEnd),
    });
    if (primaryRows.length === 0) break;

    // Read secondary forward until past the primary window's max fixture.
    let secondaryRows: DatasetRow[] = [];
    if (config.secondary) {
      const primaryFixtures = primaryRows.map((r) => r.fixture_id).filter((v) => v !== null && v !== undefined).map(String);
      const maxPrimary = primaryFixtures.length > 0 ? primaryFixtures.reduce((a, b) => (compareIds(a, b) > 0 ? a : b)) : null;
      let cursor = secondaryOffset;
      const collected: DatasetRow[] = [];
      while (cursor < secondaryTotal) {
        const window = await readChunk(datasetPath(dir, config.secondary as DatasetFile), {
          columns: config.secondaryColumns,
          rowStart: cursor,
          rowEnd: cursor + 5000,
        });
        if (window.length === 0) {
          cursor = secondaryTotal;
          break;
        }
        collected.push(...window);
        cursor += window.length;
        const lastFixture = window[window.length - 1].fixture_id;
        if (maxPrimary === null || (lastFixture !== null && lastFixture !== undefined && compareIds(String(lastFixture), maxPrimary) > 0)) break;
        if (window.length < 5000) {
          cursor = secondaryTotal;
          break;
        }
      }
      secondaryRows = collected;
    }

    const aligned = alignFixtureBatch(
      toFixtureRows(primaryRows, fixtureIdColumnFor(config.primary, phase)),
      primaryOffset,
      toFixtureRows(secondaryRows, 'fixture_id'),
      secondaryOffset,
      prevMaxFixture,
      config.shells === true,
    );

    await warmBatchMappings(ctx, phase, aligned.groups);
    const acc = { counters: ctx.counters };
    await pool(aligned.groups, options.concurrency, async (group) => {
      await guardedRecord(acc, ctx, group.fixtureId, groupEntityType(phase), group as unknown as Record<string, unknown>, async () => {
        await processFixtureGroup(ctx, phase, group);
      });
      processed += 0;
    });
    const groupCount = aligned.groups.length;
    processed += groupCount;

    primaryOffset = aligned.nextPrimaryOffset;
    if (config.secondary) secondaryOffset = aligned.nextSecondaryOffset;
    prevMaxFixture = aligned.maxFixture ?? prevMaxFixture;
    batch += 1;
    Object.assign(checkpoint, {
      offset: primaryOffset,
      secondaryOffsets: config.secondary ? { ...checkpoint.secondaryOffsets, [config.secondary]: secondaryOffset } : checkpoint.secondaryOffsets,
      lastMaxFixture: prevMaxFixture,
      updatedAt: new Date().toISOString(),
    });
    if (!ctx.dryRun && jobId !== 'dry-run') {
      await checkpointJob(ctx.client, jobId, {
        ...checkpoint,
        processed: checkpoint.processed + processed,
        created: checkpoint.created + ctx.counters.created,
        updated: checkpoint.updated + ctx.counters.updated,
        skipped: checkpoint.skipped + ctx.counters.skipped,
        quarantined: checkpoint.quarantined + ctx.counters.quarantined,
        failed: checkpoint.failed + ctx.counters.failed,
      });
    }
    const elapsed = 0;
    void elapsed;
    log(
      `job ${jobId} ${phase}/${file} batch ${batch}: offset=${primaryOffset}/${primaryEnd} ` +
        `groups=${groupCount} created=${ctx.counters.created} updated=${ctx.counters.updated} ` +
        `skipped=${ctx.counters.skipped} quarantined=${ctx.counters.quarantined} failed=${ctx.counters.failed}`,
    );
    if (options.onBatch) {
      options.onBatch({
        jobId, phase, file, batch, offset: primaryOffset, rows: groupCount,
        created: ctx.counters.created, updated: ctx.counters.updated, skipped: ctx.counters.skipped,
        quarantined: ctx.counters.quarantined, failed: ctx.counters.failed, elapsedMs: 0,
      });
    }
    if (primaryRows.length === 0) break;
  }
  void file;
  return processed;
}

function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isSafeInteger(na) && Number.isSafeInteger(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Which column carries the fixture id in each primary file. */
function fixtureIdColumnFor(primary: DatasetFile, _phase: DatasetPhase): string {
  void _phase;
  if (primary === 'fixtures') return 'id';
  return 'fixture_id';
}

function groupEntityType(phase: DatasetPhase): string {
  switch (phase) {
    case 'matches':
      return 'match';
    case 'lineups':
      return 'match_lineup';
    case 'team-stats':
      return 'match_team_stat';
    case 'player-stats':
      return 'match_player_stat';
    default:
      return phase;
  }
}

async function warmBatchMappings(ctx: PhaseContext, phase: DatasetPhase, groups: { fixtureId: string; primary: Record<string, unknown>[]; secondary: Record<string, unknown>[] }[]): Promise<void> {
  if (phase === 'matches') {
    const compIds: string[] = [];
    const teamIds: string[] = [];
    for (const group of groups) {
      for (const row of group.primary) {
        if (row.league_id !== null && row.league_id !== undefined) compIds.push(String(row.league_id));
        if (row.home_team_id !== null && row.home_team_id !== undefined) teamIds.push(String(row.home_team_id));
        if (row.away_team_id !== null && row.away_team_id !== undefined) teamIds.push(String(row.away_team_id));
      }
    }
    await warmEntity(ctx, 'competition', compIds);
    await warmEntity(ctx, 'team', teamIds);
    // Seasons share the competition+year scheme; warm the exact keys used.
    const seasonKeys: string[] = [];
    for (const group of groups) {
      for (const row of group.primary) {
        const year = typeof row.date_utc === 'string' ? new Date(row.date_utc).getUTCFullYear() : NaN;
        if (row.league_id !== null && row.league_id !== undefined && Number.isInteger(year)) {
          seasonKeys.push(`season:${String(row.league_id)}:${year}`);
        }
      }
    }
    await warmEntity(ctx, 'season', seasonKeys);
    await warmEntity(ctx, 'match', groups.map((g) => g.fixtureId));
  } else if (phase === 'lineups' || phase === 'player-stats') {
    const playerIds: string[] = [];
    const teamIds: string[] = [];
    for (const group of groups) {
      for (const row of group.secondary) {
        if (row.player_id !== null && row.player_id !== undefined) playerIds.push(String(row.player_id));
        if (row.team_id !== null && row.team_id !== undefined) teamIds.push(String(row.team_id));
      }
      for (const row of group.primary) {
        const p = (row as Record<string, unknown>).player_id;
        if (p !== null && p !== undefined) playerIds.push(String(p));
      }
    }
    await warmEntity(ctx, 'player', playerIds);
    await warmEntity(ctx, 'team', teamIds);
    await warmEntity(ctx, 'match', groups.map((g) => g.fixtureId));
  } else if (phase === 'team-stats') {
    await warmEntity(ctx, 'match', groups.map((g) => g.fixtureId));
  }
}

async function processFixtureGroup(
  ctx: PhaseContext,
  phase: DatasetPhase,
  group: { fixtureId: string; primary: Record<string, unknown>[]; secondary: Record<string, unknown>[]; shellOnly: boolean },
): Promise<void> {
  if (phase === 'matches') {
    const row = group.primary[0] as DatasetRow;
    const statsRow = group.secondary[0] as DatasetRow | undefined;
    const halfTime = {
      home: statsRow ? toInt(statsRow.home_goals_ht, 0, 99) : null,
      away: statsRow ? toInt(statsRow.away_goals_ht, 0, 99) : null,
    };
    const prepared = await prepareMatch(ctx, row, halfTime);
    if (prepared.action === 'quarantine') {
      ctx.counters.quarantined += 1;
      await ctx.sink.quarantine({
        file: ctx.file, entityType: 'match', sourceId: String((row as Row).id ?? group.fixtureId),
        code: prepared.code ?? QuarantineCode.DB_ERROR, reason: prepared.reason ?? 'unclassified',
        record: row as Row,
      });
      return;
    }
    if (prepared.action === 'skip') {
      ctx.counters.skipped += 1;
      return;
    }
    if (!prepared.prepared) return;
    if (ctx.dryRun) {
      ctx.counters[prepared.action === 'create' ? 'created' : 'updated'] += 1;
      return;
    }
    const status = await applyMatch(ctx, prepared.prepared);
    ctx.counters[status === 'created' ? 'created' : 'updated'] += 1;
    return;
  }
  if (phase === 'lineups') {
    const matchId = ctx.mappings.get('match', group.fixtureId);
    if (!matchId) {
      ctx.counters.quarantined += 1;
      await ctx.sink.quarantine({
        file: ctx.file, entityType: 'match_lineup', sourceId: group.fixtureId,
        code: QuarantineCode.UNRESOLVED_MATCH, reason: `match ${group.fixtureId} not imported`,
        record: { fixture_id: group.fixtureId },
      });
      return;
    }
    // Group secondary (fixture_players) rows by team.
    const byTeam = new Map<string, DatasetRow[]>();
    for (const prow of group.secondary) {
      const team = prow.team_id === null || prow.team_id === undefined ? null : String(prow.team_id);
      if (!team) continue;
      const list = byTeam.get(team) ?? [];
      list.push(prow);
      byTeam.set(team, list);
    }
    const lineupSources: Array<{ teamDatasetId: string; formation?: string; coach?: string; players: DatasetRow[] }> = [];
    for (const lrow of group.primary) {
      const team = lrow.team_id === null || lrow.team_id === undefined ? null : String(lrow.team_id);
      if (!team) continue;
      lineupSources.push({
        teamDatasetId: team,
        formation: typeof lrow.formation === 'string' ? lrow.formation : undefined,
        coach: typeof lrow.coach_name === 'string' ? lrow.coach_name : undefined,
        players: byTeam.get(team) ?? [],
      });
    }
    // Shells: appearances without a lineup row still need a home.
    if (group.shellOnly || lineupSources.length === 0) {
      for (const [team, players] of byTeam) {
        lineupSources.push({ teamDatasetId: team, players });
      }
    }
    for (const source of lineupSources) {
      const teamId = ctx.mappings.get('team', source.teamDatasetId);
      if (!teamId) {
        ctx.counters.quarantined += 1;
        await ctx.sink.quarantine({
          file: ctx.file, entityType: 'match_lineup', sourceId: `${group.fixtureId}:${source.teamDatasetId}`,
          code: QuarantineCode.UNRESOLVED_TEAM, reason: `team ${source.teamDatasetId} not imported`,
          record: { fixture_id: group.fixtureId, team_id: source.teamDatasetId },
        });
        continue;
      }
      const inputs = source.players.map((prow) => ({
        playerExternalId: String(prow.player_id),
        position: typeof prow.position === 'string' ? prow.position : undefined,
        shirtNumber: toInt(prow.number, 0, 99) ?? undefined,
        starter: prow.is_starter === true,
        captain: prow.captain === true,
        minutes: prow.minutes === null || prow.minutes === undefined ? null : toInt(prow.minutes, 0, 150),
        rating: prow.rating === null || prow.rating === undefined ? null : toFloat(prow.rating, 0, 10),
      }));
      const { players, quarantined } = await prepareLineupPlayers(ctx, ctx.file, inputs);
      ctx.counters.quarantined += quarantined;
      const dto = {
        matchExternalId: group.fixtureId,
        teamExternalId: source.teamDatasetId,
        formation: source.formation,
        coachName: source.coach,
        players,
      };
      if (ctx.dryRun) {
        // Existence check without write: lineup natural key.
        const { data } = await ctx.client.from('match_lineups').select('id').eq('match_id', matchId).eq('team_id', teamId).maybeSingle();
        ctx.counters[data ? 'updated' : 'created'] += 1;
        continue;
      }
      const status = await applyLineup(ctx, dto, { matchId, teamId });
      ctx.counters[status === 'created' ? 'created' : 'updated'] += 1;
    }
    return;
  }
  if (phase === 'team-stats') {
    const row = group.primary[0] as DatasetRow;
    const matchId = ctx.mappings.get('match', group.fixtureId);
    if (!matchId) {
      ctx.counters.quarantined += 1;
      await ctx.sink.quarantine({
        file: ctx.file, entityType: 'match_team_stat', sourceId: group.fixtureId,
        code: QuarantineCode.UNRESOLVED_MATCH, reason: `match ${group.fixtureId} not imported`, record: row as Row,
      });
      return;
    }
    // Resolve home/away canonical teams via the matches table (single select).
    const { data: matchRow, error } = await ctx.client.from('matches').select('home_team_id,away_team_id').eq('id', matchId).maybeSingle();
    if (error || !matchRow) {
      ctx.counters.quarantined += 1;
      await ctx.sink.quarantine({
        file: ctx.file, entityType: 'match_team_stat', sourceId: group.fixtureId,
        code: QuarantineCode.DB_ERROR, reason: 'match row unreadable', record: row as Row,
      });
      return;
    }
    const sides = [
      { teamId: String((matchRow as { home_team_id: string }).home_team_id), prefix: 'home_' },
      { teamId: String((matchRow as { away_team_id: string }).away_team_id), prefix: 'away_' },
    ];
    for (const side of sides) {
      const built = buildTeamStatDto(row, side.prefix === 'home_' ? 'home' : 'away', side.prefix);
      if ('quarantine' in built) {
        ctx.counters.quarantined += 1;
        await ctx.sink.quarantine({
          file: ctx.file, entityType: 'match_team_stat', sourceId: `${group.fixtureId}:${side.prefix}`,
          code: QuarantineCode.INVALID_NUMERIC, reason: built.quarantine, record: row as Row,
        });
        continue;
      }
      const { data: existing } = await ctx.client.from('match_team_statistics').select('*').eq('match_id', matchId).eq('team_id', side.teamId).maybeSingle();
      const existingRow = (existing as Row | null) ?? null;
      if (existingRow && shallowEqual(existingRow, built.expected, TEAM_STAT_COMPARE)) {
        ctx.counters.skipped += 1;
        continue;
      }
      if (ctx.dryRun) {
        ctx.counters[existingRow ? 'updated' : 'created'] += 1;
        continue;
      }
      await persistTeamStats(ctx.persist, { matchExternalId: group.fixtureId, teamExternalId: '', ...built.dto }, { matchId, teamId: side.teamId });
      ctx.counters[existing ? 'updated' : 'created'] += 1;
    }
    return;
  }
  if (phase === 'player-stats') {
    const matchId = ctx.mappings.get('match', group.fixtureId);
    if (!matchId) {
      ctx.counters.quarantined += 1;
      await ctx.sink.quarantine({
        file: ctx.file, entityType: 'match_player_stat', sourceId: group.fixtureId,
        code: QuarantineCode.UNRESOLVED_MATCH, reason: `match ${group.fixtureId} not imported`,
        record: { fixture_id: group.fixtureId },
      });
      return;
    }
    // Secondary rows keyed by fixture_player dataset id → team dataset id.
    const teamByFpId = new Map<string, string>();
    for (const srow of group.secondary) {
      if (srow.id !== null && srow.id !== undefined && srow.team_id !== null && srow.team_id !== undefined) {
        teamByFpId.set(String(srow.id), String(srow.team_id));
      }
    }
    const { buildPlayerStatDto, PLAYER_STAT_COMPARE } = await import('./phases');
    for (const srow of group.primary) {
      const playerExt = srow.player_id === null || srow.player_id === undefined ? null : String(srow.player_id);
      const teamExt = srow.fixture_player_id === null || srow.fixture_player_id === undefined
        ? null
        : (teamByFpId.get(String(srow.fixture_player_id)) ?? null);
      const playerId = playerExt ? ctx.mappings.get('player', playerExt) : null;
      const teamId = teamExt ? ctx.mappings.get('team', teamExt) : null;
      if (!playerExt || !playerId) {
        ctx.counters.quarantined += 1;
        await ctx.sink.quarantine({
          file: ctx.file, entityType: 'match_player_stat', sourceId: String(srow.fixture_player_id ?? '?'),
          code: QuarantineCode.UNRESOLVED_PLAYER, reason: `player ${String(playerExt ?? '?')} not imported`, record: srow as Row,
        });
        continue;
      }
      if (!teamExt || !teamId) {
        ctx.counters.quarantined += 1;
        await ctx.sink.quarantine({
          file: ctx.file, entityType: 'match_player_stat', sourceId: String(srow.fixture_player_id ?? '?'),
          code: QuarantineCode.UNRESOLVED_TEAM, reason: 'fixture-player team context missing', record: srow as Row,
        });
        continue;
      }
      const built = buildPlayerStatDto(srow);
      if ('quarantine' in built) {
        ctx.counters.quarantined += 1;
        await ctx.sink.quarantine({
          file: ctx.file, entityType: 'match_player_stat', sourceId: String(srow.fixture_player_id ?? playerExt),
          code: QuarantineCode.INVALID_NUMERIC, reason: built.quarantine, record: srow as Row,
        });
        continue;
      }
      const { data: existing } = await ctx.client.from('match_player_statistics').select('*').eq('match_id', matchId).eq('player_id', playerId).maybeSingle();
      const existingRow = (existing as Row | null) ?? null;
      if (existingRow && shallowEqual(existingRow, built.expected, PLAYER_STAT_COMPARE)) {
        ctx.counters.skipped += 1;
        continue;
      }
      if (ctx.dryRun) {
        ctx.counters[existingRow ? 'updated' : 'created'] += 1;
        continue;
      }
      await persistPlayerStats(
        ctx.persist,
        { matchExternalId: group.fixtureId, teamExternalId: teamExt, playerExternalId: playerExt, ...built.dto },
        { matchId, teamId, playerId },
      );
      ctx.counters[existingRow ? 'updated' : 'created'] += 1;
    }
  }
}

type Row = Record<string, unknown>;

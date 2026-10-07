/**
 * Dataset import pipeline — shared types.
 *
 * One resumable job per (phase, file) lives in `sync_jobs` (job_type
 * 'dataset-import'); progress cursors live in the job `payload` so no schema
 * change is required. Quarantined records live in `sync_errors`.
 */

/** Pipeline phases in dependency order. */
export const DATASET_PHASES = [
  'reference',
  'relationships',
  'matches',
  'lineups',
  'team-stats',
  'player-stats',
] as const;

export type DatasetPhase = (typeof DATASET_PHASES)[number];

/** Source files in the downloaded data lake. */
export const DATASET_FILES = [
  'fixtures',
  'match_stats',
  'odds',
  'fixture_lineups',
  'teams',
  'players',
  'leagues',
  'fixture_players',
  'fixture_players_stats_flat',
  'league_catalogue',
  'xg_training',
] as const;

export type DatasetFile = (typeof DATASET_FILES)[number];

/** Files intentionally never imported (no destination / out of scope). */
export const SKIPPED_FILES: DatasetFile[] = ['odds', 'xg_training'];

export interface PhaseFile {
  phase: DatasetPhase;
  file: DatasetFile;
}

/** Which source file(s) each phase consumes. */
export const PHASE_FILES: Record<DatasetPhase, DatasetFile[]> = {
  reference: ['leagues', 'league_catalogue', 'teams', 'players', 'fixtures'],
  relationships: ['fixtures'],
  matches: ['fixtures', 'match_stats'],
  lineups: ['fixture_lineups', 'fixture_players'],
  'team-stats': ['match_stats'],
  'player-stats': ['fixture_players_stats_flat', 'fixture_players'],
};

export type ImportJobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

/** Checkpoint + counters persisted in `sync_jobs.payload` / `sync_jobs` columns. */
export interface JobCheckpoint {
  phase: DatasetPhase;
  file: DatasetFile;
  /** Row offset of the next unread chunk (resume cursor). */
  offset: number;
  /** Secondary-file offsets for fixture-merge phases (file → row offset). */
  secondaryOffsets: Record<string, number>;
  /** Highest fixture id covered so far (shell suppression across batches). */
  lastMaxFixture: string | null;
  batchSize: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  quarantined: number;
  failed: number;
  dryRun: boolean;
  datasetDir: string;
  dataSource: string;
  startedAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface BatchReport {
  jobId: string;
  phase: DatasetPhase;
  file: DatasetFile;
  batch: number;
  offset: number;
  rows: number;
  created: number;
  updated: number;
  skipped: number;
  quarantined: number;
  failed: number;
  elapsedMs: number;
}

export interface PhaseReport {
  phase: DatasetPhase;
  files: DatasetFile[];
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  quarantined: number;
  failed: number;
  status: ImportJobStatus;
}

export interface ImportReport {
  dryRun: boolean;
  phases: PhaseReport[];
  durationMs: number;
}

export interface QuarantineRecord {
  file: DatasetFile;
  entityType: string;
  sourceId: string;
  code: string;
  reason: string;
  record: Record<string, unknown>;
  timestamp: string;
}

export const DATASET_SOURCE_NAME = 'football-dataset-2026-07';
export const DATASET_SOURCE_PROVIDER = 'dataset';
export const DATASET_JOB_TYPE = 'dataset-import';

/**
 * Tables the importer is allowed to write. Anything else is rejected before
 * any write happens (see runner safety checks + safety tests).
 */
export const DATASET_WRITABLE_TABLES = [
  'countries',
  'competitions',
  'seasons',
  'teams',
  'players',
  'team_competitions',
  'matches',
  'match_lineups',
  'match_lineup_players',
  'match_team_statistics',
  'match_player_statistics',
  'external_entity_ids',
  'data_sources',
  'sync_jobs',
  'sync_errors',
] as const;

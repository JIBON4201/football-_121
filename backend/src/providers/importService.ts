import { ApiError } from '../lib/errors';
import { log } from '../lib/logger';
import { serviceClient, type DbClient } from '../lib/supabase';
import { lookupMapping } from './externalIds';
import { adapterForDataSource, getDataSource } from './registry';
import {
  eventKeysForMatch,
  findExisting,
  slugForEntity,
} from './persist';
import { resolveEntity } from './resolver';
import { FETCHERS, SCHEMAS, runSync } from './sync';
import type { FootballDataProvider, SyncParams } from './provider';
import type { SyncEntityType } from './types';
import { validateRecord } from './validation';

/** Dependency-aware stage order. Dependents never run before references. */
export const IMPORT_ORDER: SyncEntityType[] = [
  'countries',
  'venues',
  'competitions',
  'seasons',
  'teams',
  'players',
  'matches',
  'events',
  'lineups',
  'team-stats',
  'player-stats',
  'transfers',
];

export interface ImportScope {
  provider?: string;
  dataSourceId?: string;
  /** Subset of stages; dependency order is always preserved. */
  entities?: SyncEntityType[];
  dryRun?: boolean;
  limit?: number;
  batchSize?: number;
  /** Adapter-level scope (from/to dates, competitionExternalId, …). */
  params?: SyncParams;
  /**
   * Parent queue row adopted by the background worker. Aggregated status
   * and counters are written back when the import finishes.
   */
  parentJobId?: string;
}

export interface StageFailure {
  externalId: string;
  code: string;
  message: string;
}

export interface StageReport {
  entityType: SyncEntityType;
  status: 'completed' | 'partial' | 'failed' | 'skipped';
  discovered: number;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  conflicts: number;
  jobId?: string;
  failures: StageFailure[];
}

export interface IntegrityReport {
  mappings: number;
  duplicateMappings: number;
  tableCounts: Record<string, number>;
}

export interface ImportReport {
  provider: string;
  dryRun: boolean;
  stages: StageReport[];
  integrity: IntegrityReport | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

const DRY_RUN_TABLE: Partial<Record<SyncEntityType, string>> = {
  countries: 'countries',
  venues: 'venues',
  competitions: 'competitions',
  teams: 'teams',
  players: 'players',
  matches: 'matches',
};

async function countTable(client: DbClient, table: string): Promise<number> {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });
  return error ? -1 : (count ?? 0);
}

async function classifyRecord(
  client: DbClient,
  dataSourceId: string,
  entityType: SyncEntityType,
  record: Record<string, unknown>,
  known: Map<string, Set<string>>,
): Promise<{ outcome: 'create' | 'update' | 'skip' | 'conflict' | 'invalid'; code?: string; message?: string }> {
  const externalId = String(
    (record.externalId ?? record.matchExternalId ?? '') as string,
  );
  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value ? value : undefined;
  const refId = (type: string, ext: string | undefined): Promise<string | null> =>
    ext ? lookupMapping(client, dataSourceId, type, ext) : Promise.resolve(null);
  const refKnown = (type: string, ext: string | undefined): boolean =>
    !!ext && (known.get(type)?.has(ext) ?? false);
  const refOk = async (type: string, ext: string | undefined): Promise<boolean> =>
    !ext || (await refId(type, ext)) !== null || refKnown(type, ext);
  try {
    switch (entityType) {
      case 'countries': {
        const code = record.code as string | undefined;
        const slug = slugForEntity('countries', record);
        const existing = code
          ? await findExisting(client, 'countries', 'id', [['code', code]])
          : await findExisting(client, 'countries', 'id', [['slug', slug]]);
        return { outcome: existing ? 'update' : 'create' };
      }
      case 'seasons': {
        const compExt = str(record.competitionExternalId);
        const competitionId = await refId('competition', compExt);
        if (!competitionId) {
          // Parent absent from the database but present earlier in this same
          // import cannot host an existing row — it would be created.
          if (refKnown('competition', compExt)) return { outcome: 'create' };
          return { outcome: 'invalid', code: 'INVALID_RELATIONSHIP', message: 'Unresolved competition reference' };
        }
        const existing = await findExisting(client, 'seasons', 'id', [
          ['competition_id', competitionId],
          ['name', String(record.name ?? '')],
        ]);
        return { outcome: existing ? 'update' : 'create' };
      }
      case 'events': {
        const matchExt = str(record.matchExternalId);
        const matchId = await refId('match', matchExt);
        if (!matchId && !refKnown('match', matchExt)) {
          return { outcome: 'invalid', code: 'INVALID_RELATIONSHIP', message: 'Unresolved match reference' };
        }
        const teamExt = str(record.teamExternalId);
        const playerExt = str(record.playerExternalId);
        const assistExt = str(record.assistPlayerExternalId);
        if (!(await refOk('team', teamExt)) || !(await refOk('player', playerExt)) || !(await refOk('player', assistExt))) {
          return { outcome: 'invalid', code: 'INVALID_RELATIONSHIP', message: 'Unresolved event participant' };
        }
        if (!matchId) return { outcome: 'create' };
        const keys = await eventKeysForMatch({ client, dataSourceId }, matchId);
        const teamId = teamExt ? await refId('team', teamExt) : null;
        const playerId = playerExt ? await refId('player', playerExt) : null;
        const exact = [teamId, playerId, record.type, record.minute, record.extraMinute].map(String).join('|');
        return { outcome: keys.has(exact) ? 'skip' : 'create' };
      }
      case 'lineups':
      case 'team-stats':
      case 'player-stats': {
        const matchExt = str(record.matchExternalId);
        const teamExt = str(record.teamExternalId);
        const playerExt = entityType === 'player-stats' ? str(record.playerExternalId) : undefined;
        const matchId = await refId('match', matchExt);
        const teamId = await refId('team', teamExt);
        const playerId = entityType === 'player-stats' ? await refId('player', playerExt) : null;
        if (matchId && teamId && (entityType !== 'player-stats' || playerId)) {
          const table =
            entityType === 'lineups' ? 'match_lineups' : entityType === 'team-stats' ? 'match_team_statistics' : 'match_player_statistics';
          const filters: Array<[string, unknown]> =
            entityType === 'player-stats'
              ? [['match_id', matchId], ['player_id', playerId as string]]
              : [['match_id', matchId], ['team_id', teamId]];
          const existing = await findExisting(client, table, 'id', filters);
          return { outcome: existing ? 'update' : 'create' };
        }
        const knownEnough =
          (matchId ?? refKnown('match', matchExt)) &&
          (teamId ?? refKnown('team', teamExt)) &&
          (entityType !== 'player-stats' || playerId || refKnown('player', playerExt));
        if (knownEnough) return { outcome: 'create' };
        return { outcome: 'invalid', code: 'INVALID_RELATIONSHIP', message: 'Unresolved match/team reference' };
      }
      case 'transfers': {
        const playerExt = str(record.playerExternalId);
        const seasonExt = str(record.seasonExternalId);
        const playerId = await refId('player', playerExt);
        const seasonId = await refId('season', seasonExt);
        if (playerId && seasonId) {
          const existing = await findExisting(client, 'transfers', 'id', [
            ['player_id', playerId],
            ['season_id', seasonId],
            ['transfer_type', String(record.transferType ?? '')],
          ]);
          return { outcome: existing ? 'update' : 'create' };
        }
        if ((playerId ?? refKnown('player', playerExt)) && (seasonId ?? refKnown('season', seasonExt))) {
          return { outcome: 'create' };
        }
        return { outcome: 'invalid', code: 'INVALID_RELATIONSHIP', message: 'Unresolved player/season reference' };
      }
      default: {
        const table = DRY_RUN_TABLE[entityType];
        // Canonical singular mapping names (see external_entity_ids contract).
        const mappingNames: Partial<Record<SyncEntityType, string>> = {
          countries: 'country',
          venues: 'venue',
          competitions: 'competition',
          teams: 'team',
          players: 'player',
          matches: 'match',
        };
        if (!table) return { outcome: 'invalid', code: 'INVALID_FORMAT', message: `Unsupported entity '${entityType}'` };
        const slug = slugForEntity(entityType, record);
        const outcome = await resolveEntity(client, {
          dataSourceId,
          entityType: mappingNames[entityType] ?? entityType,
          externalId,
          table,
          slug,
          dryRun: true,
        });
        if (outcome.status === 'mapped' || outcome.status === 'matched') return { outcome: 'update' };
        if (outcome.status === 'ambiguous') return { outcome: 'conflict' };
        return { outcome: 'create' };
      }
    }
  } catch (error) {
    return { outcome: 'invalid', code: 'DATABASE_ERROR', message: error instanceof Error ? error.message : 'Classification failed' };
  }
}

async function dryRunStage(
  client: DbClient,
  dataSourceId: string,
  adapter: FootballDataProvider,
  entityType: SyncEntityType,
  params: SyncParams | undefined,
  limit: number | undefined,
  known: Map<string, Set<string>>,
): Promise<StageReport> {
  const report: StageReport = {
    entityType,
    status: 'completed',
    discovered: 0,
    valid: 0,
    invalid: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    conflicts: 0,
    failures: [],
  };
  let records: unknown[] | null;
  try {
    records = (await FETCHERS[entityType](adapter, params)) ?? null;
  } catch (error) {
    report.status = 'failed';
    report.failures.push({
      externalId: '',
      code: 'DATABASE_ERROR',
      message: error instanceof Error ? error.message : 'Fetch failed',
    });
    return report;
  }
  if (!records) {
    report.status = 'skipped';
    return report;
  }
  const bounded = records.slice(0, Math.min(limit ?? 500, 2000));
  const schema = SCHEMAS[entityType];
  // Singular mapping names shared with classifyRecord lookups.
  const knownKey: Partial<Record<SyncEntityType, string>> = {
    countries: 'country',
    venues: 'venue',
    competitions: 'competition',
    seasons: 'season',
    teams: 'team',
    players: 'player',
    matches: 'match',
    transfers: 'transfer',
  };
  for (const payload of bounded as Array<Record<string, unknown>>) {
    report.discovered += 1;
    const externalId = (payload as { externalId?: unknown }).externalId;
    if (typeof externalId === 'string' && externalId) {
      // Later stages in the same dry-run resolve against these IDs.
      const key = knownKey[entityType] ?? entityType;
      let set = known.get(key);
      if (!set) {
        set = new Set();
        known.set(key, set);
      }
      set.add(externalId);
    }
    const validated = validateRecord(schema, payload);
    if (!validated.ok) {
      report.invalid += 1;
      report.failed += 1;
      if (report.failures.length < 20) {
        report.failures.push({
          externalId: String((payload.externalId ?? '') as string),
          code: validated.failure.code,
          message: validated.failure.message,
        });
      }
      continue;
    }
    report.valid += 1;
    const classified = await classifyRecord(client, dataSourceId, entityType, validated.data as Record<string, unknown>, known);
    if (classified.outcome === 'create') report.created += 1;
    else if (classified.outcome === 'update') report.updated += 1;
    else if (classified.outcome === 'skip') report.skipped += 1;
    else if (classified.outcome === 'conflict') {
      report.conflicts += 1;
      report.failed += 1;
    } else {
      report.invalid += 1;
      report.failed += 1;
      if (report.failures.length < 20) {
        report.failures.push({
          externalId: String((validated.data as Record<string, unknown>).externalId ?? ''),
          code: classified.code ?? 'INVALID_RELATIONSHIP',
          message: classified.message ?? 'Unresolvable reference',
        });
      }
    }
  }
  if (report.failed > 0) report.status = report.created + report.updated > 0 ? 'partial' : 'failed';
  return report;
}

/** Post-stage integrity snapshot: mapping duplicates + canonical counts. */
export async function verifyIntegrity(dataSourceId: string): Promise<IntegrityReport> {
  const client = serviceClient();
  const { data: mappings } = await client
    .from('external_entity_ids')
    .select('data_source_id,entity_type,external_id,entity_id')
    .eq('data_source_id', dataSourceId)
    .range(0, 4999);
  const rows = ((mappings as Array<Record<string, string>> | null) ?? []);
  const seenExternal = new Set<string>();
  const seenEntity = new Set<string>();
  let duplicateMappings = 0;
  for (const row of rows) {
    const a = `${row.data_source_id}|${row.entity_type}|${row.external_id}`;
    const b = `${row.data_source_id}|${row.entity_type}|${row.entity_id}`;
    if (seenExternal.has(a) || seenEntity.has(b)) duplicateMappings += 1;
    seenExternal.add(a);
    seenEntity.add(b);
  }
  const tables = [
    'countries',
    'venues',
    'competitions',
    'seasons',
    'teams',
    'players',
    'matches',
    'match_events',
    'transfers',
  ];
  const tableCounts: Record<string, number> = {};
  for (const table of tables) tableCounts[table] = await countTable(client, table);
  return { mappings: rows.length, duplicateMappings, tableCounts };
}

export async function runImport(scope: ImportScope): Promise<ImportReport> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const client = serviceClient();
  const providerName = scope.provider ?? 'seed';
  const dataSource = scope.dataSourceId
    ? await getDataSource(client, { id: scope.dataSourceId })
    : await getDataSource(client, { provider: providerName });
  const adapter = await adapterForDataSource(dataSource);

  const entities = IMPORT_ORDER.filter((entity) => !scope.entities || scope.entities.includes(entity));
  const stages: StageReport[] = [];
  // Dry-run reference sets, accumulated in dependency order so later stages
  // classify against records fetched earlier in the same run.
  const known = new Map<string, Set<string>>();
  for (const entityType of entities) {
    if (scope.dryRun) {
      stages.push(await dryRunStage(client, dataSource.id, adapter, entityType, scope.params, scope.limit, known));
      continue;
    }
    const summary = await runSync({
      dataSource: { id: dataSource.id },
      jobType: 'import',
      entityType,
      params: scope.params,
      limit: scope.limit,
      batchSize: scope.batchSize,
      adapter,
    });
    stages.push({
      entityType,
      status: summary.status as StageReport['status'],
      discovered: summary.processed,
      valid: summary.processed - summary.failed,
      invalid: 0,
      created: summary.created,
      updated: summary.updated,
      skipped: 0,
      failed: summary.failed,
      conflicts: 0,
      jobId: summary.jobId,
      failures: [],
    });
  }

  const integrity = scope.dryRun ? null : await verifyIntegrity(dataSource.id);
  const finishedAt = new Date().toISOString();
  log({
    msg: scope.dryRun ? 'import_dry_run' : 'import_complete',
    provider: dataSource.provider,
    stages: stages.map((stage) => ({ entity: stage.entityType, status: stage.status })),
    durationMs: Date.now() - started,
  });
  if (scope.parentJobId && !scope.dryRun) {
    const failed = stages.filter((stage) => stage.status === 'failed').length;
    const succeeded = stages.filter((stage) => stage.status === 'completed').length;
    const status = failed === 0 ? 'completed' : succeeded > 0 ? 'partial' : 'failed';
    const sum = (pick: (stage: StageReport) => number): number =>
      stages.reduce((total, stage) => total + pick(stage), 0);
    await client
      .from('sync_jobs')
      .update({
        status,
        completed_at: finishedAt,
        records_processed: sum((stage) => stage.discovered),
        records_created: sum((stage) => stage.created),
        records_updated: sum((stage) => stage.updated),
        records_failed: sum((stage) => stage.failed),
        error_message:
          status === 'completed' ? null : `${failed} of ${stages.length} stages failed`,
      })
      .eq('id', scope.parentJobId);
  }
  return { provider: dataSource.provider, dryRun: scope.dryRun ?? false, stages, integrity, startedAt, finishedAt, durationMs: Date.now() - started };
}

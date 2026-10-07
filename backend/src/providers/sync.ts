import { listWhereIn } from '../repositories/related';
import { slugify } from './normalize';
import { competitionsService } from '../services/competitions.service';
import { matchesService } from '../services/matches.service';
import { newsService } from '../services/news.service';
import { playersService } from '../services/players.service';
import { searchService } from '../services/search.service';
import { teamsService } from '../services/teams.service';
import { transfersService } from '../services/transfers.service';
import { ApiError, conflict, upstream } from '../lib/errors';
import { log } from '../lib/logger';
import { serviceClient, type DbClient } from '../lib/supabase';
import { MappingConflictError } from './externalIds';
import {
  RecordSyncError,
  eventKeysForMatch,
  findWindowId,
  persistCompetition,
  persistCountry,
  persistEvent,
  persistLineup,
  persistMatch,
  persistPlayer,
  persistPlayerStats,
  persistSeason,
  persistTeam,
  persistTeamStats,
  persistTransfer,
  persistVenue,
  prefetchKey,
  type PersistContext,
} from './persist';
import { adapterForDataSource, getDataSource } from './registry';
import { lookupMapping } from './externalIds';
import type { FootballDataProvider, SyncParams } from './provider';
import type { SyncEntityType } from './types';
import {
  validateRecord,
  NormalizedCompetitionSchema,
  NormalizedCountrySchema,
  NormalizedLineupSchema,
  NormalizedMatchEventSchema,
  NormalizedMatchSchema,
  NormalizedPlayerSchema,
  NormalizedPlayerStatisticsSchema,
  NormalizedSeasonSchema,
  NormalizedTeamSchema,
  NormalizedTeamStatisticsSchema,
  NormalizedTransferSchema,
  NormalizedVenueSchema,
} from './validation';
import type { z } from 'zod';

export interface SyncRequest {
  dataSource?: { id?: string; provider?: string };
  jobType: string;
  entityType?: SyncEntityType;
  params?: SyncParams;
  limit?: number;
  /** Chunk size for batched prefetch/write cycles (10-500, default 100). */
  batchSize?: number;
  /** Injected adapter (tests, workers). Otherwise resolved from the registry. */
  adapter?: FootballDataProvider;
  /**
   * Adopt an existing queue row instead of inserting a new sync_jobs row.
   * Used by the background worker; the row is updated in place.
   */
  jobId?: string;
  /**
   * Fetch-failure handling: 'finalize' records a failed job and returns a
   * summary (direct/import use); 'throw' propagates to the caller so the
   * background worker can apply its retry policy.
   */
  fetchErrorMode?: 'finalize' | 'throw';
}

export interface SyncSummary {
  jobId: string;
  status: string;
  processed: number;
  created: number;
  updated: number;
  failed: number;
}

export const FETCHERS: Record<
  SyncEntityType,
  (adapter: FootballDataProvider, params?: SyncParams) => Promise<unknown[] | undefined>
> = {
  countries: async (a, p) => a.getCountries?.(p),
  venues: async (a, p) => a.getVenues?.(p),
  competitions: async (a, p) => a.getCompetitions?.(p),
  seasons: async (a, p) => a.getSeasons?.(p),
  teams: async (a, p) => a.getTeams?.(p),
  players: async (a, p) => a.getPlayers?.(p),
  matches: async (a, p) => a.getMatches?.(p),
  events: async (a, p) => a.getMatchEvents?.(p),
  lineups: async (a, p) => a.getLineups?.(p),
  'team-stats': async (a, p) => a.getTeamStatistics?.(p),
  'player-stats': async (a, p) => a.getPlayerStatistics?.(p),
  transfers: async (a, p) => a.getTransfers?.(p),
};

export const SCHEMAS: Record<SyncEntityType, z.ZodTypeAny> = {
  countries: NormalizedCountrySchema,
  venues: NormalizedVenueSchema,
  competitions: NormalizedCompetitionSchema,
  seasons: NormalizedSeasonSchema,
  teams: NormalizedTeamSchema,
  players: NormalizedPlayerSchema,
  matches: NormalizedMatchSchema,
  events: NormalizedMatchEventSchema,
  lineups: NormalizedLineupSchema,
  'team-stats': NormalizedTeamStatisticsSchema,
  'player-stats': NormalizedPlayerStatisticsSchema,
  transfers: NormalizedTransferSchema,
};

const SECRET_KEY = /api[_-]?key|token|secret|password|auth|cookie|credential|session/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) {
        out[key] = '[redacted]';
        continue;
      }
      out[key] = sanitize(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

async function resolveRequired(
  ctx: PersistContext,
  entityType: string,
  externalId: string | undefined,
): Promise<string> {
  if (!externalId) throw new RecordSyncError('INVALID_RELATIONSHIP', `Missing ${entityType} reference`);
  const id = await lookupMapping(ctx.client, ctx.dataSourceId, entityType, externalId);
  if (!id) {
    throw new RecordSyncError('INVALID_RELATIONSHIP', `Unresolved ${entityType} '${externalId}'`);
  }
  return id;
}

async function persistRecord(
  ctx: PersistContext,
  entityType: SyncEntityType,
  record: Record<string, unknown>,
  caches: { eventKeys: Map<string, Set<string>> },
): Promise<'created' | 'updated' | 'skipped'> {
  switch (entityType) {
    case 'countries':
      return (await persistCountry(ctx, record as never)).status;
    case 'venues':
      return (await persistVenue(ctx, record as never)).status;
    case 'competitions':
      return (await persistCompetition(ctx, record as never)).status;
    case 'seasons': {
      const competitionId = await resolveRequired(ctx, 'competition', (record as { competitionExternalId?: string }).competitionExternalId);
      return (await persistSeason(ctx, record as never, competitionId)).status;
    }
    case 'teams':
      return (await persistTeam(ctx, record as never)).status;
    case 'players':
      return (await persistPlayer(ctx, record as never)).status;
    case 'matches': {
      const r = record as { competitionExternalId?: string; seasonExternalId?: string; venueExternalId?: string; homeTeamExternalId?: string; awayTeamExternalId?: string };
      const competitionId = await resolveRequired(ctx, 'competition', r.competitionExternalId);
      const homeId = await resolveRequired(ctx, 'team', r.homeTeamExternalId);
      const awayId = await resolveRequired(ctx, 'team', r.awayTeamExternalId);
      const seasonId = r.seasonExternalId
        ? await lookupMapping(ctx.client, ctx.dataSourceId, 'season', r.seasonExternalId)
        : null;
      const venueId = r.venueExternalId
        ? await lookupMapping(ctx.client, ctx.dataSourceId, 'venue', r.venueExternalId)
        : null;
      return (await persistMatch(ctx, record as never, { competitionId, seasonId, venueId, homeId, awayId })).status;
    }
    case 'events': {
      const r = record as { matchExternalId?: string; teamExternalId?: string; playerExternalId?: string; assistPlayerExternalId?: string };
      const matchId = await resolveRequired(ctx, 'match', r.matchExternalId);
      const teamId = r.teamExternalId ? await resolveRequired(ctx, 'team', r.teamExternalId) : null;
      const playerId = r.playerExternalId ? await resolveRequired(ctx, 'player', r.playerExternalId) : null;
      const assistId = r.assistPlayerExternalId ? await resolveRequired(ctx, 'player', r.assistPlayerExternalId) : null;
      let keys = caches.eventKeys.get(matchId);
      if (!keys) {
        keys = await eventKeysForMatch(ctx, matchId);
        caches.eventKeys.set(matchId, keys);
      }
      return (await persistEvent(ctx, record as never, { matchId, teamId, playerId, assistId }, keys)).status;
    }
    case 'lineups': {
      const r = record as { matchExternalId?: string; teamExternalId?: string };
      const matchId = await resolveRequired(ctx, 'match', r.matchExternalId);
      const teamId = await resolveRequired(ctx, 'team', r.teamExternalId);
      return (await persistLineup(ctx, record as never, { matchId, teamId })).status;
    }
    case 'team-stats': {
      const r = record as { matchExternalId?: string; teamExternalId?: string };
      const matchId = await resolveRequired(ctx, 'match', r.matchExternalId);
      const teamId = await resolveRequired(ctx, 'team', r.teamExternalId);
      return (await persistTeamStats(ctx, record as never, { matchId, teamId })).status;
    }
    case 'player-stats': {
      const r = record as { matchExternalId?: string; teamExternalId?: string; playerExternalId?: string };
      const matchId = await resolveRequired(ctx, 'match', r.matchExternalId);
      const teamId = await resolveRequired(ctx, 'team', r.teamExternalId);
      const playerId = await resolveRequired(ctx, 'player', r.playerExternalId);
      return (await persistPlayerStats(ctx, record as never, { matchId, teamId, playerId })).status;
    }
    case 'transfers': {
      const r = record as { playerExternalId?: string; fromTeamExternalId?: string; toTeamExternalId?: string; seasonExternalId?: string; windowName?: string };
      const playerId = await resolveRequired(ctx, 'player', r.playerExternalId);
      const seasonId = await resolveRequired(ctx, 'season', r.seasonExternalId);
      const fromId = r.fromTeamExternalId ? await resolveRequired(ctx, 'team', r.fromTeamExternalId) : null;
      const toId = r.toTeamExternalId ? await resolveRequired(ctx, 'team', r.toTeamExternalId) : null;
      const windowId = await findWindowId(ctx, seasonId, r.windowName);
      return (await persistTransfer(ctx, record as never, { playerId, fromId, toId, seasonId, windowId })).status;
    }
    default:
      throw new RecordSyncError('INVALID_FORMAT', `Unsupported entity type '${entityType}'`);
  }
}

/**
 * Batch prefetch: one IN-query per chunk for high-volume slug/code entities
 * so persist functions hit the chunk map instead of issuing N+1 lookups.
 * Best-effort — any failure falls back to per-record lookups.
 */
async function prefetchChunk(
  ctx: PersistContext,
  entityType: SyncEntityType,
  chunk: Array<Record<string, unknown>>,
): Promise<void> {
  const client = ctx.client;
  const rememberAll = (table: string, keyCol: string, rows: Array<Record<string, unknown>>) => {
    for (const row of rows) ctx.prefetch?.set(prefetchKey(table, String(row[keyCol])), row);
  };
  const slugList = (pick: (row: Record<string, unknown>) => unknown): string[] => [
    ...new Set(
      chunk
        .map((row) => {
          const value = pick(row);
          if (typeof value !== 'string' || !value.trim()) return '';
          return slugify(value, 'x');
        })
        .filter(Boolean),
    ),
  ];
  try {
    if (entityType === 'teams') {
      const slugs = slugList((row) => (row.shortName ?? row.name) as string);
      if (slugs.length > 0) {
        rememberAll('teams', 'slug', await listWhereIn(client, 'teams', 'id,slug', 'slug', slugs, undefined, 500));
      }
    } else if (entityType === 'players') {
      const slugs = slugList((row) => row.displayName as string);
      if (slugs.length > 0) {
        rememberAll('players', 'slug', await listWhereIn(client, 'players', 'id,slug', 'slug', slugs, undefined, 500));
      }
    } else if (entityType === 'competitions') {
      const slugs = slugList((row) => row.name as string);
      if (slugs.length > 0) {
        rememberAll(
          'competitions',
          'slug',
          await listWhereIn(client, 'competitions', 'id,slug', 'slug', slugs, undefined, 500),
        );
      }
    } else if (entityType === 'countries') {
      const codes = [
        ...new Set(
          chunk
            .map((row) => (typeof row.code === 'string' ? row.code.toUpperCase() : ''))
            .filter((code) => /^[A-Z]{2,3}$/.test(code)),
        ),
      ];
      if (codes.length > 0) {
        rememberAll('countries', 'code', await listWhereIn(client, 'countries', 'id,code', 'code', codes, undefined, 500));
      }
    }
  } catch {
    ctx.prefetch?.clear();
  }
}

async function recordFailure(
  client: DbClient,
  jobId: string,
  entityType: string,
  payload: unknown,
  code: string,
  message: string,
): Promise<void> {
  const record = (payload ?? {}) as { externalId?: string; matchExternalId?: string };
  await client.from('sync_errors').insert({
    sync_job_id: jobId,
    entity_type: entityType,
    external_id: String(record.externalId ?? record.matchExternalId ?? '').slice(0, 255) || null,
    error_code: code.slice(0, 100),
    error_message: message.slice(0, 1000) || 'Unknown sync error',
    payload: sanitize(payload) as Record<string, unknown>,
  });
}

async function finishJob(
  client: DbClient,
  jobId: string,
  counters: { processed: number; created: number; updated: number; failed: number },
): Promise<string> {
  const status =
    counters.failed === 0 ? 'completed' : counters.created + counters.updated > 0 ? 'partial' : 'failed';
  const errorMessage =
    status === 'completed'
      ? null
      : `${counters.failed} of ${counters.processed} records failed`;
  await client
    .from('sync_jobs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      records_processed: counters.processed,
      records_created: counters.created,
      records_updated: counters.updated,
      records_failed: counters.failed,
      error_message: errorMessage,
    })
    .eq('id', jobId);
  return status;
}

const INVALIDATORS: Record<string, Array<() => Promise<unknown>>> = {
  countries: [() => searchService.invalidate()],
  venues: [() => teamsService.invalidate(), () => searchService.invalidate()],
  competitions: [() => competitionsService.invalidate(), () => searchService.invalidate()],
  seasons: [() => competitionsService.invalidate(), () => searchService.invalidate()],
  teams: [() => teamsService.invalidate(), () => searchService.invalidate()],
  players: [() => playersService.invalidate(), () => searchService.invalidate()],
  matches: [() => matchesService.invalidate(), () => searchService.invalidate()],
  events: [() => matchesService.invalidate(), () => searchService.invalidate()],
  lineups: [() => matchesService.invalidate(), () => searchService.invalidate()],
  'team-stats': [() => matchesService.invalidate(), () => searchService.invalidate()],
  'player-stats': [() => matchesService.invalidate(), () => searchService.invalidate()],
  transfers: [() => transfersService.invalidate(), () => searchService.invalidate()],
};

/**
 * Callable sync service for future workers/cron. Creates a sync_jobs row,
 * runs queued → running → completed/partial/failed, and records per-record
 * failures in sync_errors without aborting the job.
 */
export async function runSync(request: SyncRequest): Promise<SyncSummary> {
  const client = serviceClient();
  if (!request.dataSource) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'dataSource is required');
  }
  const dataSource = await getDataSource(client, request.dataSource);
  if (!dataSource.is_active) throw conflict('Data source is disabled');

  const entityType = request.entityType ?? 'teams';
  let jobId: string;
  if (request.jobId) {
    jobId = request.jobId;
  } else {
    const { data: jobRows, error: jobError } = await client
      .from('sync_jobs')
      .insert({ data_source_id: dataSource.id, job_type: request.jobType, entity_type: entityType, status: 'queued' })
      .select('id');
    if (jobError || !jobRows?.length) throw upstream('Sync job creation failed');
    jobId = String((jobRows as Array<{ id: string }>)[0].id);
  }

  const counters = { processed: 0, created: 0, updated: 0, failed: 0 };
  const startedAt = Date.now();
  const ctx: PersistContext = { client, dataSourceId: dataSource.id };
  const caches = { eventKeys: new Map<string, Set<string>>() };

  async function failJobLifecycle(message: string): Promise<SyncSummary> {
    await client
      .from('sync_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        records_processed: counters.processed,
        records_created: counters.created,
        records_updated: counters.updated,
        records_failed: counters.failed,
        error_message: message.slice(0, 1000),
      })
      .eq('id', jobId);
    log({ msg: 'sync_failed', jobId, entityType, durationMs: Date.now() - startedAt });
    return { jobId, status: 'failed', ...counters };
  }

  try {
    await client.from('sync_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', jobId);
    const adapter = request.adapter ?? (await adapterForDataSource(dataSource));
    const fetch = FETCHERS[entityType];
    let records: unknown[] | null;
    try {
      records = (await fetch?.(adapter, request.params)) ?? null;
    } catch (error) {
      if (request.fetchErrorMode === 'throw') throw error;
      const message = error instanceof Error ? error.message : 'Provider fetch failed';
      return failJobLifecycle(message);
    }
    if (!records) {
      return failJobLifecycle(`Provider does not support '${entityType}'`);
    }
    const bounded = records.slice(0, Math.min(request.limit ?? 500, 2000));
    const schema = SCHEMAS[entityType];
    const batchSize = Math.min(Math.max(request.batchSize ?? 100, 10), 500);
    const isCancelled = async (): Promise<boolean> => {
      const { data } = await client.from('sync_jobs').select('cancel_requested').eq('id', jobId).maybeSingle();
      return (data as { cancel_requested?: boolean } | null)?.cancel_requested === true;
    };
    for (let offset = 0; offset < bounded.length; offset += batchSize) {
      if (offset > 0 && (await isCancelled())) {
        return failJobLifecycle('Cancelled by operator');
      }
      const chunk = bounded.slice(offset, offset + batchSize) as Array<Record<string, unknown>>;
      const chunkCtx: PersistContext = { ...ctx, prefetch: new Map() };
      await prefetchChunk(chunkCtx, entityType, chunk);
      for (const payload of chunk) {
        counters.processed += 1;
        const validated = validateRecord(schema, payload);
        if (!validated.ok) {
          counters.failed += 1;
          await recordFailure(client, jobId, entityType, payload, validated.failure.code, validated.failure.message);
          continue;
        }
        try {
          const outcome = await persistRecord(chunkCtx, entityType, validated.data as Record<string, unknown>, caches);
          if (outcome === 'created') counters.created += 1;
          else if (outcome === 'updated') counters.updated += 1;
        } catch (error) {
          counters.failed += 1;
          const code =
            error instanceof MappingConflictError
              ? 'MAPPING_CONFLICT'
              : error instanceof RecordSyncError
                ? error.code
                : 'DATABASE_ERROR';
          const message = error instanceof Error ? error.message : 'Persistence failed';
          await recordFailure(client, jobId, entityType, payload, code, message);
        }
      }
    }
    const status = await finishJob(client, jobId, counters);
    if (status !== 'failed') {
      for (const invalidate of INVALIDATORS[entityType] ?? []) {
        await invalidate().catch(() => undefined);
      }
    }
    log({
      msg: 'sync_complete',
      jobId,
      entityType,
      status,
      ...counters,
      durationMs: Date.now() - startedAt,
    });
    return { jobId, status, ...counters };
  } catch (error) {
    counters.failed += 1;
    const message = error instanceof Error ? error.message : 'Sync failed';
    await client
      .from('sync_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        records_processed: counters.processed,
        records_created: counters.created,
        records_updated: counters.updated,
        records_failed: counters.failed,
        error_message: message.slice(0, 1000),
      })
      .eq('id', jobId);
    log({ msg: 'sync_failed', jobId, entityType, durationMs: Date.now() - startedAt });
    if (error instanceof ApiError) throw error;
    throw upstream('Sync failed');
  }
}

/**
 * Per-entity dataset processors.
 *
 * Every processor follows prepare → apply: prepare() transforms rows,
 * validates foreign keys against warmed in-memory maps and classifies each
 * record (create / update / skip / quarantine) with read-only checks, while
 * apply() performs the writes through the existing `providers/persist`
 * functions. Dry runs execute prepare only, so the reported counts reflect
 * exactly what a live run would do.
 */
import type { DbClient } from '../lib/supabase';
import {
  findExisting,
  mappingCacheKey,
  persistCompetition,
  persistCountry,
  persistLineup,
  persistMatch,
  persistPlayer,
  persistPlayerStats,
  persistSeason,
  persistTeam,
  persistTeamStats,
  prefetchKey,
  slugForEntity,
} from '../providers/persist';
import type {
  NormalizedCompetition,
  NormalizedCountry,
  NormalizedLineup,
  NormalizedMatch,
  NormalizedPlayer,
  NormalizedPlayerStatistics,
  NormalizedSeason,
  NormalizedTeam,
  NormalizedTeamStatistics,
} from '../providers/types';
import { MappingCache, prefetchMappings } from './mappings';
import {
  coerceNumericString,
  deriveSeason,
  deriveSubstitute,
  mapCountryCode,
  mapMatchStatus,
  normalizePositionCode,
  seasonExternalId,
  shallowEqual,
  splitName,
  toExternalId,
  toFloat,
  toInstantUtc,
  toInt,
  toText,
} from './normalize';
import { QuarantineCode, type QuarantineSink } from './quarantine';
import type { DatasetFile, DatasetPhase } from './types';
import type { DatasetRow } from './reader';
import type { PersistContext } from '../providers/persist';

export interface Counters {
  created: number;
  updated: number;
  skipped: number;
  quarantined: number;
  failed: number;
}

export function emptyCounters(): Counters {
  return { created: 0, updated: 0, skipped: 0, quarantined: 0, failed: 0 };
}

export interface PhaseContext {
  client: DbClient;
  dataSourceId: string;
  dryRun: boolean;
  file: DatasetFile;
  phase: DatasetPhase;
  sink: QuarantineSink;
  mappings: MappingCache;
  persist: PersistContext;
  counters: Counters;
}

type Row = Record<string, unknown>;

async function quarantine(
  ctx: PhaseContext,
  entityType: string,
  sourceId: string,
  code: string,
  reason: string,
  record: Row,
): Promise<void> {
  ctx.counters.quarantined += 1;
  await ctx.sink.quarantine({ file: ctx.file, entityType, sourceId, code, reason, record });
}

/** Seed the persist prefetch cache with a fully-known lookup (never partial). */
function rememberRow(ctx: PhaseContext, table: string, cacheValue: string, row: Row | null): void {
  ctx.persist.prefetch?.set(prefetchKey(table, cacheValue), row);
}

function rememberMapping(ctx: PhaseContext, entityType: string, externalId: string, id: string | null): void {
  ctx.mappings.set(entityType, externalId, id);
  ctx.persist.prefetch?.set(mappingCacheKey(ctx.dataSourceId, entityType, externalId), id ? { id } : null);
}

async function findBySlug(
  ctx: PhaseContext,
  table: string,
  slug: string,
  columns: string,
): Promise<Row | null> {
  const { data, error } = await ctx.client.from(table).select(columns).eq('slug', slug).maybeSingle();
  if (error) throw new Error(`Slug lookup failed on ${table}: ${error.message}`);
  const row = (data as Row | null) ?? null;
  rememberRow(ctx, table, slug, row);
  return row;
}

/** Generic create/update/skip classification for slug-keyed entities. */
async function classifyBySlug(
  ctx: PhaseContext,
  entityType: string,
  externalId: string,
  table: string,
  slug: string,
  expected: Row,
  compareKeys: string[],
): Promise<{ action: 'create' | 'update' | 'skip'; existingId: string | null }> {
  if (ctx.mappings.isPlanned(entityType, externalId)) {
    // Dry-run placeholder: this run decided the row will be created.
    return { action: 'create', existingId: null };
  }
  const mapped = ctx.mappings.get(entityType, externalId);
  if (mapped) {
    const { data, error } = await ctx.client.from(table).select('id').eq('id', mapped).maybeSingle();
    if (error) throw new Error(`Lookup failed on ${table}: ${error.message}`);
    if (data) {
      const full = await fetchById(ctx, table, String((data as { id: string }).id));
      if (full && shallowEqual(full, expected, compareKeys)) return { action: 'skip', existingId: String(mapped) };
      return { action: 'update', existingId: String(mapped) };
    }
    return { action: 'create', existingId: null };
  }
  if (mapped === null) {
    // Known absent from an earlier prefetch — but the slug may still collide
    // (e.g. seed rows); fall through to the slug check below.
  }
  const existing = await findBySlug(ctx, table, slug, 'id');
  if (!existing) return { action: 'create', existingId: null };
  const full = await fetchById(ctx, table, String(existing.id));
  if (full && shallowEqual(full, expected, compareKeys)) return { action: 'skip', existingId: String(existing.id) };
  return { action: 'update', existingId: String(existing.id) };
}

async function fetchById(ctx: PhaseContext, table: string, id: string): Promise<Row | null> {
  const { data, error } = await ctx.client.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Lookup failed on ${table}: ${error.message}`);
  return (data as Row | null) ?? null;
}

/** Warm one entity type for a batch of external ids (mappings + nothing else). */
export async function warmEntity(
  ctx: PhaseContext,
  entityType: 'competition' | 'season' | 'team' | 'player' | 'match' | 'country' | 'venue',
  externalIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set(externalIds.filter((v): v is string => typeof v === 'string' && v.length > 0))];
  if (ids.length === 0) return;
  await prefetchMappings(ctx.client, ctx.dataSourceId, entityType, ids, ctx.mappings);
  for (const id of ids) {
    const hit = ctx.mappings.get(entityType, id);
    if (hit !== undefined) ctx.persist.prefetch?.set(mappingCacheKey(ctx.dataSourceId, entityType, id), hit ? { id: hit } : null);
  }
}

/* ── Reference: countries ─────────────────────────────────────────── */

export async function processCountries(ctx: PhaseContext, countryNames: string[]): Promise<void> {
  const seen = new Map<string, string>();
  for (const name of countryNames) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const key = name.trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, name.trim());
  }
  for (const [key, name] of seen) {
    const code = mapCountryCode(name);
    if (!code) continue; // "World" and unknowns: no country row, competitions keep NULL.
    void key;
    const dto: NormalizedCountry = { externalId: `country:${code}`, name, code };
    const slug = slugForEntity('countries', dto as unknown as Record<string, unknown>);
    const expected = { code, name };
    const decision = await classifyBySlug(ctx, 'country', dto.externalId, 'countries', slug, expected, ['code', 'name']);
    if (decision.action === 'skip') {
      ctx.counters.skipped += 1;
      continue;
    }
    if (ctx.dryRun) {
      if (decision.action === 'create') ctx.mappings.plan('country', dto.externalId);
      ctx.counters[decision.action === 'create' ? 'created' : 'updated'] += 1;
      continue;
    }
    const outcome = await persistCountry(ctx.persist, dto);
    rememberMapping(ctx, 'country', dto.externalId, outcome.id);
    ctx.counters[outcome.status === 'created' ? 'created' : 'updated'] += 1;
  }
}

/* ── Reference: competitions ──────────────────────────────────────── */

export interface LeagueCatalogueEntry {
  apiId: number | null;
  datasetLeagueId: number | null;
  type: string | null;
}

export async function processCompetitions(
  ctx: PhaseContext,
  rows: DatasetRow[],
  catalogueByApiId: Map<number, LeagueCatalogueEntry>,
  catalogueByDatasetId: Map<number, LeagueCatalogueEntry>,
): Promise<void> {
  const dtos: Array<{ dto: NormalizedCompetition; row: DatasetRow; extId: string }> = [];
  for (const row of rows) {
    const extId = toExternalId(row.id);
    const name = toText(row.name, 150);
    if (!extId) {
      await quarantine(ctx, 'competition', String(row.id ?? '?'), QuarantineCode.MISSING_EXTERNAL_ID, 'league row without id', row as Row);
      continue;
    }
    if (!name) {
      await quarantine(ctx, 'competition', extId, QuarantineCode.INVALID_NUMERIC, 'league row without name', row as Row);
      continue;
    }
    const apiId = typeof row.api_football_id === 'number' ? row.api_football_id : null;
    const entry = (apiId !== null ? catalogueByApiId.get(apiId) : undefined) ?? catalogueByDatasetId.get(Number(extId));
    const type = entry?.type === 'Cup' || entry?.type === 'League' ? entry.type : undefined;
    dtos.push({
      dto: { externalId: extId, name, countryCode: mapCountryCode(row.country) ?? undefined, type },
      row: row as Row,
      extId,
    });
  }
  for (const { dto, row, extId } of dtos) {
    const slug = slugForEntity('competitions', dto as unknown as Record<string, unknown>);
    const expected = { name: dto.name, type: dto.type ?? null };
    const decision = await classifyBySlug(ctx, 'competition', extId, 'competitions', slug, expected, ['name', 'type']);
    if (decision.action === 'skip') {
      ctx.counters.skipped += 1;
      continue;
    }
    if (ctx.dryRun) {
      if (decision.action === 'create') ctx.mappings.plan('competition', extId);
      ctx.counters[decision.action === 'create' ? 'created' : 'updated'] += 1;
      continue;
    }
    void row;
    const outcome = await persistCompetition(ctx.persist, dto);
    rememberMapping(ctx, 'competition', extId, outcome.id);
    ctx.counters[outcome.status === 'created' ? 'created' : 'updated'] += 1;
  }
}

/* ── Reference: seasons (synthetic) ───────────────────────────────── */

export async function processSeasons(ctx: PhaseContext, pairs: Array<{ leagueDatasetId: string; year: number }>): Promise<void> {
  const seen = new Set<string>();
  for (const { leagueDatasetId, year } of pairs) {
    const key = `${leagueDatasetId}|${year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const derived = deriveSeason(year);
    if (!derived) {
      await quarantine(ctx, 'season', `season:${leagueDatasetId}:${year}`, QuarantineCode.INVALID_NUMERIC, `calendar year ${year} out of range`, { leagueDatasetId, year });
      continue;
    }
    const competitionId = ctx.mappings.get('competition', leagueDatasetId);
    if (!competitionId) {
      await quarantine(ctx, 'season', `season:${leagueDatasetId}:${year}`, QuarantineCode.UNRESOLVED_COMPETITION, `competition ${leagueDatasetId} not imported`, { leagueDatasetId, year });
      continue;
    }
    const externalId = seasonExternalId(leagueDatasetId, year);
    const dto = { externalId, competitionExternalId: leagueDatasetId, name: derived.name, startDate: derived.startDate, endDate: derived.endDate };
    const existing = await findExisting(ctx.client, 'seasons', 'id,name,start_date,end_date', [
      ['competition_id', competitionId],
      ['name', derived.name],
    ]);
    if (existing && shallowEqual(existing, { name: derived.name, start_date: derived.startDate, end_date: derived.endDate }, ['name', 'start_date', 'end_date'])) {
      ctx.counters.skipped += 1;
      rememberMapping(ctx, 'season', externalId, String(existing.id));
      continue;
    }
    if (ctx.dryRun) {
      if (!existing) ctx.mappings.plan('season', externalId);
      ctx.counters[existing ? 'updated' : 'created'] += 1;
      continue;
    }
    const { persistSeason } = await import('../providers/persist');
    const outcome = await persistSeason(ctx.persist, dto, competitionId);
    rememberMapping(ctx, 'season', externalId, outcome.id);
    ctx.counters[outcome.status === 'created' ? 'created' : 'updated'] += 1;
  }
}

/* ── Reference: teams ─────────────────────────────────────────────── */

export async function processTeams(ctx: PhaseContext, rows: DatasetRow[]): Promise<void> {
  const seenExt = new Set<string>();
  for (const row of rows) {
    const extId = toExternalId(row.id);
    const name = toText(row.name, 150);
    if (!extId) {
      await quarantine(ctx, 'team', '?', QuarantineCode.MISSING_EXTERNAL_ID, 'team row without id', row as Row);
      continue;
    }
    if (seenExt.has(extId)) {
      await quarantine(ctx, 'team', extId, QuarantineCode.DUPLICATE_EXTERNAL_ID, 'duplicate team id within batch', row as Row);
      continue;
    }
    seenExt.add(extId);
    if (!name) {
      await quarantine(ctx, 'team', extId, QuarantineCode.INVALID_NUMERIC, 'team row without name', row as Row);
      continue;
    }
    const dto = { externalId: extId, name };
    const slug = slugForEntity('teams', dto as unknown as Record<string, unknown>);
    const decision = await classifyBySlug(ctx, 'team', extId, 'teams', slug, { name }, ['name']);
    if (decision.action === 'skip') {
      ctx.counters.skipped += 1;
      continue;
    }
    if (ctx.dryRun) {
      if (decision.action === 'create') ctx.mappings.plan('team', extId);
      ctx.counters[decision.action === 'create' ? 'created' : 'updated'] += 1;
      continue;
    }
    const outcome = await persistTeam(ctx.persist, dto);
    rememberMapping(ctx, 'team', extId, outcome.id);
    ctx.counters[outcome.status === 'created' ? 'created' : 'updated'] += 1;
  }
}

/* ── Reference: players ───────────────────────────────────────────── */

export async function processPlayers(ctx: PhaseContext, rows: DatasetRow[]): Promise<void> {
  const seenExt = new Set<string>();
  for (const row of rows) {
    const extId = toExternalId(row.id);
    const displayName = toText(row.name, 150);
    if (!extId) {
      await quarantine(ctx, 'player', '?', QuarantineCode.MISSING_EXTERNAL_ID, 'player row without id', row as Row);
      continue;
    }
    if (seenExt.has(extId)) {
      await quarantine(ctx, 'player', extId, QuarantineCode.DUPLICATE_EXTERNAL_ID, 'duplicate player id within batch', row as Row);
      continue;
    }
    seenExt.add(extId);
    if (!displayName) {
      await quarantine(ctx, 'player', extId, QuarantineCode.INVALID_NUMERIC, 'player row without name', row as Row);
      continue;
    }
    const { firstName, lastName } = splitName(displayName);
    const photo = typeof row.photo === 'string' && /^https?:\/\//.test(row.photo.trim()) ? row.photo.trim().slice(0, 500) : undefined;
    const dto = { externalId: extId, displayName, firstName, lastName, photoUrl: photo };
    const slug = slugForEntity('players', dto as unknown as Record<string, unknown>);
    const decision = await classifyBySlug(ctx, 'player', extId, 'players', slug, { display_name: displayName }, ['display_name']);
    if (decision.action === 'skip') {
      ctx.counters.skipped += 1;
      continue;
    }
    if (ctx.dryRun) {
      if (decision.action === 'create') ctx.mappings.plan('player', extId);
      ctx.counters[decision.action === 'create' ? 'created' : 'updated'] += 1;
      continue;
    }
    const outcome = await persistPlayer(ctx.persist, dto);
    rememberMapping(ctx, 'player', extId, outcome.id);
    ctx.counters[outcome.status === 'created' ? 'created' : 'updated'] += 1;
  }
}

/* ── Relationships: team_competitions ─────────────────────────────── */

export async function processTeamCompetitions(
  ctx: PhaseContext,
  triples: Array<{ teamDatasetId: string; leagueDatasetId: string; year: number }>,
): Promise<void> {
  const seen = new Set<string>();
  for (const triple of triples) {
    const key = `${triple.teamDatasetId}|${triple.leagueDatasetId}|${triple.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const teamId = ctx.mappings.get('team', triple.teamDatasetId);
    const competitionId = ctx.mappings.get('competition', triple.leagueDatasetId);
    const seasonId = ctx.mappings.get('season', seasonExternalId(triple.leagueDatasetId, triple.year));
    if (!teamId) {
      await quarantine(ctx, 'team_competition', triple.teamDatasetId, QuarantineCode.UNRESOLVED_TEAM, 'team not imported', triple as unknown as Row);
      continue;
    }
    if (!competitionId) {
      await quarantine(ctx, 'team_competition', triple.leagueDatasetId, QuarantineCode.UNRESOLVED_COMPETITION, 'competition not imported', triple as unknown as Row);
      continue;
    }
    if (!seasonId) {
      await quarantine(ctx, 'team_competition', key, QuarantineCode.UNRESOLVED_SEASON, 'season not imported', triple as unknown as Row);
      continue;
    }
    const existing = await findExisting(ctx.client, 'team_competitions', 'team_id', [
      ['team_id', teamId],
      ['competition_id', competitionId],
      ['season_id', seasonId],
    ]);
    if (existing) {
      ctx.counters.skipped += 1;
      continue;
    }
    if (ctx.dryRun) {
      ctx.counters.created += 1;
      continue;
    }
    const { error } = await ctx.client.from('team_competitions').insert({ team_id: teamId, competition_id: competitionId, season_id: seasonId });
    if (error) {
      await quarantine(ctx, 'team_competition', key, QuarantineCode.DB_ERROR, `insert failed: ${error.message}`, triple as unknown as Row);
      continue;
    }
    ctx.counters.created += 1;
  }
}

/* ── Matches ──────────────────────────────────────────────────────── */

export interface PreparedMatch {
  dto: NormalizedMatch;
  ids: { competitionId: string; seasonId: string | null; venueId: null; homeId: string; awayId: string };
  sourceId: string;
  expected: Row;
}

const MATCH_COMPARE_KEYS = ['competition_id', 'season_id', 'home_team_id', 'away_team_id', 'scheduled_at', 'status', 'home_score', 'away_score', 'home_score_ht', 'away_score_ht', 'referee_name'];

export async function prepareMatch(
  ctx: PhaseContext,
  row: DatasetRow,
  halfTime: { home: number | null; away: number | null },
): Promise<{ action: 'create' | 'update' | 'skip' | 'quarantine'; prepared?: PreparedMatch; reason?: string; code?: string }> {
  const sourceId = toExternalId(row.id);
  if (!sourceId) return { action: 'quarantine', code: QuarantineCode.MISSING_EXTERNAL_ID, reason: 'fixture without id' };
  const homeExt = toExternalId(row.home_team_id);
  const awayExt = toExternalId(row.away_team_id);
  const compExt = toExternalId(row.league_id);
  if (!homeExt || !awayExt || !compExt) {
    return { action: 'quarantine', code: QuarantineCode.UNRESOLVED_TEAM, reason: 'fixture missing team/competition reference' };
  }
  const mapped = ctx.mappings.get('match', sourceId);
  const competitionId = ctx.mappings.get('competition', compExt);
  const homeId = ctx.mappings.get('team', homeExt);
  const awayId = ctx.mappings.get('team', awayExt);
  if (!competitionId) return { action: 'quarantine', code: QuarantineCode.UNRESOLVED_COMPETITION, reason: `competition ${compExt} not imported` };
  if (!homeId || !awayId) return { action: 'quarantine', code: QuarantineCode.UNRESOLVED_TEAM, reason: 'home/away team not imported' };
  const statusOutcome = mapMatchStatus(row.status_norm);
  if (statusOutcome.kind === 'quarantine') return { action: 'quarantine', code: QuarantineCode.INVALID_STATUS, reason: statusOutcome.reason };
  const scheduledAt = toInstantUtc(row.date_utc);
  if (!scheduledAt) return { action: 'quarantine', code: QuarantineCode.INVALID_TIMESTAMP, reason: 'unparseable date_utc' };
  const year = new Date(scheduledAt).getUTCFullYear();
  const seasonId = ctx.mappings.get('season', seasonExternalId(compExt, year)) ?? null;
  const dto: NormalizedMatch = {
    externalId: sourceId,
    competitionExternalId: compExt,
    homeTeamExternalId: homeExt,
    awayTeamExternalId: awayExt,
    scheduledAt,
    status: statusOutcome.status,
    homeScore: toInt(row.goals_home, 0, 99) ?? undefined,
    awayScore: toInt(row.goals_away, 0, 99) ?? undefined,
    homeScoreHt: halfTime.home ?? undefined,
    awayScoreHt: halfTime.away ?? undefined,
    refereeName: toText(row.referee_name, 150) ?? undefined,
  };
  const expected: Row = {
    competition_id: competitionId,
    season_id: seasonId,
    home_team_id: homeId,
    away_team_id: awayId,
    scheduled_at: scheduledAt,
    status: dto.status,
    home_score: dto.homeScore ?? null,
    away_score: dto.awayScore ?? null,
    home_score_ht: dto.homeScoreHt ?? null,
    away_score_ht: dto.awayScoreHt ?? null,
    referee_name: dto.refereeName ?? null,
  };
  if (mapped) {
    const full = await fetchById(ctx, 'matches', mapped);
    if (full && shallowEqual(full, expected, MATCH_COMPARE_KEYS)) return { action: 'skip' };
    if (full) return { action: 'update', prepared: { dto, ids: { competitionId, seasonId, venueId: null, homeId, awayId }, sourceId, expected } };
    return { action: 'create', prepared: { dto, ids: { competitionId, seasonId, venueId: null, homeId, awayId }, sourceId, expected } };
  }
  const slug = slugForEntity('matches', {
    homeTeamExternalId: homeExt,
    awayTeamExternalId: awayExt,
    scheduledAt,
    externalId: sourceId,
  });
  const existing = await findBySlug(ctx, 'matches', slug, 'id');
  if (!existing) return { action: 'create', prepared: { dto, ids: { competitionId, seasonId, venueId: null, homeId, awayId }, sourceId, expected } };
  const full = await fetchById(ctx, 'matches', String(existing.id));
  if (full && shallowEqual(full, expected, MATCH_COMPARE_KEYS)) return { action: 'skip' };
  return { action: 'update', prepared: { dto, ids: { competitionId, seasonId, venueId: null, homeId, awayId }, sourceId, expected } };
}

export async function applyMatch(ctx: PhaseContext, prepared: PreparedMatch): Promise<'created' | 'updated'> {
  const outcome = await persistMatch(ctx.persist, prepared.dto, prepared.ids);
  rememberMapping(ctx, 'match', prepared.sourceId, outcome.id);
  return outcome.status === 'created' ? 'created' : 'updated';
}

/* ── Lineups ──────────────────────────────────────────────────────── */

export interface LineupPlayerInput {
  playerExternalId: string;
  position?: string;
  shirtNumber?: number;
  starter: boolean;
  captain: boolean;
  minutes: number | null;
  rating: number | null;
}

export async function prepareLineupPlayers(
  ctx: PhaseContext,
  file: DatasetFile,
  players: LineupPlayerInput[],
): Promise<{ players: NormalizedLineup['players']; quarantined: number }> {
  const kept: NormalizedLineup['players'] = [];
  let quarantined = 0;
  for (const entry of players) {
    const playerId = ctx.mappings.get('player', entry.playerExternalId);
    if (!playerId) {
      quarantined += 1;
      await ctx.sink.quarantine({
        file,
        entityType: 'match_lineup_player',
        sourceId: entry.playerExternalId,
        code: QuarantineCode.UNRESOLVED_PLAYER,
        reason: `player ${entry.playerExternalId} not imported`,
        record: entry as unknown as Row,
      });
      continue;
    }
    kept.push({
      playerExternalId: entry.playerExternalId,
      position: entry.position,
      shirtNumber: entry.shirtNumber,
      starter: entry.starter,
      captain: entry.captain,
      substitute: deriveSubstitute(entry.starter, entry.minutes, entry.rating),
      minutesPlayed: entry.minutes ?? undefined,
    });
  }
  return { players: kept, quarantined };
}

export async function applyLineup(
  ctx: PhaseContext,
  dto: NormalizedLineup,
  ids: { matchId: string; teamId: string },
): Promise<'created' | 'updated'> {
  const outcome = await persistLineup(ctx.persist, dto, ids);
  return outcome.status === 'created' ? 'created' : 'updated';
}

/* ── Team stats ───────────────────────────────────────────────────── */

const TEAM_STAT_COMPARE = ['possession', 'shots', 'shots_on_target', 'corners', 'fouls', 'offsides', 'yellow_cards', 'red_cards', 'passes', 'pass_accuracy'];

export function buildTeamStatDto(
  row: DatasetRow,
  side: 'home' | 'away',
  prefix: string,
): { dto: Omit<NormalizedTeamStatistics, 'matchExternalId' | 'teamExternalId'>; expected: Row } | { quarantine: string } {
  const num = (key: string, min: number, max: number): number | null => {
    const value = row[`${prefix}${key}`];
    if (value === null || value === undefined) return null;
    return toFloat(value, min, max);
  };
  const rangeOrQuarantine = (key: string, min: number, max: number): number | null | string => {
    const value = row[`${prefix}${key}`];
    if (value === null || value === undefined) return null;
    const n = toFloat(value, min, max);
    return n === null ? `${prefix}${key} out of range` : n;
  };
  // Zone-split 0/0 contradicting a positive total means "unknown", not zero.
  let inside: number | null = num('shots_inside_box', 0, 100000);
  let outside: number | null = num('shots_outside_box', 0, 100000);
  const total = num('shots_total', 0, 100000);
  if (inside === 0 && outside === 0 && total !== null && total > 0) {
    inside = null;
    outside = null;
  }
  void side;
  const possession = rangeOrQuarantine('possession', 0, 100);
  if (typeof possession === 'string') return { quarantine: possession };
  const passAccuracy = rangeOrQuarantine('pass_accuracy', 0, 100);
  if (typeof passAccuracy === 'string') return { quarantine: passAccuracy };
  const metadata: Record<string, unknown> = {};
  if (inside !== null || outside !== null) {
    if (inside !== null) metadata.shots_inside_box = inside;
    if (outside !== null) metadata.shots_outside_box = outside;
  }
  const blocked = num('blocked_shots', 0, 100000);
  if (blocked !== null) metadata.blocked_shots = blocked;
  const penalties = num('penalties', 0, 100000);
  if (penalties !== null) metadata.penalties = penalties;
  const xg = typeof row[`${prefix}xg`] === 'number' && Number.isFinite(row[`${prefix}xg`]) ? (row[`${prefix}xg` ] as number) : null;
  if (xg !== null) {
    metadata.xg_provider_estimate = xg;
    metadata.xg_covered = row.xg_covered === true;
  }
  const dto = {
    possession: possession ?? undefined,
    shots: total ?? undefined,
    shotsOnTarget: num('shots_on_goal', 0, 100000) ?? undefined,
    corners: num('corners', 0, 100000) ?? undefined,
    fouls: num('fouls', 0, 100000) ?? undefined,
    offsides: num('offsides', 0, 100000) ?? undefined,
    yellowCards: num('yellow_cards', 0, 100000) ?? undefined,
    redCards: num('red_cards', 0, 100000) ?? undefined,
    passes: undefined,
    passAccuracy: passAccuracy ?? undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
  const expected: Row = {
    possession: dto.possession ?? null,
    shots: dto.shots ?? null,
    shots_on_target: dto.shotsOnTarget ?? null,
    corners: dto.corners ?? null,
    fouls: dto.fouls ?? null,
    offsides: dto.offsides ?? null,
    yellow_cards: dto.yellowCards ?? null,
    red_cards: dto.redCards ?? null,
    passes: null,
    pass_accuracy: dto.passAccuracy ?? null,
  };
  return { dto, expected };
}

/* ── Player stats ─────────────────────────────────────────────────── */

const PLAYER_STAT_COMPARE = ['minutes', 'goals', 'assists', 'shots', 'shots_on_target', 'passes', 'pass_accuracy', 'tackles', 'interceptions', 'yellow_cards', 'red_cards', 'rating'];

export function buildPlayerStatDto(row: DatasetRow): { dto: Omit<NormalizedPlayerStatistics, 'matchExternalId' | 'teamExternalId' | 'playerExternalId'>; expected: Row } | { quarantine: string } {
  const bad: string[] = [];
  const req = (key: string, min: number, max: number, opts?: { stringOk?: boolean }): number | null => {
    const raw = row[key];
    if (raw === null || raw === undefined || raw === '') return null;
    const value = opts?.stringOk ? coerceNumericString(raw, min, max) : toFloat(raw, min, max);
    if (value === null) bad.push(key);
    return value;
  };
  const minutes = req('games_minutes', 0, 150, { stringOk: true });
  const rating = req('games_rating', 0, 10, { stringOk: true });
  const passAccuracy = req('passes_accuracy', 0, 100, { stringOk: true });
  const goals = req('goals_total', 0, 999);
  const assists = req('goals_assists', 0, 999);
  const shots = req('shots_total', 0, 999);
  const shotsOn = req('shots_on', 0, 999);
  const passes = req('passes_total', 0, 100000);
  const tackles = req('tackles_total', 0, 999);
  const interceptions = req('tackles_interceptions', 0, 999);
  const yellow = req('cards_yellow', 0, 99);
  const red = req('cards_red', 0, 99);
  if (bad.length > 0) return { quarantine: `invalid numerics: ${bad.join(', ')}` };
  const pick = (key: string): number | null => {
    const raw = row[key];
    if (raw === null || raw === undefined) return null;
    const n = toFloat(raw, 0, 100000);
    return n;
  };
  const metadata: Record<string, unknown> = {};
  for (const [key, out] of [
    ['duels_total', 'duels_total'], ['duels_won', 'duels_won'],
    ['dribbles_attempts', 'dribbles_attempts'], ['dribbles_success', 'dribbles_success'], ['dribbles_past', 'dribbles_past'],
    ['fouls_committed', 'fouls_committed'], ['fouls_drawn', 'fouls_drawn'],
    ['goals_saves', 'saves'], ['offsides', 'offsides'], ['passes_key', 'key_passes'],
    ['tackles_blocks', 'blocks'], ['goals_conceded', 'conceded'],
    ['penalty_commited', 'penalty_committed'], ['penalty_won', 'penalty_won'],
    ['penalty_saved', 'penalty_saved'], ['penalty_missed', 'penalty_missed'], ['penalty_scored', 'penalty_scored'],
  ] as const) {
    const v = pick(key);
    if (v !== null) metadata[out] = v;
  }
  for (const [key, out] of [['games_captain', 'captain'], ['games_substitute', 'substitute'], ['games_number', 'shirt_number'], ['games_position', 'position']] as const) {
    const v = row[key];
    if (v !== null && v !== undefined && v !== '') metadata[out] = typeof v === 'string' ? v : Number(v);
  }
  const dto = {
    minutes: minutes ?? undefined,
    goals: goals ?? undefined,
    assists: assists ?? undefined,
    shots: shots ?? undefined,
    shotsOnTarget: shotsOn ?? undefined,
    passes: passes ?? undefined,
    passAccuracy: passAccuracy ?? undefined,
    tackles: tackles ?? undefined,
    interceptions: interceptions ?? undefined,
    clearances: undefined,
    yellowCards: yellow ?? undefined,
    redCards: red ?? undefined,
    rating: rating ?? undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
  const expected: Row = {
    minutes: dto.minutes ?? null,
    goals: dto.goals ?? null,
    assists: dto.assists ?? null,
    shots: dto.shots ?? null,
    shots_on_target: dto.shotsOnTarget ?? null,
    passes: dto.passes ?? null,
    pass_accuracy: dto.passAccuracy ?? null,
    tackles: dto.tackles ?? null,
    interceptions: dto.interceptions ?? null,
    yellow_cards: dto.yellowCards ?? null,
    red_cards: dto.redCards ?? null,
    rating: dto.rating ?? null,
  };
  return { dto, expected };
}

export { PLAYER_STAT_COMPARE, TEAM_STAT_COMPARE };

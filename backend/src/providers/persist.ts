import { badRequest, upstream } from '../lib/errors';
import type { DbClient } from '../lib/supabase';
import { saveMapping } from './externalIds';
import { slugify } from './normalize';
import type {
  NormalizedCompetition,
  NormalizedCountry,
  NormalizedLineup,
  NormalizedMatch,
  NormalizedMatchEvent,
  NormalizedPlayer,
  NormalizedPlayerStatistics,
  NormalizedSeason,
  NormalizedTeam,
  NormalizedTeamStatistics,
  NormalizedTransfer,
  NormalizedVenue,
} from './types';

export interface PersistContext {
  client: DbClient;
  dataSourceId: string;
  /**
   * Optional chunk prefetch to avoid N+1 lookups during bulk imports.
   * Key format: `${table}:${uniqueValue}` (e.g. `teams:fc-example`).
   * A stored `null` means "known absent" — no repeat lookup.
   */
  prefetch?: Map<string, Row | null>;
}

export function prefetchKey(table: string, uniqueValue: string): string {
  return `${table}:${uniqueValue}`;
}

export type PersistStatus = 'created' | 'updated' | 'skipped';

export interface PersistOutcome {
  status: PersistStatus;
  id: string;
}

/** Record-level failure with a stable machine-readable code. */
export class RecordSyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RecordSyncError';
  }
}

type Row = Record<string, unknown>;

function defined<T extends Row>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

export async function findExisting(
  client: DbClient,
  table: string,
  columns: string,
  filters: Array<[string, unknown]>,
): Promise<Row | null> {
  return findOne(client, table, columns, filters);
}

export function slugForEntity(entityType: string, dto: Record<string, unknown>): string {
  switch (entityType) {
    case 'teams':
      return slugify(String((dto.shortName ?? dto.name) ?? ''), String(dto.externalId ?? 'x'));
    case 'matches': {
      const date = String(dto.scheduledAt ?? '').slice(0, 10);
      return slugify(`${dto.homeTeamExternalId}-vs-${dto.awayTeamExternalId}-${date}`, String(dto.externalId ?? 'x'));
    }
    default:
      return slugify(String((dto.displayName ?? dto.name) ?? ''), String(dto.externalId ?? 'x'));
  }
}

async function findOne(
  client: DbClient,
  table: string,
  columns: string,
  filters: Array<[string, unknown]>,
): Promise<Row | null> {
  let query = client.from(table).select(columns);
  for (const [col, value] of filters) query = query.eq(col, value as never);
  const { data, error } = await query.maybeSingle();
  if (error) throw upstream(`Lookup failed on ${table}`);
  return (data as Row | null) ?? null;
}

async function insertOne(client: DbClient, table: string, row: Row): Promise<string> {
  const { data, error } = await client.from(table).insert(row).select('id');
  if (error) throw upstream(`Insert failed on ${table}`);
  const id = ((data as Array<{ id: string }> | null) ?? [])[0]?.id;
  if (!id) throw upstream(`Insert failed on ${table}`);
  return id;
}

/** Insert into tables without a single-column id (link tables). */
async function insertBlind(client: DbClient, table: string, row: Row): Promise<void> {
  const { error } = await client.from(table).insert(row);
  if (error) throw upstream(`Insert failed on ${table}`);
}

/** Chunk-prefetch-aware lookup: prefetch hit → DB → remember. */
async function findCached(
  ctx: PersistContext,
  table: string,
  columns: string,
  filters: Array<[string, unknown]>,
  cacheValue: string,
): Promise<Row | null> {
  if (ctx.prefetch) {
    const key = prefetchKey(table, cacheValue);
    if (ctx.prefetch.has(key)) return ctx.prefetch.get(key) ?? null;
    const row = await findOne(ctx.client, table, columns, filters);
    ctx.prefetch.set(key, row);
    return row;
  }
  return findOne(ctx.client, table, columns, filters);
}

function remember(ctx: PersistContext, table: string, cacheValue: string, row: Row | null): void {
  ctx.prefetch?.set(prefetchKey(table, cacheValue), row);
}

async function updateOne(client: DbClient, table: string, id: string, patch: Row): Promise<void> {
  const clean = defined(patch);
  if (Object.keys(clean).length === 0) return;
  const { error } = await client.from(table).update(clean).eq('id', id);
  if (error) throw upstream(`Update failed on ${table}`);
}

async function resolveCountryId(ctx: PersistContext, code?: string): Promise<string | null> {
  if (!code) return null;
  const row = await findOne(ctx.client, 'countries', 'id', [['code', code]]);
  return row ? String(row.id) : null;
}

/** Idempotent minimal country so team/player/competition rows keep valid FKs. */
async function ensureCountryId(ctx: PersistContext, code?: string): Promise<string | null> {
  if (!code) return null;
  const existing = await resolveCountryId(ctx, code);
  if (existing) return existing;
  return (await persistCountry(ctx, { externalId: `iso-${code}`, name: code, code })).id;
}

async function resolveMapping(
  ctx: PersistContext,
  entityType: string,
  externalId?: string,
): Promise<string | null> {
  if (!externalId) return null;
  // Bulk importers pre-seed these keys after batched IN-queries so repeated
  // references (team 995 in 100 fixtures) cost one lookup per run, not row.
  // Absent keys behave exactly as before (direct lookup).
  const cacheKey = mappingCacheKey(ctx.dataSourceId, entityType, externalId);
  if (ctx.prefetch?.has(cacheKey)) {
    const hit = ctx.prefetch.get(cacheKey);
    return hit ? String((hit as Row).id) : null;
  }
  const { lookupMapping } = await import('./externalIds');
  const id = await lookupMapping(ctx.client, ctx.dataSourceId, entityType, externalId);
  if (ctx.prefetch) ctx.prefetch.set(cacheKey, id ? { id } : null);
  return id;
}

/** Prefetch-cache key for external-id mappings (shared with bulk importers). */
export function mappingCacheKey(dataSourceId: string, entityType: string, externalId: string): string {
  return `mapping:${dataSourceId}:${entityType}:${externalId}`;
}

function requireMapping(
  resolved: string | null,
  entityType: string,
  externalId?: string,
): asserts resolved is string {
  if (!resolved) {
    throw new RecordSyncError(
      'INVALID_RELATIONSHIP',
      `Unresolved ${entityType} reference '${externalId ?? 'missing'}' — sync dependencies first`,
    );
  }
}

export async function persistCountry(ctx: PersistContext, dto: NormalizedCountry): Promise<PersistOutcome> {
  const slug = slugForEntity('countries', dto as unknown as Record<string, unknown>);
  const cacheValue = dto.code ?? slug;
  const existing = dto.code
    ? await findCached(ctx, 'countries', 'id', [['code', dto.code]], cacheValue)
    : await findCached(ctx, 'countries', 'id', [['slug', slug]], cacheValue);
  if (existing) {
    await updateOne(ctx.client, 'countries', String(existing.id), { name: dto.name });
    await saveMapping(ctx.client, ctx.dataSourceId, 'country', dto.externalId, String(existing.id));
    return { status: 'updated', id: String(existing.id) };
  }
  const id = await insertOne(ctx.client, 'countries', { code: dto.code ?? null, name: dto.name, slug });
  remember(ctx, 'countries', cacheValue, { id });
  await saveMapping(ctx.client, ctx.dataSourceId, 'country', dto.externalId, id);
  return { status: 'created', id };
}

export async function persistVenue(ctx: PersistContext, dto: NormalizedVenue): Promise<PersistOutcome> {
  const slug = slugForEntity('venues', dto as unknown as Record<string, unknown>);
  const countryId = await ensureCountryId(ctx, dto.countryCode);
  const existing = await findOne(ctx.client, 'venues', 'id', [['slug', slug]]);
  const row = defined({
    name: dto.name,
    slug,
    city: dto.city,
    country_id: countryId,
    capacity: dto.capacity,
    latitude: dto.latitude,
    longitude: dto.longitude,
  });
  if (existing) {
    await updateOne(ctx.client, 'venues', String(existing.id), row);
    await saveMapping(ctx.client, ctx.dataSourceId, 'venue', dto.externalId, String(existing.id));
    return { status: 'updated', id: String(existing.id) };
  }
  const id = await insertOne(ctx.client, 'venues', row);
  await saveMapping(ctx.client, ctx.dataSourceId, 'venue', dto.externalId, id);
  return { status: 'created', id };
}

export async function persistCompetition(
  ctx: PersistContext,
  dto: NormalizedCompetition,
): Promise<PersistOutcome> {
  const slug = slugForEntity('competitions', dto as unknown as Record<string, unknown>);
  const countryId = await ensureCountryId(ctx, dto.countryCode);
  const existing = await findCached(ctx, 'competitions', 'id', [['slug', slug]], slug);
  const row = defined({
    name: dto.name,
    short_name: dto.shortName,
    slug,
    country_id: countryId,
    logo_url: undefined,
    type: dto.type,
    gender: dto.gender,
  });
  if (existing) {
    await updateOne(ctx.client, 'competitions', String(existing.id), row);
    await saveMapping(ctx.client, ctx.dataSourceId, 'competition', dto.externalId, String(existing.id));
    return { status: 'updated', id: String(existing.id) };
  }
  const id = await insertOne(ctx.client, 'competitions', row);
  remember(ctx, 'competitions', slug, { id });
  await saveMapping(ctx.client, ctx.dataSourceId, 'competition', dto.externalId, id);
  return { status: 'created', id };
}

export async function persistSeason(
  ctx: PersistContext,
  dto: NormalizedSeason,
  competitionId: string,
): Promise<PersistOutcome> {
  const existing = await findOne(ctx.client, 'seasons', 'id', [
    ['competition_id', competitionId],
    ['name', dto.name],
  ]);
  const row = defined({ competition_id: competitionId, name: dto.name, start_date: dto.startDate, end_date: dto.endDate });
  if (existing) {
    await updateOne(ctx.client, 'seasons', String(existing.id), row);
    await saveMapping(ctx.client, ctx.dataSourceId, 'season', dto.externalId, String(existing.id));
    return { status: 'updated', id: String(existing.id) };
  }
  const id = await insertOne(ctx.client, 'seasons', row);
  await saveMapping(ctx.client, ctx.dataSourceId, 'season', dto.externalId, id);
  return { status: 'created', id };
}

export async function persistTeam(ctx: PersistContext, dto: NormalizedTeam): Promise<PersistOutcome> {
  const slug = slugForEntity('teams', dto as unknown as Record<string, unknown>);
  const countryId = await ensureCountryId(ctx, dto.countryCode);
  const venueId = await resolveMapping(ctx, 'venue', dto.venueExternalId);
  const existing = await findCached(ctx, 'teams', 'id', [['slug', slug]], slug);
  const row = defined({
    name: dto.name,
    short_name: dto.shortName,
    slug,
    country_id: countryId,
    logo_url: dto.logoUrl,
    founded_year: dto.foundedYear,
    venue_id: venueId,
  });
  let teamId: string;
  let status: PersistStatus;
  if (existing) {
    teamId = String(existing.id);
    await updateOne(ctx.client, 'teams', teamId, row);
    status = 'updated';
  } else {
    teamId = await insertOne(ctx.client, 'teams', row);
    remember(ctx, 'teams', slug, { id: teamId });
    status = 'created';
  }
  await saveMapping(ctx.client, ctx.dataSourceId, 'team', dto.externalId, teamId);
  await linkTeamCompetitions(ctx, teamId, dto);
  return { status, id: teamId };
}

/** Canonical team-competition-season links. Skipped (never failed) when season context is absent. */
async function linkTeamCompetitions(
  ctx: PersistContext,
  teamId: string,
  dto: NormalizedTeam,
): Promise<void> {
  if (!dto.competitionExternalIds?.length || !dto.seasonExternalId) return;
  const seasonId = await resolveMapping(ctx, 'season', dto.seasonExternalId);
  if (!seasonId) return;
  for (const competitionExternalId of dto.competitionExternalIds) {
    const competitionId = await resolveMapping(ctx, 'competition', competitionExternalId);
    if (!competitionId) continue;
    const link = await findOne(ctx.client, 'team_competitions', 'team_id', [
      ['team_id', teamId],
      ['competition_id', competitionId],
      ['season_id', seasonId],
    ]);
    if (!link) {
      await insertBlind(ctx.client, 'team_competitions', {
        team_id: teamId,
        competition_id: competitionId,
        season_id: seasonId,
      });
    }
  }
}

export async function persistPlayer(ctx: PersistContext, dto: NormalizedPlayer): Promise<PersistOutcome> {
  const slug = slugForEntity('players', dto as unknown as Record<string, unknown>);
  const nationalityId = await ensureCountryId(ctx, dto.nationalityCode);
  const existing = await findCached(ctx, 'players', 'id', [['slug', slug]], slug);
  const row = defined({
    first_name: dto.firstName,
    last_name: dto.lastName,
    display_name: dto.displayName,
    slug,
    date_of_birth: dto.dateOfBirth,
    nationality_id: nationalityId,
    position: dto.position,
    preferred_foot: dto.preferredFoot,
    height_cm: dto.heightCm,
    photo_url: dto.photoUrl,
  });
  let playerId: string;
  let status: PersistStatus;
  if (existing) {
    playerId = String(existing.id);
    await updateOne(ctx.client, 'players', playerId, row);
    status = 'updated';
  } else {
    playerId = await insertOne(ctx.client, 'players', row);
    remember(ctx, 'players', slug, { id: playerId });
    status = 'created';
  }
  await saveMapping(ctx.client, ctx.dataSourceId, 'player', dto.externalId, playerId);
  if (dto.currentTeamExternalId) {
    await syncCurrentTeam(ctx, playerId, dto.currentTeamExternalId);
  }
  return { status, id: playerId };
}

async function syncCurrentTeam(ctx: PersistContext, playerId: string, teamExternalId: string): Promise<void> {
  const teamId = await resolveMapping(ctx, 'team', teamExternalId);
  requireMapping(teamId, 'team', teamExternalId);
  const { data, error } = await ctx.client
    .from('player_team_history')
    .select('id,team_id')
    .eq('player_id', playerId)
    .eq('is_current', true);
  if (error) throw upstream('Team history lookup failed');
  const current = ((data as Array<{ id: string; team_id: string }> | null) ?? []);
  if (current.some((row) => String(row.team_id) === teamId)) return;
  for (const row of current) {
    await updateOne(ctx.client, 'player_team_history', String(row.id), { is_current: false });
  }
  await insertOne(ctx.client, 'player_team_history', {
    player_id: playerId,
    team_id: teamId,
    is_current: true,
  });
}

export interface MatchResolution {
  competitionId: string;
  seasonId: string | null;
  venueId: string | null;
  homeId: string;
  awayId: string;
}

export async function persistMatch(
  ctx: PersistContext,
  dto: NormalizedMatch,
  ids: MatchResolution,
): Promise<PersistOutcome> {
  const slug = slugForEntity('matches', dto as unknown as Record<string, unknown>);
  const existing = await findCached(ctx, 'matches', 'id', [['slug', slug]], slug);
  const row = defined({
    slug,
    competition_id: ids.competitionId,
    season_id: ids.seasonId,
    venue_id: ids.venueId,
    home_team_id: ids.homeId,
    away_team_id: ids.awayId,
    scheduled_at: dto.scheduledAt,
    status: dto.status,
    home_score: dto.homeScore,
    away_score: dto.awayScore,
    home_score_ht: dto.homeScoreHt,
    away_score_ht: dto.awayScoreHt,
    home_score_et: dto.homeScoreEt,
    away_score_et: dto.awayScoreEt,
    home_score_pen: dto.homeScorePen,
    away_score_pen: dto.awayScorePen,
    round: dto.round,
    matchday: dto.matchday,
    referee_name: dto.refereeName,
  });
  if (existing) {
    await updateOne(ctx.client, 'matches', String(existing.id), row);
    await saveMapping(ctx.client, ctx.dataSourceId, 'match', dto.externalId, String(existing.id));
    return { status: 'updated', id: String(existing.id) };
  }
  const id = await insertOne(ctx.client, 'matches', row);
  remember(ctx, 'matches', slug, { id });
  await saveMapping(ctx.client, ctx.dataSourceId, 'match', dto.externalId, id);
  return { status: 'created', id };
}

export async function persistEvent(
  ctx: PersistContext,
  dto: NormalizedMatchEvent,
  ids: { matchId: string; teamId: string | null; playerId: string | null; assistId: string | null },
  existingKeys: Set<string>,
): Promise<PersistOutcome> {
  const key = [ids.teamId, ids.playerId, dto.type, dto.minute, dto.extraMinute].map(String).join('|');
  if (existingKeys.has(key)) return { status: 'skipped', id: '' };
  const id = await insertOne(
    ctx.client,
    'match_events',
    defined({
      match_id: ids.matchId,
      team_id: ids.teamId,
      player_id: ids.playerId,
      assist_player_id: ids.assistId,
      type: dto.type,
      minute: dto.minute,
      extra_minute: dto.extraMinute,
      description: dto.description,
    }),
  );
  existingKeys.add(key);
  return { status: 'created', id };
}

export async function eventKeysForMatch(ctx: PersistContext, matchId: string): Promise<Set<string>> {
  const { data, error } = await ctx.client
    .from('match_events')
    .select('team_id,player_id,type,minute,extra_minute')
    .eq('match_id', matchId);
  if (error) throw upstream('Match event lookup failed');
  const rows = ((data as Array<Row> | null) ?? []);
  return new Set(
    rows.map((row) => [row.team_id, row.player_id, row.type, row.minute, row.extra_minute].map(String).join('|')),
  );
}

export async function persistLineup(
  ctx: PersistContext,
  dto: NormalizedLineup,
  ids: { matchId: string; teamId: string },
): Promise<PersistOutcome> {
  const existing = await findOne(ctx.client, 'match_lineups', 'id', [
    ['match_id', ids.matchId],
    ['team_id', ids.teamId],
  ]);
  let lineupId: string;
  let status: PersistStatus = 'created';
  if (existing) {
    lineupId = String(existing.id);
    await updateOne(ctx.client, 'match_lineups', lineupId, defined({ formation: dto.formation, coach_name: dto.coachName }));
    status = 'updated';
  } else {
    lineupId = await insertOne(
      ctx.client,
      'match_lineups',
      defined({ match_id: ids.matchId, team_id: ids.teamId, formation: dto.formation, coach_name: dto.coachName }),
    );
  }
  for (const entry of dto.players) {
    const playerId = await resolveMapping(ctx, 'player', entry.playerExternalId);
    requireMapping(playerId, 'player', entry.playerExternalId);
    const row = defined({
      lineup_id: lineupId,
      player_id: playerId,
      position: entry.position,
      shirt_number: entry.shirtNumber,
      starter: entry.starter,
      captain: entry.captain,
      substitute: entry.substitute,
      minutes_played: entry.minutesPlayed,
    });
    const dupe = await findOne(ctx.client, 'match_lineup_players', 'id', [
      ['lineup_id', lineupId],
      ['player_id', playerId],
    ]);
    if (dupe) await updateOne(ctx.client, 'match_lineup_players', String(dupe.id), row);
    else await insertOne(ctx.client, 'match_lineup_players', row);
  }
  return { status, id: lineupId };
}

export async function persistTeamStats(
  ctx: PersistContext,
  dto: NormalizedTeamStatistics,
  ids: { matchId: string; teamId: string },
): Promise<PersistOutcome> {
  const row = defined({
    match_id: ids.matchId,
    team_id: ids.teamId,
    possession: dto.possession,
    shots: dto.shots,
    shots_on_target: dto.shotsOnTarget,
    corners: dto.corners,
    fouls: dto.fouls,
    offsides: dto.offsides,
    yellow_cards: dto.yellowCards,
    red_cards: dto.redCards,
    passes: dto.passes,
    pass_accuracy: dto.passAccuracy,
    metadata: dto.metadata,
  });
  const existing = await findOne(ctx.client, 'match_team_statistics', 'id', [
    ['match_id', ids.matchId],
    ['team_id', ids.teamId],
  ]);
  if (existing) {
    await updateOne(ctx.client, 'match_team_statistics', String(existing.id), row);
    return { status: 'updated', id: String(existing.id) };
  }
  return { status: 'created', id: await insertOne(ctx.client, 'match_team_statistics', row) };
}

export async function persistPlayerStats(
  ctx: PersistContext,
  dto: NormalizedPlayerStatistics,
  ids: { matchId: string; teamId: string; playerId: string },
): Promise<PersistOutcome> {
  const row = defined({
    match_id: ids.matchId,
    team_id: ids.teamId,
    player_id: ids.playerId,
    minutes: dto.minutes,
    goals: dto.goals,
    assists: dto.assists,
    shots: dto.shots,
    shots_on_target: dto.shotsOnTarget,
    passes: dto.passes,
    pass_accuracy: dto.passAccuracy,
    tackles: dto.tackles,
    interceptions: dto.interceptions,
    clearances: dto.clearances,
    yellow_cards: dto.yellowCards,
    red_cards: dto.redCards,
    rating: dto.rating,
    metadata: dto.metadata,
  });
  const existing = await findOne(ctx.client, 'match_player_statistics', 'id', [
    ['match_id', ids.matchId],
    ['player_id', ids.playerId],
  ]);
  if (existing) {
    await updateOne(ctx.client, 'match_player_statistics', String(existing.id), row);
    return { status: 'updated', id: String(existing.id) };
  }
  return { status: 'created', id: await insertOne(ctx.client, 'match_player_statistics', row) };
}

/** ISO-8601 calendar date, optionally with a time component. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** A three-letter ISO 4217-shaped code. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

/** Parse a stored date value, or null when it is not a usable instant. */
function parseTransferDate(value: string): number | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * Transfer integrity rules, enforced before a row is written.
 *
 * These are data-integrity guards, not business rules about what a club may do:
 * a negative fee, a malformed date, a currency without a fee, or a transfer
 * that starts and ends at the same club would all be unrepresentable later, so
 * they are rejected at the boundary. A player legitimately moving between two
 * clubs is unaffected; nothing in the model permits a self-transfer, so it is
 * refused rather than silently stored.
 */
export function assertTransferIntegrity(dto: NormalizedTransfer, ids: { fromId: string | null; toId: string | null }): void {
  if (ids.fromId !== null && ids.fromId === ids.toId) {
    throw badRequest('A transfer cannot have the same source and destination team');
  }
  if (dto.fee !== undefined && dto.fee !== null) {
    if (!Number.isFinite(dto.fee) || dto.fee < 0) {
      throw badRequest('Transfer fee must be a non-negative number');
    }
    if (dto.fee > 0 && (!dto.currency || !CURRENCY_CODE.test(dto.currency))) {
      throw badRequest('Transfer fee requires a valid three-letter currency code');
    }
  }
  const announced = dto.announcementDate ? parseTransferDate(dto.announcementDate) : null;
  const effective = dto.effectiveDate ? parseTransferDate(dto.effectiveDate) : null;
  for (const [label, value, parsed] of [
    ['announcement_date', dto.announcementDate, announced],
    ['effective_date', dto.effectiveDate, effective],
  ] as const) {
    if (value !== undefined && value !== null && (parsed === null || !ISO_DATE.test(value))) {
      throw badRequest(`Transfer ${label} must be an ISO-8601 date`);
    }
  }
  if (announced !== null && effective !== null && effective < announced) {
    throw badRequest('Transfer effective_date cannot precede announcement_date');
  }
}

export async function persistTransfer(
  ctx: PersistContext,
  dto: NormalizedTransfer,
  ids: { playerId: string; fromId: string | null; toId: string | null; seasonId: string; windowId: string | null },
): Promise<PersistOutcome> {
  assertTransferIntegrity(dto, ids);
  const row = defined({
    player_id: ids.playerId,
    from_team_id: ids.fromId,
    to_team_id: ids.toId,
    transfer_type: dto.transferType,
    status: dto.status,
    fee: dto.fee,
    currency: dto.currency,
    announcement_date: dto.announcementDate,
    effective_date: dto.effectiveDate,
    season_id: ids.seasonId,
    window_id: ids.windowId,
    metadata: {},
  });
  const { data, error } = await ctx.client
    .from('transfers')
    .select('id,from_team_id,to_team_id,effective_date')
    .eq('player_id', ids.playerId)
    .eq('season_id', ids.seasonId)
    .eq('transfer_type', dto.transferType);
  if (error) throw upstream('Transfer lookup failed');
  const candidates = ((data as Array<Row> | null) ?? []);
  const dupe = candidates.find(
    (c) =>
      String(c.from_team_id ?? '') === String(ids.fromId ?? '') &&
      String(c.to_team_id ?? '') === String(ids.toId ?? '') &&
      String(c.effective_date ?? '') === String(dto.effectiveDate ?? ''),
  );
  if (dupe) {
    await updateOne(ctx.client, 'transfers', String(dupe.id), row);
    return { status: 'updated', id: String(dupe.id) };
  }
  return { status: 'created', id: await insertOne(ctx.client, 'transfers', row) };
}

export async function findWindowId(
  ctx: PersistContext,
  seasonId: string,
  windowName?: string,
): Promise<string | null> {
  if (!windowName) return null;
  const row = await findOne(ctx.client, 'transfer_windows', 'id', [
    ['season_id', seasonId],
    ['name', windowName],
  ]);
  return row ? String(row.id) : null;
}

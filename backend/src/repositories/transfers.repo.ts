import { notFound, upstream } from '../lib/errors';
import { buildPagination, paginateInput } from '../lib/pagination';
import { anonClient, type DbClient } from '../lib/supabase';
import { COMPETITION_COLUMNS, PLAYER_COLUMNS, SEASON_COLUMNS, TEAM_COLUMNS, indexBy, listByIds, maybeById } from './related';

const COLUMNS =
  'id,player_id,from_team_id,to_team_id,transfer_type,status,fee,currency,' +
  'announcement_date,effective_date,season_id,window_id';

export interface TransferListInput {
  page: number;
  limit: number;
  status?: string;
  type?: string;
  player?: string;
  team?: string;
  fromTeam?: string;
  toTeam?: string;
  season?: string;
  window?: string;
  announcedFrom?: string;
  announcedTo?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  sort?: 'asc' | 'desc';
  sortField?: TransferSortField;
  /**
   * When true, a single unconfirmed status may be requested explicitly.
   * The default listing stays confirmed-only, so a rumour is never shown
   * alongside confirmed deals unless a caller deliberately asks for it.
   */
  includeUnconfirmed?: boolean;
}

/** Sortable date columns. `id` is always the deterministic tiebreaker. */
export const TRANSFER_SORT_FIELDS = ['announcement_date', 'effective_date'] as const;
export type TransferSortField = (typeof TRANSFER_SORT_FIELDS)[number];

/** Statuses that count as a confirmed, public move. */
export const CONFIRMED_TRANSFER_STATUSES = ['announced', 'completed'] as const;
/** Statuses that are not a confirmed move and must never read as one. */
export const UNCONFIRMED_TRANSFER_STATUSES = ['rumour', 'cancelled', 'rejected'] as const;

async function resolveId(client: DbClient, table: string, slug: string): Promise<string | null> {
  const { data, error } = await client.from(table).select('id').eq('slug', slug).maybeSingle();
  if (error) throw upstream(`Failed to load ${table}`);
  return (data as { id: string } | null)?.id ?? null;
}

/** Public visibility mirrors RLS: announced/completed only. */
export async function listTransfers(input: TransferListInput) {
  const client = anonClient();
  const page = paginateInput(input.page, input.limit);
  let query = client.from('transfers').select(COLUMNS, { count: 'exact' });

  // Confirmed deals by default. Whether an unconfirmed status may be requested
  // at all is decided by the route validator, so here the default simply
  // narrows to confirmed when no status was asked for.
  query = input.status ? query.eq('status', input.status) : query.in('status', [...CONFIRMED_TRANSFER_STATUSES]);
  if (input.type) query = query.eq('transfer_type', input.type);

  if (input.player) {
    const id = await resolveId(client, 'players', input.player);
    if (!id) return { rows: [], pagination: buildPagination(0, page) };
    query = query.eq('player_id', id);
  }
  if (input.team) {
    const id = await resolveId(client, 'teams', input.team);
    if (!id) return { rows: [], pagination: buildPagination(0, page) };
    query = query.or(`from_team_id.eq.${id},to_team_id.eq.${id}`);
  }
  if (input.fromTeam) {
    const id = await resolveId(client, 'teams', input.fromTeam);
    if (!id) return { rows: [], pagination: buildPagination(0, page) };
    query = query.eq('from_team_id', id);
  }
  if (input.toTeam) {
    const id = await resolveId(client, 'teams', input.toTeam);
    if (!id) return { rows: [], pagination: buildPagination(0, page) };
    query = query.eq('to_team_id', id);
  }
  if (input.season) query = query.eq('season_id', input.season);
  if (input.window) query = query.eq('window_id', input.window);
  if (input.announcedFrom) query = query.gte('announcement_date', `${input.announcedFrom}T00:00:00.000Z`);
  if (input.announcedTo) query = query.lte('announcement_date', `${input.announcedTo}T23:59:59.999Z`);
  if (input.effectiveFrom) query = query.gte('effective_date', `${input.effectiveFrom}T00:00:00.000Z`);
  if (input.effectiveTo) query = query.lte('effective_date', `${input.effectiveTo}T23:59:59.999Z`);

  // Deterministic ordering: the chosen date column, then `id` as a stable
  // tiebreaker, so no record can appear on two pages or on neither.
  const ascending = input.sort === 'asc';
  const sortField = input.sortField ?? 'effective_date';
  const { data, error, count } = await query
    .order(sortField, { ascending })
    .order('id', { ascending })
    .range(page.from, page.to);
  if (error) throw upstream('Failed to load transfers');

  const rows = (data as unknown as Array<Record<string, unknown>>) ?? [];
  return { rows: await attachRelations(client, rows), pagination: buildPagination(count ?? 0, page) };
}

/**
 * Attach the player and both teams to a page of transfers.
 *
 * Three batched lookups for the whole page — never one per row — so a listing
 * costs a constant number of queries regardless of page size.
 */
async function attachRelations(
  client: DbClient,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  if (rows.length === 0) return rows;
  const playerIds = Array.from(new Set(rows.map((row) => String(row.player_id))));
  const teamIds = Array.from(
    new Set(rows.flatMap((row) => [row.from_team_id, row.to_team_id]).filter((id): id is string => typeof id === 'string' && id.length > 0)),
  );
  const [players, teams] = await Promise.all([
    listByIds(client, 'players', PLAYER_COLUMNS, playerIds, undefined, 300),
    listByIds(client, 'teams', TEAM_COLUMNS, teamIds, undefined, 300),
  ]);
  const playerIndex = indexBy(players);
  const teamIndex = indexBy(teams);
  return rows.map((row) => ({
    ...row,
    player: playerIndex.get(String(row.player_id)) ?? null,
    fromTeam: row.from_team_id ? teamIndex.get(String(row.from_team_id)) ?? null : null,
    toTeam: row.to_team_id ? teamIndex.get(String(row.to_team_id)) ?? null : null,
  }));
}

export async function getTransferById(id: string) {
  const { data, error } = await anonClient()
    .from('transfers')
    .select(COLUMNS)
    .eq('id', id)
    .in('status', [...CONFIRMED_TRANSFER_STATUSES])
    .maybeSingle();
  if (error) throw upstream('Failed to load transfer');
  if (!data) throw notFound('Transfer');
  return data;
}

const WINDOW_COLUMNS = 'id,name,season_id,start_date,end_date';

export interface TransferWindow {
  id: string;
  name: string;
  season_id: string;
  start_date: string;
  end_date: string;
}

export interface TransferDetails {
  transfer: Record<string, unknown>;
  player: Record<string, unknown> | null;
  fromTeam: Record<string, unknown> | null;
  toTeam: Record<string, unknown> | null;
  season: Record<string, unknown> | null;
  window: Record<string, unknown> | null;
  /**
   * Competition reached through the transfer's own season record — a declared
   * relationship, never inferred from team participation or a fee.
   */
  competition: Record<string, unknown> | null;
}

/**
 * Transfer page in a fixed number of batched rounds: the row, then the
 * player, both teams, the season, the window and that season's competition.
 * Query count is constant regardless of how many transfers exist.
 */
export async function getTransferDetails(id: string): Promise<TransferDetails> {
  const client = anonClient();
  const transfer = (await getTransferById(id)) as unknown as Record<string, unknown>;

  const [player, fromTeam, toTeam, season, window] = await Promise.all([
    maybeById(client, 'players', PLAYER_COLUMNS, transfer.player_id as string),
    maybeById(client, 'teams', TEAM_COLUMNS, transfer.from_team_id as string | null),
    maybeById(client, 'teams', TEAM_COLUMNS, transfer.to_team_id as string | null),
    maybeById(client, 'seasons', SEASON_COLUMNS, transfer.season_id as string),
    maybeById(client, 'transfer_windows', WINDOW_COLUMNS, transfer.window_id as string | null),
  ]);

  // A window is optional, and a season is not assumed to have one.
  const competition = season
    ? await maybeById(client, 'competitions', COMPETITION_COLUMNS, season.competition_id as string)
    : null;

  return { transfer, player, fromTeam, toTeam, season, window, competition };
}

/** Transfer windows, newest first. A season may legitimately have none. */
export async function listTransferWindows(input: {
  page: number;
  limit: number;
  season?: string;
}): Promise<{ rows: Record<string, unknown>[]; pagination: ReturnType<typeof buildPagination> }> {
  const client = anonClient();
  const page = paginateInput(input.page, input.limit);
  let query = client.from('transfer_windows').select(WINDOW_COLUMNS, { count: 'exact' });
  if (input.season) query = query.eq('season_id', input.season);
  const { data, error, count } = await query
    .order('start_date', { ascending: false })
    .order('id', { ascending: false })
    .range(page.from, page.to);
  if (error) throw upstream('Failed to load transfer windows');
  return {
    rows: (data as unknown as Record<string, unknown>[]) ?? [],
    pagination: buildPagination(count ?? 0, page),
  };
}

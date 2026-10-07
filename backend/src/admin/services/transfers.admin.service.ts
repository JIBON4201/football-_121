/**
 * Step 6 — Admin transfers CRUD service (reuses public.transfers + transfer_windows).
 *
 * No new tables. Writes go through serviceClient() with explicit FK
 * validation (players/teams/seasons/windows all RESTRICT — a dangling id
 * must 400, never 503). Reads are bounded; deletes are permanent (the
 * schema has no archived/deleted status) and always audited.
 */
import { badRequest, notFound, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { escapeIlike } from '../../lib/validate';
import { maybeById } from '../../repositories/related';
import { writeAdminAudit } from '../audit';

const COLUMNS =
  'id,player_id,from_team_id,to_team_id,transfer_type,status,fee,currency,' +
  'announcement_date,effective_date,season_id,window_id,metadata,created_at,updated_at';

export const ADMIN_TRANSFER_STATUSES = ['rumour', 'announced', 'completed', 'cancelled', 'rejected'] as const;
export const ADMIN_TRANSFER_TYPES = ['permanent', 'loan', 'loan_return', 'free_transfer'] as const;

export interface AdminTransferListInput {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  playerId?: string;
  fromTeamId?: string;
  toTeamId?: string;
  windowId?: string;
  seasonId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  announcedFrom?: string;
  announcedTo?: string;
  sort?: 'asc' | 'desc';
  sortField?: 'announcement_date' | 'effective_date';
}

export interface AdminTransferCreate {
  player_id: string;
  season_id: string;
  transfer_type: string;
  from_team_id?: string | null;
  to_team_id?: string | null;
  status?: string;
  fee?: number | null;
  currency?: string | null;
  announcement_date?: string | null;
  effective_date?: string | null;
  window_id?: string | null;
}

export interface AdminTransferPatch {
  player_id?: string;
  season_id?: string;
  transfer_type?: string;
  from_team_id?: string | null;
  to_team_id?: string | null;
  status?: string;
  fee?: number | null;
  currency?: string | null;
  announcement_date?: string | null;
  effective_date?: string | null;
  window_id?: string | null;
}

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exists(table: string, id: string): Promise<Row | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = serviceClient() as any;
  const { data, error } = await client.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw badRequest(`${table} lookup failed`);
  return (data as Row | null) ?? null;
}

async function getRowOrThrow(id: string): Promise<Row> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = serviceClient() as any;
  const { data, error } = await client.from('transfers').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw toServiceError(error, 'Transfer service unavailable');
  if (!data) throw notFound('Transfer');
  return data as Row;
}

function checkFeeCurrency(fee: number | null | undefined, currency: string | null | undefined): void {
  if (fee !== undefined && fee !== null && !(fee >= 0)) throw badRequest('fee must be >= 0');
  if (currency !== undefined && currency !== null && !/^[A-Z]{3}$/.test(currency)) {
    throw badRequest('currency must be a 3-letter uppercase code');
  }
}

function checkDates(announcement: string | null | undefined, effective: string | null | undefined): void {
  if (announcement && Number.isNaN(Date.parse(announcement))) throw badRequest('Invalid announcement_date');
  if (effective && Number.isNaN(Date.parse(effective))) throw badRequest('Invalid effective_date');
  if (announcement && effective && Date.parse(effective) < Date.parse(announcement)) {
    throw badRequest('effective_date must be >= announcement_date');
  }
}

function checkTeams(from: string | null | undefined, to: string | null | undefined): void {
  if (from && to && from === to) throw badRequest('from_team_id and to_team_id must differ');
}

async function validateRefs(refs: {
  player_id?: string;
  season_id?: string;
  from_team_id?: string | null;
  to_team_id?: string | null;
  window_id?: string | null;
}): Promise<void> {
  if (refs.player_id !== undefined && !(await exists('players', refs.player_id))) {
    throw badRequest('player_id does not exist');
  }
  if (refs.season_id !== undefined && !(await exists('seasons', refs.season_id))) {
    throw badRequest('season_id does not exist');
  }
  if (refs.from_team_id && !(await exists('teams', refs.from_team_id))) {
    throw badRequest('from_team_id does not exist');
  }
  if (refs.to_team_id && !(await exists('teams', refs.to_team_id))) {
    throw badRequest('to_team_id does not exist');
  }
  if (refs.window_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = serviceClient() as any;
    const { data, error } = await client
      .from('transfer_windows')
      .select('id,season_id')
      .eq('id', refs.window_id)
      .maybeSingle();
    if (error || !data) throw badRequest('window_id does not exist');
    if (refs.season_id !== undefined && (data as Row).season_id !== refs.season_id) {
      throw badRequest('window_id belongs to a different season');
    }
  }
}

export const adminTransfersService = {
  list: async (input: AdminTransferListInput) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = serviceClient() as any;
      const page = paginateInput(input.page, input.limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from('transfers').select(COLUMNS, { count: 'exact' });
      if (input.q) {
        const term = escapeIlike(input.q);
        if (term.length > 0) query = query.ilike('id', `%${term}%`);
      }
      if (input.status) query = query.eq('status', input.status);
      if (input.playerId) query = query.eq('player_id', input.playerId);
      if (input.fromTeamId) query = query.eq('from_team_id', input.fromTeamId);
      if (input.toTeamId) query = query.eq('to_team_id', input.toTeamId);
      if (input.windowId) query = query.eq('window_id', input.windowId);
      if (input.seasonId) query = query.eq('season_id', input.seasonId);
      if (input.effectiveFrom) query = query.gte('effective_date', `${input.effectiveFrom}T00:00:00.000Z`);
      if (input.effectiveTo) query = query.lte('effective_date', `${input.effectiveTo}T23:59:59.999Z`);
      if (input.announcedFrom) query = query.gte('announcement_date', `${input.announcedFrom}T00:00:00.000Z`);
      if (input.announcedTo) query = query.lte('announcement_date', `${input.announcedTo}T23:59:59.999Z`);
      const ascending = input.sort === 'asc';
      const sortField = input.sortField ?? 'effective_date';
      const { data, error, count } = await query
        .order(sortField, { ascending })
        .order('id', { ascending })
        .range(page.from, page.to);
      if (error) throw new Error('transfer list failed');
      return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Transfer service unavailable');
    }
  },

  get: async (id: string) => {
    try {
      const row = await getRowOrThrow(id);
      const client = serviceClient();
      const [player, fromTeam, toTeam, season, window] = await Promise.all([
        maybeById(client, 'players', 'id,display_name,slug', row.player_id as string),
        maybeById(client, 'teams', 'id,name,slug', row.from_team_id as string | null),
        maybeById(client, 'teams', 'id,name,slug', row.to_team_id as string | null),
        maybeById(client, 'seasons', 'id,name,competition_id', row.season_id as string),
        maybeById(client, 'transfer_windows', 'id,name,season_id,start_date,end_date', row.window_id as string | null),
      ]);
      return { ...row, player, fromTeam, toTeam, season, window };
    } catch (error) {
      throw toServiceError(error, 'Transfer service unavailable');
    }
  },

  create: async (actorId: string, input: AdminTransferCreate) => {
    try {
      checkFeeCurrency(input.fee, input.currency);
      checkDates(input.announcement_date ?? null, input.effective_date ?? null);
      checkTeams(input.from_team_id ?? null, input.to_team_id ?? null);
      await validateRefs(input);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = serviceClient() as any;
      const { data, error } = await client
        .from('transfers')
        .insert({
          player_id: input.player_id,
          season_id: input.season_id,
          transfer_type: input.transfer_type,
          from_team_id: input.from_team_id ?? null,
          to_team_id: input.to_team_id ?? null,
          status: input.status ?? 'rumour',
          fee: input.fee ?? null,
          currency: input.currency ?? null,
          announcement_date: input.announcement_date ?? null,
          effective_date: input.effective_date ?? null,
          window_id: input.window_id ?? null,
        })
        .select(COLUMNS)
        .maybeSingle();
      // PostgREST returns the row object; the in-memory test fake returns
      // a one-element array for inserts — normalize both shapes.
      const inserted = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !inserted) throw new Error('transfer insert failed');
      const row = inserted;
      await writeAdminAudit({
        userId: actorId,
        action: 'transfers.create',
        resource: 'transfers',
        resourceId: String(row.id),
        newData: row,
      });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['transfers', 'players', 'teams', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return row;
    } catch (error) {
      throw toServiceError(error, 'Transfer service unavailable');
    }
  },

  update: async (actorId: string, id: string, patch: AdminTransferPatch) => {
    try {
      const before = await getRowOrThrow(id);
      const merged: Row = { ...before };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) merged[key] = value;
      }
      checkFeeCurrency(merged.fee as number | null, merged.currency as string | null);
      checkDates(merged.announcement_date as string | null, merged.effective_date as string | null);
      checkTeams(merged.from_team_id as string | null, merged.to_team_id as string | null);
      await validateRefs({
        player_id: patch.player_id,
        season_id: patch.season_id,
        from_team_id: patch.from_team_id,
        to_team_id: patch.to_team_id,
        window_id: patch.window_id,
      });
      // Window/season consistency against the merged row, not just the patch.
      if (merged.window_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const client = serviceClient() as any;
        const { data } = await client
          .from('transfer_windows')
          .select('id,season_id')
          .eq('id', merged.window_id)
          .maybeSingle();
        if (data && (data as Row).season_id !== merged.season_id) {
          throw badRequest('window_id belongs to a different season');
        }
      }
      const update: Record<string, unknown> = {};
      for (const key of [
        'player_id',
        'season_id',
        'transfer_type',
        'from_team_id',
        'to_team_id',
        'status',
        'fee',
        'currency',
        'announcement_date',
        'effective_date',
        'window_id',
      ]) {
        if (patch[key as keyof AdminTransferPatch] !== undefined) {
          update[key] = merged[key];
        }
      }
      if (Object.keys(update).length === 0) return before;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = serviceClient() as any;
      const { data, error } = await client
        .from('transfers')
        .update(update)
        .eq('id', id)
        .select(COLUMNS)
        .maybeSingle();
      const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !updated) throw new Error('transfer update failed');
      const after = updated;
      await writeAdminAudit({
        userId: actorId,
        action: 'transfers.update',
        resource: 'transfers',
        resourceId: id,
        previousData: before,
        newData: after,
      });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['transfers', 'players', 'teams', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return after;
    } catch (error) {
      throw toServiceError(error, 'Transfer service unavailable');
    }
  },

  remove: async (actorId: string, id: string) => {
    try {
      const before = await getRowOrThrow(id);
      // No child tables reference transfers (verified: no FK targets it),
      // so deletion cannot cascade into other football data.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = serviceClient() as any;
      const { error } = await client.from('transfers').delete().eq('id', id);
      if (error) throw new Error('transfer delete failed');
      await writeAdminAudit({
        userId: actorId,
        action: 'transfers.delete',
        resource: 'transfers',
        resourceId: id,
        previousData: before,
      });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['transfers', 'players', 'teams', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
    } catch (error) {
      throw toServiceError(error, 'Transfer service unavailable');
    }
  },
};

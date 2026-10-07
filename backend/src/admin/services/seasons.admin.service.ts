/**
 * Step 10 — Admin seasons CRUD service (reuses public.seasons).
 *
 * No new tables. Seasons cascade into team_competitions and restrict
 * transfers/windows; matches + player history null out. Any dependents
 * block hard deletion (409). Seasons carry no archive flag — is_current
 * marks the running season, not archival.
 */
import { badRequest, conflict, notFound, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { escapeIlike } from '../../lib/validate';
import { writeAdminAudit } from '../audit';

const COLUMNS = 'id,competition_id,name,start_date,end_date,is_current,created_at,updated_at';

export interface AdminSeasonListInput {
  page: number;
  limit: number;
  q?: string;
  competitionId?: string;
  current?: boolean;
  sort?: string;
  order?: string;
}

export interface AdminSeasonCreate {
  competition_id: string;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
}

export type AdminSeasonPatch = Partial<AdminSeasonCreate>;

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function getRowOrThrow(id: string): Promise<Row> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('seasons').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw toServiceError(error, 'Season service unavailable');
  if (!data) throw notFound('Season');
  return data as Row;
}

function checkDates(start: string | null | undefined, end: string | null | undefined): void {
  if (start !== undefined && start !== null && !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw badRequest('start_date must be YYYY-MM-DD');
  if (end !== undefined && end !== null && !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw badRequest('end_date must be YYYY-MM-DD');
  if (start && end && start > end) throw badRequest('start_date must be <= end_date');
}

async function assertUniqueName(competitionId: string, name: string, excludeId?: string): Promise<void> {
  const client = serviceClient() as AnyClient;
  const { data } = await client.from('seasons').select('id').eq('competition_id', competitionId).eq('name', name).maybeSingle();
  const hit = data as { id: string } | null;
  if (hit && hit.id !== excludeId) throw conflict('Season name already exists for this competition');
}

async function dependentCounts(seasonId: string): Promise<Record<string, number>> {
  const client = serviceClient() as AnyClient;
  const probes: Array<[string, string, string]> = [
    ['matches', 'matches', 'season_id'],
    ['team_competitions', 'team_competitions', 'season_id'],
    ['player_team_history', 'player_team_history', 'season_id'],
    ['transfers', 'transfers', 'season_id'],
    ['transfer_windows', 'transfer_windows', 'season_id'],
  ];
  const entries = await Promise.all(
    probes.map(async ([name, table, column]) => {
      const { count } = (await client.from(table).select('id', { count: 'exact' }).eq(column, seasonId).range(0, 0)) as unknown as {
        count: number | null;
      };
      return [name, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export const adminSeasonsService = {
  list: async (input: AdminSeasonListInput) => {
    try {
      const client = serviceClient() as AnyClient;
      const page = paginateInput(input.page, input.limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from('seasons').select(COLUMNS, { count: 'exact' });
      if (input.competitionId) query = query.eq('competition_id', input.competitionId);
      if (input.current !== undefined) query = query.eq('is_current', input.current);
      if (input.q) {
        const term = escapeIlike(input.q);
        if (term.length > 0) query = query.or(`name.ilike.%${term}%`);
      }
      const sorts: Record<string, string> = { name: 'name', start_date: 'start_date' };
      const col = sorts[input.sort ?? ''] ?? 'start_date';
      const asc = (input.order ?? 'desc') === 'asc';
      const { data, error, count } = await query.order(col, { ascending: asc }).order('id', { ascending: asc }).range(page.from, page.to);
      if (error) throw new Error('season list failed');
      return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Season service unavailable');
    }
  },

  get: async (id: string) => {
    try {
      const row = await getRowOrThrow(id);
      const client = serviceClient();
      const { maybeById } = await import('../../repositories/related');
      const competition = await maybeById(client, 'competitions', 'id,name,slug', row.competition_id as string);
      return { ...row, competition, dependents: await dependentCounts(id) };
    } catch (error) {
      throw toServiceError(error, 'Season service unavailable');
    }
  },

  create: async (actorId: string, input: AdminSeasonCreate) => {
    try {
      if (!input.name || input.name.trim().length === 0) throw badRequest('name is required');
      if (input.name.length > 50) throw badRequest('name too long');
      checkDates(input.start_date, input.end_date);
      const client = serviceClient() as AnyClient;
      const { data: comp } = await client.from('competitions').select('id').eq('id', input.competition_id).maybeSingle();
      if (!comp) throw badRequest('competition_id does not exist');
      await assertUniqueName(input.competition_id, input.name);
      const { data, error } = await client
        .from('seasons')
        .insert({
          competition_id: input.competition_id, name: input.name,
          start_date: input.start_date ?? null, end_date: input.end_date ?? null,
          is_current: input.is_current ?? false,
        })
        .select(COLUMNS)
        .maybeSingle();
      const inserted = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !inserted) throw new Error('season insert failed');
      await writeAdminAudit({ userId: actorId, action: 'seasons.create', resource: 'seasons', resourceId: String(inserted.id), newData: inserted });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['competitions', 'standings', 'matches', 'teams', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return inserted;
    } catch (error) {
      throw toServiceError(error, 'Season service unavailable');
    }
  },

  update: async (actorId: string, id: string, patch: AdminSeasonPatch) => {
    try {
      const before = await getRowOrThrow(id);
      const merged: Row = { ...before };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) merged[key] = value;
      }
      if (patch.name !== undefined && String(merged.name).trim().length === 0) throw badRequest('name is required');
      checkDates(merged.start_date as string | null, merged.end_date as string | null);
      if (patch.competition_id !== undefined) {
        const client = serviceClient() as AnyClient;
        const { data } = await client.from('competitions').select('id').eq('id', patch.competition_id).maybeSingle();
        if (!data) throw badRequest('competition_id does not exist');
      }
      if (patch.name !== undefined || patch.competition_id !== undefined) {
        await assertUniqueName(String(merged.competition_id), String(merged.name), id);
      }
      const allowed = ['competition_id', 'name', 'start_date', 'end_date', 'is_current'];
      const update: Record<string, unknown> = {};
      for (const key of allowed) {
        if ((patch as Row)[key] !== undefined) update[key] = merged[key];
      }
      if (Object.keys(update).length === 0) return before;
      const client = serviceClient() as AnyClient;
      const { data, error } = await client.from('seasons').update(update).eq('id', id).select(COLUMNS).maybeSingle();
      const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !updated) throw new Error('season update failed');
      await writeAdminAudit({ userId: actorId, action: 'seasons.update', resource: 'seasons', resourceId: id, previousData: before, newData: updated });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['competitions', 'standings', 'matches', 'teams', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return updated;
    } catch (error) {
      throw toServiceError(error, 'Season service unavailable');
    }
  },

  remove: async (actorId: string, id: string) => {
    try {
      const before = await getRowOrThrow(id);
      const dependents = await dependentCounts(id);
      const total = Object.values(dependents).reduce((sum, n) => sum + n, 0);
      if (total > 0) {
        throw conflict(`Season has ${total} dependent record(s) and cannot be deleted`);
      }
      const client = serviceClient() as AnyClient;
      const { error } = await client.from('seasons').delete().eq('id', id);
      if (error) throw new Error('season delete failed');
      await writeAdminAudit({ userId: actorId, action: 'seasons.delete', resource: 'seasons', resourceId: id, previousData: before });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['competitions', 'standings', 'matches', 'teams', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
    } catch (error) {
      throw toServiceError(error, 'Season service unavailable');
    }
  },
};

/**
 * Step 9 — Admin players CRUD service (reuses public.players + related tables).
 *
 * No new tables. Team assignment writes player_team_history rows (append-only:
 * history is never deleted or rewritten here). Transfer history is exposed
 * read-only through public.transfers. Deletes are SAFE: players cascade into
 * history/lineups/statistics/article links, null out events, and transfers
 * RESTRICT — any dependents block hard deletion (409).
 */
import { badRequest, conflict, notFound, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { escapeIlike } from '../../lib/validate';
import { writeAdminAudit } from '../audit';

const COLUMNS =
  'id,first_name,last_name,display_name,slug,date_of_birth,nationality_id,position,' +
  'preferred_foot,height_cm,photo_url,status,created_at,updated_at';

const HISTORY_COLUMNS = 'id,player_id,team_id,season_id,joined_at,left_at,shirt_number,is_current';

export interface AdminPlayerListInput {
  page: number;
  limit: number;
  q?: string;
  teamId?: string;
  nationalityId?: string;
  position?: string;
  status?: string;
  sort?: string;
  order?: string;
}

export interface AdminPlayerCreate {
  display_name: string;
  slug?: string;
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  nationality_id?: string | null;
  position?: string | null;
  preferred_foot?: string | null;
  height_cm?: number | null;
  photo_url?: string | null;
  status?: string | null;
  team_id?: string | null;
  season_id?: string | null;
  shirt_number?: number | null;
}

export type AdminPlayerPatch = Partial<Omit<AdminPlayerCreate, 'team_id' | 'season_id' | 'shirt_number'>> & {
  team_id?: string | null;
  season_id?: string | null;
  shirt_number?: number | null;
};

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function exists(table: string, id: string): Promise<boolean> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw badRequest(`${table} lookup failed`);
  return Boolean(data);
}

async function getRowOrThrow(id: string): Promise<Row> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('players').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw toServiceError(error, 'Player service unavailable');
  if (!data) throw notFound('Player');
  return data as Row;
}

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = base.slice(0, 120) || 'player';
  const client = serviceClient() as AnyClient;
  let candidate = root;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data } = await client.from('players').select('id').eq('slug', candidate).maybeSingle();
    const hit = data as { id: string } | null;
    if (!hit || hit.id === excludeId) return candidate;
    candidate = `${root}-${attempt + 2}`;
  }
  throw conflict('Slug collision: unable to generate unique slug');
}

function slugBase(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return base.length > 0 ? base : 'player';
}

function checkPhoto(photo: string | null | undefined): void {
  if (photo === undefined || photo === null) return;
  if (photo.length > 2000) throw badRequest('photo_url too long');
  if (!(photo.startsWith('http://') || photo.startsWith('https://') || photo.startsWith('/'))) {
    throw badRequest('photo_url must be an http(s) URL or site path');
  }
}

function checkPhysical(foot: string | null | undefined, height: number | null | undefined, dob: string | null | undefined): void {
  if (foot !== undefined && foot !== null && !['left', 'right', 'both'].includes(foot)) {
    throw badRequest('preferred_foot must be left, right or both');
  }
  if (height !== undefined && height !== null && (!Number.isInteger(height) || height < 100 || height > 250)) {
    throw badRequest('height_cm must be 100..250');
  }
  if (dob !== undefined && dob !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    throw badRequest('date_of_birth must be YYYY-MM-DD');
  }
}

async function currentTeamId(playerId: string): Promise<string | null> {
  const client = serviceClient() as AnyClient;
  const { data } = await client
    .from('player_team_history')
    .select('team_id')
    .eq('player_id', playerId)
    .eq('is_current', true)
    .order('created_at', { ascending: false })
    .range(0, 0);
  const rows = (data as Array<{ team_id: string }> | null) ?? [];
  return rows[0]?.team_id ?? null;
}

async function assignTeam(playerId: string, teamId: string, seasonId?: string | null, shirt?: number | null): Promise<void> {
  const client = serviceClient() as AnyClient;
  if (!(await exists('teams', teamId))) throw badRequest('team_id does not exist');
  if (seasonId && !(await exists('seasons', seasonId))) throw badRequest('season_id does not exist');
  if (shirt !== undefined && shirt !== null && (!Number.isInteger(shirt) || shirt < 1 || shirt > 99)) {
    throw badRequest('shirt_number must be 1..99');
  }
  const current = await currentTeamId(playerId);
  if (current === teamId) return;
  if (current) {
    await client.from('player_team_history').update({ is_current: false }).eq('player_id', playerId).eq('is_current', true);
  }
  const { error } = await client.from('player_team_history').insert({
    player_id: playerId,
    team_id: teamId,
    season_id: seasonId ?? null,
    shirt_number: shirt ?? null,
    is_current: true,
  });
  if (error) throw new Error('team assignment failed');
}

async function playerIdsForTeam(teamId: string): Promise<string[] | null> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('player_team_history').select('player_id').eq('team_id', teamId).range(0, 499);
  if (error) return null;
  return [...new Set(((data as Array<{ player_id: string }> | null) ?? []).map((row) => row.player_id))];
}

async function dependentCounts(playerId: string): Promise<Record<string, number>> {
  const client = serviceClient() as AnyClient;
  const probes: Array<[string, string, string]> = [
    ['player_team_history', 'player_team_history', 'player_id'],
    ['transfers', 'transfers', 'player_id'],
    ['match_events', 'match_events', 'player_id'],
    ['match_events_assist', 'match_events', 'assist_player_id'],
    ['match_lineup_players', 'match_lineup_players', 'player_id'],
    ['match_player_statistics', 'match_player_statistics', 'player_id'],
    ['article_players', 'article_players', 'player_id'],
  ];
  const entries = await Promise.all(
    probes.map(async ([name, table, column]) => {
      const { count } = (await client.from(table).select('id', { count: 'exact' }).eq(column, playerId).range(0, 0)) as unknown as {
        count: number | null;
      };
      return [name, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export const adminPlayersService = {
  list: async (input: AdminPlayerListInput) => {
    try {
      let teamIds: string[] | null | undefined;
      if (input.teamId) {
        teamIds = await playerIdsForTeam(input.teamId);
        if (teamIds === null || teamIds.length === 0) {
          const { paginateInput: paginate, buildPagination: build } = await import('../../lib/pagination');
          const page = paginate(input.page, input.limit);
          return { rows: [], pagination: build(0, page) };
        }
      }
      const client = serviceClient() as AnyClient;
      const page = paginateInput(input.page, input.limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from('players').select(COLUMNS, { count: 'exact' });
      if (teamIds) query = query.in('id', teamIds);
      if (input.nationalityId) query = query.eq('nationality_id', input.nationalityId);
      if (input.position) query = query.eq('position', input.position);
      if (input.status) query = query.eq('status', input.status);
      if (input.q) {
        const term = escapeIlike(input.q);
        if (term.length > 0) {
          query = query.or(`display_name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
        }
      }
      const sorts: Record<string, string> = { display_name: 'display_name', created_at: 'created_at' };
      const col = sorts[input.sort ?? ''] ?? 'display_name';
      const asc = col === 'display_name' ? (input.order ?? 'asc') === 'asc' : (input.order ?? 'desc') === 'asc';
      const { data, error, count } = await query
        .order(col, { ascending: asc })
        .order('id', { ascending: asc })
        .range(page.from, page.to);
      if (error) throw new Error('player list failed');
      return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Player service unavailable');
    }
  },

  get: async (id: string) => {
    try {
      const row = await getRowOrThrow(id);
      const client = serviceClient();
      const { maybeById } = await import('../../repositories/related');
      const [nationality, currentTeam] = await Promise.all([
        maybeById(client, 'countries', 'id,name,slug', row.nationality_id as string | null),
        (async () => {
          const teamId = await currentTeamId(id);
          return teamId ? maybeById(client, 'teams', 'id,name,slug', teamId) : null;
        })(),
      ]);
      const transfers = (await (serviceClient() as AnyClient)
        .from('transfers')
        .select('id,status,transfer_type,from_team_id,to_team_id,effective_date')
        .eq('player_id', id)
        .order('effective_date', { ascending: false })
        .order('id', { ascending: false })
        .range(0, 19)) as unknown as { data: unknown[] | null };
      return {
        ...row,
        nationality,
        currentTeam,
        transfers: transfers.data ?? [],
        dependents: await dependentCounts(id),
      };
    } catch (error) {
      throw toServiceError(error, 'Player service unavailable');
    }
  },

  create: async (actorId: string, input: AdminPlayerCreate) => {
    try {
      if (!input.display_name || input.display_name.trim().length === 0) throw badRequest('display_name is required');
      if (input.display_name.length > 150) throw badRequest('display_name too long');
      checkPhoto(input.photo_url);
      checkPhysical(input.preferred_foot, input.height_cm, input.date_of_birth);
      if (input.nationality_id && !(await exists('countries', input.nationality_id))) {
        throw badRequest('nationality_id does not exist');
      }
      // Team/season/shirt must validate BEFORE the insert — a late failure
      // would otherwise leave an orphaned player row behind.
      if (input.team_id && !(await exists('teams', input.team_id))) {
        throw badRequest('team_id does not exist');
      }
      if (input.season_id && !(await exists('seasons', input.season_id))) {
        throw badRequest('season_id does not exist');
      }
      if (input.shirt_number !== undefined && input.shirt_number !== null &&
        (!Number.isInteger(input.shirt_number) || input.shirt_number < 1 || input.shirt_number > 99)) {
        throw badRequest('shirt_number must be 1..99');
      }
      let slug = (input.slug ?? '').toLowerCase();
      if (slug) {
        if (!/^[A-Za-z0-9_.-]+$/.test(slug)) throw badRequest('Invalid slug');
      } else {
        slug = slugBase(input.display_name);
      }
      slug = await ensureUniqueSlug(slug);
      const client = serviceClient() as AnyClient;
      const { data, error } = await client
        .from('players')
        .insert({
          display_name: input.display_name,
          slug,
          first_name: input.first_name ?? null,
          last_name: input.last_name ?? null,
          date_of_birth: input.date_of_birth ?? null,
          nationality_id: input.nationality_id ?? null,
          position: input.position ?? null,
          preferred_foot: input.preferred_foot ?? null,
          height_cm: input.height_cm ?? null,
          photo_url: input.photo_url ?? null,
          status: input.status ?? null,
        })
        .select(COLUMNS)
        .maybeSingle();
      const inserted = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !inserted) throw new Error('player insert failed');
      if (input.team_id) {
        await assignTeam(String(inserted.id), input.team_id, input.season_id, input.shirt_number);
      }
      await writeAdminAudit({ userId: actorId, action: 'players.create', resource: 'players', resourceId: String(inserted.id), newData: inserted });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['players', 'player-stats', 'teams', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return inserted;
    } catch (error) {
      throw toServiceError(error, 'Player service unavailable');
    }
  },

  update: async (actorId: string, id: string, patch: AdminPlayerPatch) => {
    try {
      const before = await getRowOrThrow(id);
      const merged: Row = { ...before };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined && key !== 'team_id' && key !== 'season_id' && key !== 'shirt_number') {
          merged[key] = value;
        }
      }
      if (patch.display_name !== undefined && String(merged.display_name).trim().length === 0) {
        throw badRequest('display_name is required');
      }
      checkPhoto(merged.photo_url as string | null);
      checkPhysical(merged.preferred_foot as string | null, merged.height_cm as number | null, merged.date_of_birth as string | null);
      if (patch.nationality_id !== undefined && patch.nationality_id !== null && !(await exists('countries', patch.nationality_id))) {
        throw badRequest('nationality_id does not exist');
      }
      if (patch.slug !== undefined && patch.slug !== before.slug) {
        const candidate = String(patch.slug).toLowerCase();
        if (!/^[A-Za-z0-9_.-]+$/.test(candidate)) throw badRequest('Invalid slug');
        merged.slug = await ensureUniqueSlug(candidate, id);
      }
      const allowed = ['display_name', 'slug', 'first_name', 'last_name', 'date_of_birth', 'nationality_id', 'position', 'preferred_foot', 'height_cm', 'photo_url', 'status'];
      const update: Record<string, unknown> = {};
      for (const key of allowed) {
        if ((patch as Row)[key] !== undefined) update[key] = merged[key];
      }
      const client = serviceClient() as AnyClient;
      let after = before;
      if (Object.keys(update).length > 0) {
        const { data, error } = await client.from('players').update(update).eq('id', id).select(COLUMNS).maybeSingle();
        const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
        if (error || !updated) throw new Error('player update failed');
        after = updated;
      }
      if (patch.team_id) {
        await assignTeam(id, patch.team_id, patch.season_id, patch.shirt_number);
      }
      await writeAdminAudit({ userId: actorId, action: 'players.update', resource: 'players', resourceId: id, previousData: before, newData: after });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['players', 'player-stats', 'teams', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return after;
    } catch (error) {
      throw toServiceError(error, 'Player service unavailable');
    }
  },

  remove: async (actorId: string, id: string) => {
    try {
      const before = await getRowOrThrow(id);
      const dependents = await dependentCounts(id);
      const total = Object.values(dependents).reduce((sum, n) => sum + n, 0);
      if (total > 0) {
        throw conflict(`Player has ${total} dependent record(s) and cannot be deleted`);
      }
      const client = serviceClient() as AnyClient;
      const { error } = await client.from('players').delete().eq('id', id);
      if (error) throw new Error('player delete failed');
      await writeAdminAudit({ userId: actorId, action: 'players.delete', resource: 'players', resourceId: id, previousData: before });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['players', 'player-stats', 'teams', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
    } catch (error) {
      throw toServiceError(error, 'Player service unavailable');
    }
  },
};

export { HISTORY_COLUMNS };

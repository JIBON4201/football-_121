/**
 * Step 7 — Admin match-events CRUD service (reuses public.match_events).
 *
 * Events are scoped to their match: the :matchId path segment must equal
 * the event's match_id (404 otherwise). Team scope is enforced against the
 * match's home/away sides; substitution requires a player; assist players
 * are only meaningful on goal-type events. Event rows have no children,
 * so deletes are permanent and audited.
 */
import { badRequest, notFound, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { writeAdminAudit } from '../audit';

const COLUMNS =
  'id,match_id,team_id,player_id,assist_player_id,type,minute,extra_minute,description,created_at,updated_at';

const GOAL_TYPES = ['goal', 'own_goal', 'penalty_goal'];

export interface AdminEventListInput {
  page: number;
  limit: number;
}

export interface AdminEventCreate {
  team_id?: string | null;
  player_id?: string | null;
  assist_player_id?: string | null;
  type: string;
  minute?: number | null;
  extra_minute?: number | null;
  description?: string | null;
}

export type AdminEventPatch = Partial<AdminEventCreate>;

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function getMatchOrThrow(matchId: string): Promise<Row> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('matches').select('id,home_team_id,away_team_id').eq('id', matchId).maybeSingle();
  if (error) throw toServiceError(error, 'Match service unavailable');
  if (!data) throw notFound('Match');
  return data as Row;
}

async function getEventOrThrow(matchId: string, eventId: string): Promise<Row> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('match_events').select(COLUMNS).eq('id', eventId).maybeSingle();
  if (error) throw toServiceError(error, 'Match event service unavailable');
  if (!data || (data as Row).match_id !== matchId) throw notFound('Match event');
  return data as Row;
}

async function exists(table: string, id: string): Promise<boolean> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw badRequest(`${table} lookup failed`);
  return Boolean(data);
}

function checkMinute(minute: number | null | undefined, extra: number | null | undefined): void {
  for (const [name, value] of [['minute', minute], ['extra_minute', extra]] as const) {
    if (value === undefined || value === null) continue;
    if (!Number.isInteger(value) || value < 0 || value > 32767) throw badRequest(`${name} must be an integer 0..32767`);
  }
}

async function validateEvent(match: Row, input: { team_id?: string | null; player_id?: string | null; assist_player_id?: string | null; type?: string; minute?: number | null; extra_minute?: number | null }): Promise<void> {
  if (input.team_id) {
    if (input.team_id !== match.home_team_id && input.team_id !== match.away_team_id) {
      throw badRequest('team_id must be one of the match sides');
    }
  }
  if (input.player_id && !(await exists('players', input.player_id))) {
    throw badRequest('player_id does not exist');
  }
  if (input.assist_player_id) {
    if (!(await exists('players', input.assist_player_id))) throw badRequest('assist_player_id does not exist');
    const type = input.type;
    if (type !== undefined && !GOAL_TYPES.includes(type)) {
      throw badRequest('assist_player_id is only meaningful on goal-type events');
    }
    if (input.player_id && input.assist_player_id === input.player_id) {
      throw badRequest('assist_player_id must differ from player_id');
    }
  }
  if (input.type === 'substitution' && !input.player_id) {
    throw badRequest('substitution events require player_id');
  }
  checkMinute(input.minute ?? null, input.extra_minute ?? null);
}

export const adminMatchEventsService = {
  list: async (matchId: string, input: AdminEventListInput) => {
    try {
      await getMatchOrThrow(matchId);
      const client = serviceClient() as AnyClient;
      const page = paginateInput(input.page, input.limit);
      const { data, error, count } = await client
        .from('match_events')
        .select(COLUMNS, { count: 'exact' })
        .eq('match_id', matchId)
        .order('minute', { ascending: true })
        .order('id', { ascending: true })
        .range(page.from, page.to);
      if (error) throw new Error('match event list failed');
      return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Match event service unavailable');
    }
  },

  create: async (actorId: string, matchId: string, input: AdminEventCreate) => {
    try {
      const match = await getMatchOrThrow(matchId);
      await validateEvent(match, input);
      const client = serviceClient() as AnyClient;
      const { data, error } = await client
        .from('match_events')
        .insert({
          match_id: matchId,
          team_id: input.team_id ?? null,
          player_id: input.player_id ?? null,
          assist_player_id: input.assist_player_id ?? null,
          type: input.type,
          minute: input.minute ?? null,
          extra_minute: input.extra_minute ?? null,
          description: input.description ?? null,
        })
        .select(COLUMNS)
        .maybeSingle();
      const inserted = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !inserted) throw new Error('match event insert failed');
      await writeAdminAudit({ userId: actorId, action: 'match_events.create', resource: 'match_events', resourceId: String(inserted.id), newData: inserted });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['matches', 'standings', 'team-stats', 'player-stats', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return inserted;
    } catch (error) {
      throw toServiceError(error, 'Match event service unavailable');
    }
  },

  update: async (actorId: string, matchId: string, eventId: string, patch: AdminEventPatch) => {
    try {
      const match = await getMatchOrThrow(matchId);
      const before = await getEventOrThrow(matchId, eventId);
      const merged: Row = { ...before };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) merged[key] = value;
      }
      await validateEvent(match, {
        team_id: merged.team_id as string | null,
        player_id: merged.player_id as string | null,
        assist_player_id: merged.assist_player_id as string | null,
        type: merged.type as string,
        minute: merged.minute as number | null,
        extra_minute: merged.extra_minute as number | null,
      });
      const allowed = ['team_id', 'player_id', 'assist_player_id', 'type', 'minute', 'extra_minute', 'description'];
      const update: Record<string, unknown> = {};
      for (const key of allowed) {
        if ((patch as Row)[key] !== undefined) update[key] = merged[key];
      }
      if (Object.keys(update).length === 0) return before;
      const client = serviceClient() as AnyClient;
      const { data, error } = await client.from('match_events').update(update).eq('id', eventId).select(COLUMNS).maybeSingle();
      const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !updated) throw new Error('match event update failed');
      await writeAdminAudit({ userId: actorId, action: 'match_events.update', resource: 'match_events', resourceId: eventId, previousData: before, newData: updated });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['matches', 'standings', 'team-stats', 'player-stats', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return updated;
    } catch (error) {
      throw toServiceError(error, 'Match event service unavailable');
    }
  },

  remove: async (actorId: string, matchId: string, eventId: string) => {
    try {
      await getMatchOrThrow(matchId);
      const before = await getEventOrThrow(matchId, eventId);
      const client = serviceClient() as AnyClient;
      const { error } = await client.from('match_events').delete().eq('id', eventId);
      if (error) throw new Error('match event delete failed');
      await writeAdminAudit({ userId: actorId, action: 'match_events.delete', resource: 'match_events', resourceId: eventId, previousData: before });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['matches', 'standings', 'team-stats', 'player-stats', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
    } catch (error) {
      throw toServiceError(error, 'Match event service unavailable');
    }
  },
};

/**
 * Step 7 — Admin matches CRUD service (reuses public.matches + related tables).
 *
 * No new tables. Writes go through serviceClient() with explicit FK/enum
 * validation. Deletes are SAFE: matches cascade into match_events,
 * match_lineups (+players), team/player statistics and article_matches
 * links, so a match with dependents is never hard-deleted — callers get
 * 409 with counts and should cancel via PATCH status=cancelled instead.
 */
import { badRequest, conflict, notFound, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { escapeIlike } from '../../lib/validate';
import { writeAdminAudit } from '../audit';

const COLUMNS =
  'id,slug,competition_id,season_id,venue_id,home_team_id,away_team_id,scheduled_at,' +
  'status,home_score,away_score,home_score_ht,away_score_ht,home_score_et,away_score_et,' +
  'home_score_pen,away_score_pen,round,matchday,referee_name,attendance,created_at,updated_at';

const SCORE_FIELDS = [
  'home_score',
  'away_score',
  'home_score_ht',
  'away_score_ht',
  'home_score_et',
  'away_score_et',
  'home_score_pen',
  'away_score_pen',
] as const;

export interface AdminMatchListInput {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  competitionId?: string;
  seasonId?: string;
  teamId?: string;
  from?: string;
  to?: string;
  sort?: 'asc' | 'desc';
}

export interface AdminMatchCreate {
  slug?: string;
  competition_id: string;
  season_id?: string | null;
  venue_id?: string | null;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  status?: string;
  home_score?: number | null;
  away_score?: number | null;
  home_score_ht?: number | null;
  away_score_ht?: number | null;
  home_score_et?: number | null;
  away_score_et?: number | null;
  home_score_pen?: number | null;
  away_score_pen?: number | null;
  round?: string | null;
  matchday?: number | null;
  referee_name?: string | null;
  attendance?: number | null;
}

export type AdminMatchPatch = Partial<AdminMatchCreate>;

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function exists(table: string, id: string): Promise<Row | null> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw badRequest(`${table} lookup failed`);
  return (data as Row | null) ?? null;
}

async function getRowOrThrow(id: string): Promise<Row> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('matches').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw toServiceError(error, 'Match service unavailable');
  if (!data) throw notFound('Match');
  return data as Row;
}

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = base.slice(0, 120) || 'match';
  const client = serviceClient() as AnyClient;
  let candidate = root;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data } = await client.from('matches').select('id').eq('slug', candidate).maybeSingle();
    const hit = data as { id: string } | null;
    if (!hit || hit.id === excludeId) return candidate;
    candidate = `${root}-${attempt + 2}`;
  }
  throw conflict('Slug collision: unable to generate unique slug');
}

function checkScores(row: Partial<Record<string, unknown>>): void {
  for (const field of SCORE_FIELDS) {
    const value = row[field];
    if (value === undefined || value === null) continue;
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 32767) {
      throw badRequest(`${field} must be an integer 0..32767`);
    }
  }
}

async function validateMatchRefs(refs: {
  competition_id?: string;
  season_id?: string | null;
  venue_id?: string | null;
  home_team_id?: string;
  away_team_id?: string;
}): Promise<void> {
  if (refs.competition_id !== undefined && !(await exists('competitions', refs.competition_id))) {
    throw badRequest('competition_id does not exist');
  }
  if (refs.season_id) {
    const client = serviceClient() as AnyClient;
    const { data, error } = await client
      .from('seasons')
      .select('id,competition_id')
      .eq('id', refs.season_id)
      .maybeSingle();
    if (error || !data) throw badRequest('season_id does not exist');
    if (refs.competition_id !== undefined && (data as Row).competition_id !== refs.competition_id) {
      throw badRequest('season_id belongs to a different competition');
    }
  }
  if (refs.venue_id && !(await exists('venues', refs.venue_id))) {
    throw badRequest('venue_id does not exist');
  }
  if (refs.home_team_id !== undefined && !(await exists('teams', refs.home_team_id))) {
    throw badRequest('home_team_id does not exist');
  }
  if (refs.away_team_id !== undefined && !(await exists('teams', refs.away_team_id))) {
    throw badRequest('away_team_id does not exist');
  }
}

async function dependentCounts(matchId: string): Promise<Record<string, number>> {
  const client = serviceClient() as AnyClient;
  const tables = ['match_events', 'match_lineups', 'match_team_statistics', 'match_player_statistics', 'article_matches'];
  const entries = await Promise.all(
    tables.map(async (table) => {
      const column = table === 'article_matches' ? 'match_id' : 'match_id';
      const { count } = (await client.from(table).select('id', { count: 'exact' }).eq(column, matchId).range(0, 0)) as unknown as {
        count: number | null;
      };
      return [table, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export const adminMatchesService = {
  list: async (input: AdminMatchListInput) => {
    try {
      const client = serviceClient() as AnyClient;
      const page = paginateInput(input.page, input.limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from('matches').select(COLUMNS, { count: 'exact' });
      if (input.status) query = query.eq('status', input.status);
      if (input.competitionId) query = query.eq('competition_id', input.competitionId);
      if (input.seasonId) query = query.eq('season_id', input.seasonId);
      if (input.teamId) query = query.or(`home_team_id.eq.${input.teamId},away_team_id.eq.${input.teamId}`);
      if (input.from) query = query.gte('scheduled_at', `${input.from}T00:00:00.000Z`);
      if (input.to) query = query.lte('scheduled_at', `${input.to}T23:59:59.999Z`);
      if (input.q) {
        const term = escapeIlike(input.q);
        if (term.length > 0) query = query.or(`slug.ilike.%${term}%`);
      }
      const ascending = input.sort === 'asc';
      const { data, error, count } = await query
        .order('scheduled_at', { ascending })
        .order('id', { ascending })
        .range(page.from, page.to);
      if (error) throw new Error('match list failed');
      return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Match service unavailable');
    }
  },

  get: async (id: string) => {
    try {
      const row = await getRowOrThrow(id);
      const client = serviceClient();
      const { maybeById } = await import('../../repositories/related');
      const [homeTeam, awayTeam, competition, season, venue] = await Promise.all([
        maybeById(client, 'teams', 'id,name,slug', row.home_team_id as string),
        maybeById(client, 'teams', 'id,name,slug', row.away_team_id as string),
        maybeById(client, 'competitions', 'id,name,slug', row.competition_id as string),
        maybeById(client, 'seasons', 'id,name,competition_id', row.season_id as string | null),
        maybeById(client, 'venues', 'id,name,slug', row.venue_id as string | null),
      ]);
      return { ...row, homeTeam, awayTeam, competition, season, venue, dependents: await dependentCounts(id) };
    } catch (error) {
      throw toServiceError(error, 'Match service unavailable');
    }
  },

  create: async (actorId: string, input: AdminMatchCreate) => {
    try {
      if (input.home_team_id === input.away_team_id) throw badRequest('home_team_id and away_team_id must differ');
      if (Number.isNaN(Date.parse(input.scheduled_at))) throw badRequest('Invalid scheduled_at');
      checkScores(input as unknown as Partial<Record<string, unknown>>);
      await validateMatchRefs(input);
      const client = serviceClient() as AnyClient;
      let slug = (input.slug ?? '').toLowerCase();
      if (slug) {
        if (!/^[A-Za-z0-9_.-]+$/.test(slug)) throw badRequest('Invalid slug');
      } else {
        const home = (await client.from('teams').select('slug').eq('id', input.home_team_id).maybeSingle()) as unknown as {
          data: { slug: string } | null;
        };
        const away = (await client.from('teams').select('slug').eq('id', input.away_team_id).maybeSingle()) as unknown as {
          data: { slug: string } | null;
        };
        slug = `${home.data?.slug ?? 'home'}-vs-${away.data?.slug ?? 'away'}`;
      }
      slug = await ensureUniqueSlug(slug);
      const { data, error } = await client
        .from('matches')
        .insert({
          slug,
          competition_id: input.competition_id,
          season_id: input.season_id ?? null,
          venue_id: input.venue_id ?? null,
          home_team_id: input.home_team_id,
          away_team_id: input.away_team_id,
          scheduled_at: input.scheduled_at,
          status: input.status ?? 'scheduled',
          ...Object.fromEntries(SCORE_FIELDS.map((f) => [f, (input as unknown as Row)[f] ?? null])),
          round: input.round ?? null,
          matchday: input.matchday ?? null,
          referee_name: input.referee_name ?? null,
          attendance: input.attendance ?? null,
        })
        .select(COLUMNS)
        .maybeSingle();
      const inserted = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !inserted) throw new Error('match insert failed');
      await writeAdminAudit({ userId: actorId, action: 'matches.create', resource: 'matches', resourceId: String(inserted.id), newData: inserted });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['matches', 'standings', 'team-stats', 'player-stats', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return inserted;
    } catch (error) {
      throw toServiceError(error, 'Match service unavailable');
    }
  },

  update: async (actorId: string, id: string, patch: AdminMatchPatch) => {
    try {
      const before = await getRowOrThrow(id);
      const merged: Row = { ...before };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) merged[key] = value;
      }
      if (merged.home_team_id === merged.away_team_id) throw badRequest('home_team_id and away_team_id must differ');
      if (patch.scheduled_at !== undefined && Number.isNaN(Date.parse(String(merged.scheduled_at)))) {
        throw badRequest('Invalid scheduled_at');
      }
      checkScores(merged);
      await validateMatchRefs({
        competition_id: patch.competition_id,
        season_id: patch.season_id,
        venue_id: patch.venue_id,
        home_team_id: patch.home_team_id,
        away_team_id: patch.away_team_id,
      });
      if (merged.season_id && merged.competition_id) {
        const client = serviceClient() as AnyClient;
        const { data } = await client.from('seasons').select('id,competition_id').eq('id', merged.season_id).maybeSingle();
        if (data && (data as Row).competition_id !== merged.competition_id) {
          throw badRequest('season_id belongs to a different competition');
        }
      }
      if (patch.slug !== undefined && patch.slug !== before.slug) {
        if (!/^[A-Za-z0-9_.-]+$/.test(String(patch.slug))) throw badRequest('Invalid slug');
        merged.slug = await ensureUniqueSlug(String(patch.slug).toLowerCase(), id);
      }
      const allowed = ['slug', 'competition_id', 'season_id', 'venue_id', 'home_team_id', 'away_team_id', 'scheduled_at', 'status', ...SCORE_FIELDS, 'round', 'matchday', 'referee_name', 'attendance'];
      const update: Record<string, unknown> = {};
      for (const key of allowed) {
        if ((patch as Row)[key] !== undefined) update[key] = merged[key];
      }
      if (Object.keys(update).length === 0) return before;
      const client = serviceClient() as AnyClient;
      const { data, error } = await client.from('matches').update(update).eq('id', id).select(COLUMNS).maybeSingle();
      const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !updated) throw new Error('match update failed');
      await writeAdminAudit({ userId: actorId, action: 'matches.update', resource: 'matches', resourceId: id, previousData: before, newData: updated });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['matches', 'standings', 'team-stats', 'player-stats', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return updated;
    } catch (error) {
      throw toServiceError(error, 'Match service unavailable');
    }
  },

  remove: async (actorId: string, id: string) => {
    try {
      const before = await getRowOrThrow(id);
      const dependents = await dependentCounts(id);
      const total = Object.values(dependents).reduce((sum, n) => sum + n, 0);
      if (total > 0) {
        throw conflict(
          `Match has ${total} dependent record(s) and cannot be deleted; cancel it instead (PATCH status=cancelled)`,
        );
      }
      const client = serviceClient() as AnyClient;
      const { error } = await client.from('matches').delete().eq('id', id);
      if (error) throw new Error('match delete failed');
      await writeAdminAudit({ userId: actorId, action: 'matches.delete', resource: 'matches', resourceId: id, previousData: before });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['matches', 'standings', 'team-stats', 'player-stats', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
    } catch (error) {
      throw toServiceError(error, 'Match service unavailable');
    }
  },
};

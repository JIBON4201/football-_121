/**
 * Step 8 — Admin teams CRUD service (reuses public.teams + related tables).
 *
 * No new tables. Deletes are SAFE: teams cascade into matches (which in
 * turn cascade into events/lineups/statistics), team_competitions, player
 * history, article links and favorites — while transfers RESTRICT. A team
 * with any dependents is never hard-deleted (409); deactivate via
 * PATCH is_active=false instead.
 */
import { badRequest, conflict, notFound, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { escapeIlike } from '../../lib/validate';
import { writeAdminAudit } from '../audit';

const COLUMNS =
  'id,name,short_name,slug,country_id,logo_url,founded_year,venue_id,website_url,is_active,created_at,updated_at';

export interface AdminTeamListInput {
  page: number;
  limit: number;
  q?: string;
  countryId?: string;
  competitionId?: string;
  seasonId?: string;
  active?: boolean;
  sort?: string;
  order?: string;
}

export interface AdminTeamCreate {
  name: string;
  slug?: string;
  short_name?: string | null;
  country_id?: string | null;
  logo_url?: string | null;
  founded_year?: number | null;
  venue_id?: string | null;
  website_url?: string | null;
  is_active?: boolean;
}

export type AdminTeamPatch = Partial<AdminTeamCreate>;

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
  const { data, error } = await client.from('teams').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw toServiceError(error, 'Team service unavailable');
  if (!data) throw notFound('Team');
  return data as Row;
}

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = base.slice(0, 120) || 'team';
  const client = serviceClient() as AnyClient;
  let candidate = root;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data } = await client.from('teams').select('id').eq('slug', candidate).maybeSingle();
    const hit = data as { id: string } | null;
    if (!hit || hit.id === excludeId) return candidate;
    candidate = `${root}-${attempt + 2}`;
  }
  throw conflict('Slug collision: unable to generate unique slug');
}

function checkUrls(logo: string | null | undefined, website: string | null | undefined): void {
  for (const [name, value] of [['logo_url', logo], ['website_url', website]] as const) {
    if (value === undefined || value === null) continue;
    if (value.length > 2000) throw badRequest(`${name} too long`);
    if (!(value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/'))) {
      throw badRequest(`${name} must be an http(s) URL or site path`);
    }
  }
}

function checkFounded(year: number | null | undefined): void {
  if (year === undefined || year === null) return;
  if (!Number.isInteger(year) || year < 1800 || year > 2100) throw badRequest('founded_year must be 1800..2100');
}

function slugBase(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return base.length > 0 ? base : 'team';
}

async function validateRefs(refs: { country_id?: string | null; venue_id?: string | null }): Promise<void> {
  if (refs.country_id && !(await exists('countries', refs.country_id))) throw badRequest('country_id does not exist');
  if (refs.venue_id && !(await exists('venues', refs.venue_id))) throw badRequest('venue_id does not exist');
}

async function teamIdsForCompetition(competitionId: string, seasonId?: string): Promise<string[] | null> {
  const client = serviceClient() as AnyClient;
  let query = client.from('team_competitions').select('team_id').eq('competition_id', competitionId);
  if (seasonId) query = query.eq('season_id', seasonId);
  const { data, error } = await query.range(0, 499);
  if (error) return null;
  return ((data as Array<{ team_id: string }> | null) ?? []).map((row) => row.team_id);
}

async function dependentCounts(teamId: string): Promise<Record<string, number>> {
  const client = serviceClient() as AnyClient;
  const probes: Array<[string, string, string]> = [
    ['matches_home', 'matches', 'home_team_id'],
    ['matches_away', 'matches', 'away_team_id'],
    ['team_competitions', 'team_competitions', 'team_id'],
    ['player_team_history', 'player_team_history', 'team_id'],
    ['transfers_from', 'transfers', 'from_team_id'],
    ['transfers_to', 'transfers', 'to_team_id'],
    ['article_teams', 'article_teams', 'team_id'],
    ['match_lineups', 'match_lineups', 'team_id'],
    ['match_team_statistics', 'match_team_statistics', 'team_id'],
  ];
  const entries = await Promise.all(
    probes.map(async ([name, table, column]) => {
      const { count } = (await client.from(table).select('id', { count: 'exact' }).eq(column, teamId).range(0, 0)) as unknown as {
        count: number | null;
      };
      return [name, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export const adminTeamsService = {
  list: async (input: AdminTeamListInput) => {
    try {
      let competitionIds: string[] | null | undefined;
      if (input.competitionId) {
        competitionIds = await teamIdsForCompetition(input.competitionId, input.seasonId);
        if (competitionIds === null || competitionIds.length === 0) {
          const { paginateInput: paginate, buildPagination: build } = await import('../../lib/pagination');
          const page = paginate(input.page, input.limit);
          return { rows: [], pagination: build(0, page) };
        }
      }
      const client = serviceClient() as AnyClient;
      const page = paginateInput(input.page, input.limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from('teams').select(COLUMNS, { count: 'exact' });
      if (competitionIds) query = query.in('id', competitionIds);
      else if (input.seasonId) {
        // Season without competition: resolve via team_competitions season-wide.
        const ids = await (async () => {
          const { data } = (await client.from('team_competitions').select('team_id').eq('season_id', input.seasonId).range(0, 499)) as unknown as {
            data: Array<{ team_id: string }> | null;
          };
          return (data ?? []).map((row) => row.team_id);
        })();
        if (ids.length === 0) {
          const { buildPagination: build } = await import('../../lib/pagination');
          return { rows: [], pagination: build(0, page) };
        }
        query = query.in('id', ids);
      }
      if (input.countryId) query = query.eq('country_id', input.countryId);
      if (input.active !== undefined) query = query.eq('is_active', input.active);
      if (input.q) {
        const term = escapeIlike(input.q);
        if (term.length > 0) query = query.or(`name.ilike.%${term}%,short_name.ilike.%${term}%`);
      }
      const sorts: Record<string, string> = { name: 'name', created_at: 'created_at' };
      const col = sorts[input.sort ?? ''] ?? 'name';
      const asc = col === 'name' ? (input.order ?? 'asc') === 'asc' : (input.order ?? 'desc') === 'asc';
      const { data, error, count } = await query
        .order(col, { ascending: asc })
        .order('id', { ascending: asc })
        .range(page.from, page.to);
      if (error) throw new Error('team list failed');
      return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Team service unavailable');
    }
  },

  get: async (id: string) => {
    try {
      const row = await getRowOrThrow(id);
      const client = serviceClient();
      const { maybeById } = await import('../../repositories/related');
      const [country, venue] = await Promise.all([
        maybeById(client, 'countries', 'id,name,slug', row.country_id as string | null),
        maybeById(client, 'venues', 'id,name,slug', row.venue_id as string | null),
      ]);
      return { ...row, country, venue, dependents: await dependentCounts(id) };
    } catch (error) {
      throw toServiceError(error, 'Team service unavailable');
    }
  },

  create: async (actorId: string, input: AdminTeamCreate) => {
    try {
      if (!input.name || input.name.trim().length === 0) throw badRequest('name is required');
      if (input.name.length > 150) throw badRequest('name too long');
      if (input.short_name !== undefined && input.short_name !== null && input.short_name.length > 80) {
        throw badRequest('short_name too long');
      }
      checkUrls(input.logo_url, input.website_url);
      checkFounded(input.founded_year);
      await validateRefs(input);
      let slug = (input.slug ?? '').toLowerCase();
      if (slug) {
        if (!/^[A-Za-z0-9_.-]+$/.test(slug)) throw badRequest('Invalid slug');
      } else {
        slug = slugBase(input.name);
      }
      slug = await ensureUniqueSlug(slug);
      const client = serviceClient() as AnyClient;
      const { data, error } = await client
        .from('teams')
        .insert({
          name: input.name,
          slug,
          short_name: input.short_name ?? null,
          country_id: input.country_id ?? null,
          logo_url: input.logo_url ?? null,
          founded_year: input.founded_year ?? null,
          venue_id: input.venue_id ?? null,
          website_url: input.website_url ?? null,
          is_active: input.is_active ?? true,
        })
        .select(COLUMNS)
        .maybeSingle();
      const inserted = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !inserted) throw new Error('team insert failed');
      await writeAdminAudit({ userId: actorId, action: 'teams.create', resource: 'teams', resourceId: String(inserted.id), newData: inserted });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['teams', 'standings', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return inserted;
    } catch (error) {
      throw toServiceError(error, 'Team service unavailable');
    }
  },

  update: async (actorId: string, id: string, patch: AdminTeamPatch) => {
    try {
      const before = await getRowOrThrow(id);
      const merged: Row = { ...before };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) merged[key] = value;
      }
      if (patch.name !== undefined && String(merged.name).trim().length === 0) throw badRequest('name is required');
      checkUrls(merged.logo_url as string | null, merged.website_url as string | null);
      checkFounded(merged.founded_year as number | null);
      await validateRefs({ country_id: patch.country_id, venue_id: patch.venue_id });
      if (patch.slug !== undefined && patch.slug !== before.slug) {
        const candidate = String(patch.slug).toLowerCase();
        if (!/^[A-Za-z0-9_.-]+$/.test(candidate)) throw badRequest('Invalid slug');
        merged.slug = await ensureUniqueSlug(candidate, id);
      }
      const allowed = ['name', 'slug', 'short_name', 'country_id', 'logo_url', 'founded_year', 'venue_id', 'website_url', 'is_active'];
      const update: Record<string, unknown> = {};
      for (const key of allowed) {
        if ((patch as Row)[key] !== undefined) update[key] = merged[key];
      }
      if (Object.keys(update).length === 0) return before;
      const client = serviceClient() as AnyClient;
      const { data, error } = await client.from('teams').update(update).eq('id', id).select(COLUMNS).maybeSingle();
      const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !updated) throw new Error('team update failed');
      await writeAdminAudit({ userId: actorId, action: 'teams.update', resource: 'teams', resourceId: id, previousData: before, newData: updated });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['teams', 'standings', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return updated;
    } catch (error) {
      throw toServiceError(error, 'Team service unavailable');
    }
  },

  remove: async (actorId: string, id: string) => {
    try {
      const before = await getRowOrThrow(id);
      const dependents = await dependentCounts(id);
      const total = Object.values(dependents).reduce((sum, n) => sum + n, 0);
      if (total > 0) {
        throw conflict(
          `Team has ${total} dependent record(s) and cannot be deleted; deactivate it instead (PATCH is_active=false)`,
        );
      }
      const client = serviceClient() as AnyClient;
      const { error } = await client.from('teams').delete().eq('id', id);
      if (error) throw new Error('team delete failed');
      await writeAdminAudit({ userId: actorId, action: 'teams.delete', resource: 'teams', resourceId: id, previousData: before });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['teams', 'standings', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
    } catch (error) {
      throw toServiceError(error, 'Team service unavailable');
    }
  },
};

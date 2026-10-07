/**
 * Step 10 — Admin competitions CRUD service (reuses public.competitions).
 *
 * No new tables. Competitions cascade into seasons, matches,
 * team_competitions and article links — any dependents block hard
 * deletion (409); deactivate via PATCH is_active=false instead.
 */
import { badRequest, conflict, notFound, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { escapeIlike } from '../../lib/validate';
import { writeAdminAudit } from '../audit';

const COLUMNS = 'id,name,short_name,slug,country_id,logo_url,type,gender,is_active,created_at,updated_at';

export interface AdminCompetitionListInput {
  page: number;
  limit: number;
  q?: string;
  countryId?: string;
  type?: string;
  active?: boolean;
  sort?: string;
  order?: string;
}

export interface AdminCompetitionCreate {
  name: string;
  slug?: string;
  short_name?: string | null;
  country_id?: string | null;
  logo_url?: string | null;
  type?: string | null;
  gender?: string | null;
  is_active?: boolean;
}

export type AdminCompetitionPatch = Partial<AdminCompetitionCreate>;

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function getRowOrThrow(id: string): Promise<Row> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('competitions').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw toServiceError(error, 'Competition service unavailable');
  if (!data) throw notFound('Competition');
  return data as Row;
}

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = base.slice(0, 120) || 'competition';
  const client = serviceClient() as AnyClient;
  let candidate = root;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data } = await client.from('competitions').select('id').eq('slug', candidate).maybeSingle();
    const hit = data as { id: string } | null;
    if (!hit || hit.id === excludeId) return candidate;
    candidate = `${root}-${attempt + 2}`;
  }
  throw conflict('Slug collision: unable to generate unique slug');
}

function slugBase(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return base.length > 0 ? base : 'competition';
}

function checkFields(row: Partial<Record<string, unknown>>): void {
  const name = row.name as string | undefined;
  if (name !== undefined && (name.trim().length === 0 || name.length > 150)) throw badRequest('name must be 1..150 chars');
  const shortName = row.short_name as string | null | undefined;
  if (shortName !== undefined && shortName !== null && shortName.length > 80) throw badRequest('short_name too long');
  const logo = row.logo_url as string | null | undefined;
  if (logo !== undefined && logo !== null) {
    if (logo.length > 2000) throw badRequest('logo_url too long');
    if (!(logo.startsWith('http://') || logo.startsWith('https://') || logo.startsWith('/'))) {
      throw badRequest('logo_url must be an http(s) URL or site path');
    }
  }
  const type = row.type as string | null | undefined;
  if (type !== undefined && type !== null && type.length > 30) throw badRequest('type too long');
  const gender = row.gender as string | null | undefined;
  if (gender !== undefined && gender !== null && gender.length > 20) throw badRequest('gender too long');
}

async function dependentCounts(competitionId: string): Promise<Record<string, number>> {
  const client = serviceClient() as AnyClient;
  const probes: Array<[string, string, string]> = [
    ['seasons', 'seasons', 'competition_id'],
    ['matches', 'matches', 'competition_id'],
    ['team_competitions', 'team_competitions', 'competition_id'],
    ['article_competitions', 'article_competitions', 'competition_id'],
  ];
  const entries = await Promise.all(
    probes.map(async ([name, table, column]) => {
      const { count } = (await client.from(table).select('id', { count: 'exact' }).eq(column, competitionId).range(0, 0)) as unknown as {
        count: number | null;
      };
      return [name, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export const adminCompetitionsService = {
  list: async (input: AdminCompetitionListInput) => {
    try {
      const client = serviceClient() as AnyClient;
      const page = paginateInput(input.page, input.limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from('competitions').select(COLUMNS, { count: 'exact' });
      if (input.countryId) query = query.eq('country_id', input.countryId);
      if (input.type) query = query.eq('type', input.type);
      if (input.active !== undefined) query = query.eq('is_active', input.active);
      if (input.q) {
        const term = escapeIlike(input.q);
        if (term.length > 0) query = query.or(`name.ilike.%${term}%,short_name.ilike.%${term}%`);
      }
      const sorts: Record<string, string> = { name: 'name', created_at: 'created_at' };
      const col = sorts[input.sort ?? ''] ?? 'name';
      const asc = col === 'name' ? (input.order ?? 'asc') === 'asc' : (input.order ?? 'desc') === 'asc';
      const { data, error, count } = await query.order(col, { ascending: asc }).order('id', { ascending: asc }).range(page.from, page.to);
      if (error) throw new Error('competition list failed');
      return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Competition service unavailable');
    }
  },

  get: async (id: string) => {
    try {
      const row = await getRowOrThrow(id);
      const client = serviceClient();
      const { maybeById } = await import('../../repositories/related');
      const country = await maybeById(client, 'countries', 'id,name,slug', row.country_id as string | null);
      return { ...row, country, dependents: await dependentCounts(id) };
    } catch (error) {
      throw toServiceError(error, 'Competition service unavailable');
    }
  },

  create: async (actorId: string, input: AdminCompetitionCreate) => {
    try {
      checkFields(input as unknown as Partial<Record<string, unknown>>);
      if (input.country_id) {
        const client = serviceClient() as AnyClient;
        const { data } = await client.from('countries').select('id').eq('id', input.country_id).maybeSingle();
        if (!data) throw badRequest('country_id does not exist');
      }
      let slug = (input.slug ?? '').toLowerCase();
      if (slug) {
        if (!/^[A-Za-z0-9_.-]+$/.test(slug)) throw badRequest('Invalid slug');
      } else {
        slug = slugBase(input.name);
      }
      slug = await ensureUniqueSlug(slug);
      const client = serviceClient() as AnyClient;
      const { data, error } = await client
        .from('competitions')
        .insert({
          name: input.name, slug, short_name: input.short_name ?? null, country_id: input.country_id ?? null,
          logo_url: input.logo_url ?? null, type: input.type ?? null, gender: input.gender ?? null,
          is_active: input.is_active ?? true,
        })
        .select(COLUMNS)
        .maybeSingle();
      const inserted = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !inserted) throw new Error('competition insert failed');
      await writeAdminAudit({ userId: actorId, action: 'competitions.create', resource: 'competitions', resourceId: String(inserted.id), newData: inserted });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['competitions', 'standings', 'matches', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return inserted;
    } catch (error) {
      throw toServiceError(error, 'Competition service unavailable');
    }
  },

  update: async (actorId: string, id: string, patch: AdminCompetitionPatch) => {
    try {
      const before = await getRowOrThrow(id);
      const merged: Row = { ...before };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) merged[key] = value;
      }
      checkFields(merged);
      if (patch.country_id !== undefined && patch.country_id !== null) {
        const client = serviceClient() as AnyClient;
        const { data } = await client.from('countries').select('id').eq('id', patch.country_id).maybeSingle();
        if (!data) throw badRequest('country_id does not exist');
      }
      if (patch.slug !== undefined && patch.slug !== before.slug) {
        const candidate = String(patch.slug).toLowerCase();
        if (!/^[A-Za-z0-9_.-]+$/.test(candidate)) throw badRequest('Invalid slug');
        merged.slug = await ensureUniqueSlug(candidate, id);
      }
      const allowed = ['name', 'slug', 'short_name', 'country_id', 'logo_url', 'type', 'gender', 'is_active'];
      const update: Record<string, unknown> = {};
      for (const key of allowed) {
        if ((patch as Row)[key] !== undefined) update[key] = merged[key];
      }
      if (Object.keys(update).length === 0) return before;
      const client = serviceClient() as AnyClient;
      const { data, error } = await client.from('competitions').update(update).eq('id', id).select(COLUMNS).maybeSingle();
      const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !updated) throw new Error('competition update failed');
      await writeAdminAudit({ userId: actorId, action: 'competitions.update', resource: 'competitions', resourceId: id, previousData: before, newData: updated });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['competitions', 'standings', 'matches', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return updated;
    } catch (error) {
      throw toServiceError(error, 'Competition service unavailable');
    }
  },

  remove: async (actorId: string, id: string) => {
    try {
      const before = await getRowOrThrow(id);
      const dependents = await dependentCounts(id);
      const total = Object.values(dependents).reduce((sum, n) => sum + n, 0);
      if (total > 0) {
        throw conflict(`Competition has ${total} dependent record(s) and cannot be deleted; deactivate it instead (PATCH is_active=false)`);
      }
      const client = serviceClient() as AnyClient;
      const { error } = await client.from('competitions').delete().eq('id', id);
      if (error) throw new Error('competition delete failed');
      await writeAdminAudit({ userId: actorId, action: 'competitions.delete', resource: 'competitions', resourceId: id, previousData: before });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['competitions', 'standings', 'matches', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
    } catch (error) {
      throw toServiceError(error, 'Competition service unavailable');
    }
  },
};

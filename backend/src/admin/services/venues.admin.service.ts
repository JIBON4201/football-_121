/**
 * Step 10 — Admin venues CRUD service (reuses public.venues).
 *
 * No new tables. Teams + matches null out venue_id on venue deletion, so
 * the only hard block is existing references (409); otherwise venues
 * delete cleanly. Venues carry no archive flag.
 */
import { badRequest, conflict, notFound, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { escapeIlike } from '../../lib/validate';
import { writeAdminAudit } from '../audit';

const COLUMNS = 'id,name,slug,city,country_id,capacity,image_url,latitude,longitude,created_at,updated_at';

export interface AdminVenueListInput {
  page: number;
  limit: number;
  q?: string;
  countryId?: string;
  sort?: string;
  order?: string;
}

export interface AdminVenueCreate {
  name: string;
  slug?: string;
  city?: string | null;
  country_id?: string | null;
  capacity?: number | null;
  image_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export type AdminVenuePatch = Partial<AdminVenueCreate>;

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function getRowOrThrow(id: string): Promise<Row> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('venues').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw toServiceError(error, 'Venue service unavailable');
  if (!data) throw notFound('Venue');
  return data as Row;
}

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = base.slice(0, 120) || 'venue';
  const client = serviceClient() as AnyClient;
  let candidate = root;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data } = await client.from('venues').select('id').eq('slug', candidate).maybeSingle();
    const hit = data as { id: string } | null;
    if (!hit || hit.id === excludeId) return candidate;
    candidate = `${root}-${attempt + 2}`;
  }
  throw conflict('Slug collision: unable to generate unique slug');
}

function slugBase(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return base.length > 0 ? base : 'venue';
}

function checkFields(row: Partial<Record<string, unknown>>): void {
  const name = row.name as string | undefined;
  if (name !== undefined && (name.trim().length === 0 || name.length > 200)) throw badRequest('name must be 1..200 chars');
  const city = row.city as string | null | undefined;
  if (city !== undefined && city !== null && city.length > 100) throw badRequest('city too long');
  const capacity = row.capacity as number | null | undefined;
  if (capacity !== undefined && capacity !== null && (!Number.isInteger(capacity) || capacity < 0)) {
    throw badRequest('capacity must be an integer >= 0');
  }
  const image = row.image_url as string | null | undefined;
  if (image !== undefined && image !== null) {
    if (image.length > 2000) throw badRequest('image_url too long');
    if (!(image.startsWith('http://') || image.startsWith('https://') || image.startsWith('/'))) {
      throw badRequest('image_url must be an http(s) URL or site path');
    }
  }
  const lat = row.latitude as number | null | undefined;
  if (lat !== undefined && lat !== null && (typeof lat !== 'number' || lat < -90 || lat > 90)) {
    throw badRequest('latitude must be -90..90');
  }
  const lon = row.longitude as number | null | undefined;
  if (lon !== undefined && lon !== null && (typeof lon !== 'number' || lon < -180 || lon > 180)) {
    throw badRequest('longitude must be -180..180');
  }
}

async function dependentCounts(venueId: string): Promise<Record<string, number>> {
  const client = serviceClient() as AnyClient;
  const entries = await Promise.all(
    [['teams', 'teams', 'venue_id'], ['matches', 'matches', 'venue_id']].map(async ([name, table, column]) => {
      const { count } = (await client.from(table).select('id', { count: 'exact' }).eq(column, venueId).range(0, 0)) as unknown as {
        count: number | null;
      };
      return [name, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export const adminVenuesService = {
  list: async (input: AdminVenueListInput) => {
    try {
      const client = serviceClient() as AnyClient;
      const page = paginateInput(input.page, input.limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from('venues').select(COLUMNS, { count: 'exact' });
      if (input.countryId) query = query.eq('country_id', input.countryId);
      if (input.q) {
        const term = escapeIlike(input.q);
        if (term.length > 0) query = query.or(`name.ilike.%${term}%,city.ilike.%${term}%`);
      }
      const sorts: Record<string, string> = { name: 'name', created_at: 'created_at' };
      const col = sorts[input.sort ?? ''] ?? 'name';
      const asc = col === 'name' ? (input.order ?? 'asc') === 'asc' : (input.order ?? 'desc') === 'asc';
      const { data, error, count } = await query.order(col, { ascending: asc }).order('id', { ascending: asc }).range(page.from, page.to);
      if (error) throw new Error('venue list failed');
      return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Venue service unavailable');
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
      throw toServiceError(error, 'Venue service unavailable');
    }
  },

  create: async (actorId: string, input: AdminVenueCreate) => {
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
        .from('venues')
        .insert({
          name: input.name, slug, city: input.city ?? null, country_id: input.country_id ?? null,
          capacity: input.capacity ?? null, image_url: input.image_url ?? null,
          latitude: input.latitude ?? null, longitude: input.longitude ?? null,
        })
        .select(COLUMNS)
        .maybeSingle();
      const inserted = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !inserted) throw new Error('venue insert failed');
      await writeAdminAudit({ userId: actorId, action: 'venues.create', resource: 'venues', resourceId: String(inserted.id), newData: inserted });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['teams', 'matches', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return inserted;
    } catch (error) {
      throw toServiceError(error, 'Venue service unavailable');
    }
  },

  update: async (actorId: string, id: string, patch: AdminVenuePatch) => {
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
      const allowed = ['name', 'slug', 'city', 'country_id', 'capacity', 'image_url', 'latitude', 'longitude'];
      const update: Record<string, unknown> = {};
      for (const key of allowed) {
        if ((patch as Row)[key] !== undefined) update[key] = merged[key];
      }
      if (Object.keys(update).length === 0) return before;
      const client = serviceClient() as AnyClient;
      const { data, error } = await client.from('venues').update(update).eq('id', id).select(COLUMNS).maybeSingle();
      const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !updated) throw new Error('venue update failed');
      await writeAdminAudit({ userId: actorId, action: 'venues.update', resource: 'venues', resourceId: id, previousData: before, newData: updated });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['teams', 'matches', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
      return updated;
    } catch (error) {
      throw toServiceError(error, 'Venue service unavailable');
    }
  },

  remove: async (actorId: string, id: string) => {
    try {
      const before = await getRowOrThrow(id);
      const dependents = await dependentCounts(id);
      const total = Object.values(dependents).reduce((sum, n) => sum + n, 0);
      if (total > 0) {
        throw conflict(`Venue has ${total} dependent record(s) and cannot be deleted`);
      }
      const client = serviceClient() as AnyClient;
      const { error } = await client.from('venues').delete().eq('id', id);
      if (error) throw new Error('venue delete failed');
      await writeAdminAudit({ userId: actorId, action: 'venues.delete', resource: 'venues', resourceId: id, previousData: before });
      const { invalidateNamespace } = await import('../../lib/cache');
      for (const ns of ['teams', 'matches', 'search', 'seo', 'sitemap']) {
        await invalidateNamespace(ns).catch(() => undefined);
      }
    } catch (error) {
      throw toServiceError(error, 'Venue service unavailable');
    }
  },
};

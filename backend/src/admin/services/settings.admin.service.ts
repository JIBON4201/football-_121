/**
 * Step 12 — Admin site-settings service (reuses public.system_settings).
 *
 * No new tables. Only namespaced catalogue keys are manageable; rows are
 * never created here (PATCH-only) so settings cannot sprawl into secret
 * storage. Values validate against the row's declared type (immutable).
 * Secrets policy: secret-pattern keys are never returned (404) and never
 * writable (403); infrastructure secrets live in env, never in this table.
 */
import { badRequest, forbidden, notFound, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { writeAdminAudit } from '../audit';

const COLUMNS = 'key,value,type,description,updated_by,updated_at';

const CATEGORY_LABELS: Record<string, string> = {
  site: 'Website',
  seo: 'SEO',
  news: 'News',
  football: 'Football',
  social: 'Social',
  contact: 'Contact',
  features: 'Features',
  general: 'General',
};

const MANAGEABLE = /^(site|seo|news|football|social|contact|features|general)\./;
const SECRET = /password|secret|token|api[_-]?key|service[_-]?role|private[_-]?key|encrypt|credential/i;

export function settingCategory(key: string): string {
  const prefix = key.split('.')[0] ?? '';
  return CATEGORY_LABELS[prefix] ?? 'General';
}

function assertManageable(key: string): void {
  if (SECRET.test(key)) throw forbidden('This setting is protected infrastructure configuration');
  if (!MANAGEABLE.test(key)) throw notFound('Setting');
}

export interface AdminSettingsListInput {
  page: number;
  limit: number;
}

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function getRowOrThrow(key: string): Promise<Row> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('system_settings').select(COLUMNS).eq('key', key).maybeSingle();
  if (error) throw toServiceError(error, 'Settings service unavailable');
  if (!data) throw notFound('Setting');
  return data as Row;
}

function checkValue(type: string, value: unknown): void {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') throw badRequest('value must be a string');
      if (value.length > 2000) throw badRequest('value too long (max 2000)');
      break;
    case 'url':
      if (typeof value !== 'string') throw badRequest('value must be a URL string');
      if (value.length > 2000) throw badRequest('value too long (max 2000)');
      if (!(value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/'))) {
        throw badRequest('value must be an http(s) URL or site path');
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') throw badRequest('value must be a boolean');
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest('value must be a finite number');
      break;
    case 'json':
      if (value === undefined) throw badRequest('value is required');
      try {
        JSON.stringify(value);
      } catch {
        throw badRequest('value must be JSON-serializable');
      }
      break;
    default:
      throw badRequest(`Unsupported setting type '${type}'`);
  }
}

function present(row: Row): Row {
  return { ...row, category: settingCategory(String(row.key)) };
}

export const adminSettingsService = {
  list: async (input: AdminSettingsListInput) => {
    try {
      const client = serviceClient() as AnyClient;
      const page = paginateInput(input.page, input.limit);
      const { data, error, count } = await client
        .from('system_settings')
        .select(COLUMNS, { count: 'exact' })
        .order('key', { ascending: true })
        .range(page.from, page.to);
      if (error) throw new Error('settings list failed');
      // Defense in depth: never surface secret-pattern rows even if one
      // were inserted out-of-band.
      const rows = (((data as Row[] | null) ?? []).filter((row) => !SECRET.test(String(row.key)))).map(present);
      return { rows, pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Settings service unavailable');
    }
  },

  get: async (key: string) => {
    try {
      if (SECRET.test(key)) throw notFound('Setting');
      return present(await getRowOrThrow(key));
    } catch (error) {
      throw toServiceError(error, 'Settings service unavailable');
    }
  },

  update: async (actorId: string, key: string, value: unknown) => {
    try {
      assertManageable(key);
      const before = await getRowOrThrow(key);
      checkValue(String(before.type), value);
      const client = serviceClient() as AnyClient;
      const { data, error } = await client
        .from('system_settings')
        .update({ value, updated_by: actorId })
        .eq('key', key)
        .select(COLUMNS)
        .maybeSingle();
      const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !updated) throw new Error('settings update failed');
      await writeAdminAudit({
        userId: actorId,
        action: 'settings.update',
        resource: 'settings',
        previousData: { key, value: before.value },
        newData: { key, value: updated.value },
      });
      return present(updated);
    } catch (error) {
      throw toServiceError(error, 'Settings service unavailable');
    }
  },
};

/**
 * Step 13 — Admin users service (reuses auth.users + profiles + user_roles).
 *
 * Identity lives in Supabase Auth; this service never stores passwords,
 * tokens or secrets. Invites create the auth user via the Admin API
 * (seam-stubbed in tests), then mirror profile + role rows idempotently
 * (production trigger may race us — upserts win). Deletes REVOKE (strip
 * staff roles, keep base 'user') rather than destroying identity.
 * The last active super_admin can never be suspended or de-roled (409).
 */
import { badRequest, conflict, forbidden, notFound, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { escapeIlike } from '../../lib/validate';
import { writeAdminAudit } from '../audit';

const COLUMNS = 'user_id,display_name,username,avatar_url,status,created_at,updated_at';

export interface AdminUserListInput {
  page: number;
  limit: number;
  q?: string;
  role?: string;
  status?: string;
  sort?: string;
  order?: string;
}

export interface AdminUserInvite {
  email: string;
  display_name?: string | null;
  roleIds?: number[];
}

export interface AdminUserPatch {
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  status?: string;
  roleIds?: number[];
}

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// ── Supabase Auth seam (stubbed in tests; no passwords ever touch our DB) ──

export interface CreatedAuthUser {
  id: string;
  email: string;
}

type AuthUserCreator = (email: string, displayName?: string | null) => Promise<CreatedAuthUser>;

async function defaultAuthUserCreator(email: string, displayName?: string | null): Promise<CreatedAuthUser> {
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : {},
  });
  if (error || !data.user) throw new Error('auth user creation failed');
  return { id: data.user.id, email: data.user.email ?? email };
}

let authUserCreator: AuthUserCreator = defaultAuthUserCreator;

export function setAuthUserCreator(creator: AuthUserCreator): void {
  authUserCreator = creator;
}

export function resetAuthUserCreator(): void {
  authUserCreator = defaultAuthUserCreator;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function roleIdByName(name: string): Promise<number | null> {
  const client = serviceClient() as AnyClient;
  const { data } = await client.from('roles').select('id').eq('name', name).maybeSingle();
  return ((data as { id: number } | null)?.id ?? null) as number | null;
}

async function roleIdsForUser(userId: string): Promise<number[]> {
  const client = serviceClient() as AnyClient;
  const { data } = await client.from('user_roles').select('role_id').eq('user_id', userId);
  return ((data as Array<{ role_id: number }> | null) ?? []).map((row) => row.role_id);
}

async function roleNamesByIds(ids: number[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const client = serviceClient() as AnyClient;
  const { data } = await client.from('roles').select('id,name').in('id', ids);
  return ((data as Array<{ id: number; name: string }> | null) ?? []).map((row) => row.name);
}

/** User ids that are active AND hold super_admin (empty when none). */
async function activeSuperAdminIds(): Promise<string[]> {
  const superId = await roleIdByName('super_admin');
  if (superId === null) return [];
  const client = serviceClient() as AnyClient;
  const { data: memberships } = await client.from('user_roles').select('user_id').eq('role_id', superId);
  const ids = ((memberships as Array<{ user_id: string }> | null) ?? []).map((row) => row.user_id);
  if (ids.length === 0) return [];
  const { data: profiles } = await client.from('profiles').select('user_id,status').in('user_id', ids);
  return ((profiles as Array<{ user_id: string; status: string }> | null) ?? [])
    .filter((row) => row.status === 'active')
    .map((row) => row.user_id);
}

async function assertRoleIdsExist(roleIds: number[]): Promise<void> {
  if (roleIds.length === 0) return;
  const client = serviceClient() as AnyClient;
  const { data } = await client.from('roles').select('id').in('id', roleIds);
  const found = new Set(((data as Array<{ id: number }> | null) ?? []).map((row) => row.id));
  const missing = roleIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw badRequest(`Unknown role id(s): ${missing.join(',')}`);
}

async function getProfileOrThrow(userId: string): Promise<Row> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('profiles').select(COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) throw toServiceError(error, 'User service unavailable');
  if (!data) throw notFound('Admin user');
  return data as Row;
}

async function attachRoles(rows: Row[]): Promise<Array<Row & { roles: string[] }>> {
  if (rows.length === 0) return [];
  const client = serviceClient() as AnyClient;
  const ids = rows.map((row) => row.user_id as string);
  const [{ data: memberships }, { data: roles }] = await Promise.all([
    client.from('user_roles').select('user_id,role_id').in('user_id', ids),
    client.from('roles').select('id,name'),
  ]);
  const names = new Map(((roles as Array<{ id: number; name: string }> | null) ?? []).map((r) => [r.id, r.name]));
  const byUser = new Map<string, string[]>();
  for (const m of ((memberships as Array<{ user_id: string; role_id: number }> | null) ?? [])) {
    const list = byUser.get(m.user_id) ?? [];
    const name = names.get(m.role_id);
    if (name) list.push(name);
    byUser.set(m.user_id, list);
  }
  return rows.map((row) => ({ ...row, roles: (byUser.get(row.user_id as string) ?? []).sort() }));
}

async function replaceRoles(userId: string, roleIds: number[]): Promise<void> {
  const client = serviceClient() as AnyClient;
  const baseId = await roleIdByName('user');
  const full = [...new Set([...roleIds, ...(baseId !== null ? [baseId] : [])])];
  await client.from('user_roles').delete().eq('user_id', userId);
  if (full.length > 0) {
    const { error } = await client.from('user_roles').insert(full.map((role_id) => ({ user_id: userId, role_id })));
    if (error) throw new Error('role assignment failed');
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

export const adminUsersService = {
  list: async (input: AdminUserListInput) => {
    try {
      let roleUserIds: string[] | null | undefined;
      if (input.role) {
        const roleId = await roleIdByName(input.role);
        if (roleId === null) {
          const { paginateInput: paginate, buildPagination: build } = await import('../../lib/pagination');
          const page = paginate(input.page, input.limit);
          return { rows: [], pagination: build(0, page) };
        }
        const client = serviceClient() as AnyClient;
        const { data } = await client.from('user_roles').select('user_id').eq('role_id', roleId).range(0, 499);
        roleUserIds = ((data as Array<{ user_id: string }> | null) ?? []).map((row) => row.user_id);
        if (roleUserIds.length === 0) {
          const { paginateInput: paginate, buildPagination: build } = await import('../../lib/pagination');
          const page = paginate(input.page, input.limit);
          return { rows: [], pagination: build(0, page) };
        }
      }
      const client = serviceClient() as AnyClient;
      const page = paginateInput(input.page, input.limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from('profiles').select(COLUMNS, { count: 'exact' });
      if (roleUserIds) query = query.in('user_id', roleUserIds);
      if (input.status) query = query.eq('status', input.status);
      if (input.q) {
        const term = escapeIlike(input.q);
        if (term.length > 0) query = query.or(`display_name.ilike.%${term}%,username.ilike.%${term}%`);
      }
      const sorts: Record<string, string> = { created_at: 'created_at', display_name: 'display_name' };
      const col = sorts[input.sort ?? ''] ?? 'created_at';
      const asc = (input.order ?? 'desc') === 'asc';
      const { data, error, count } = await query.order(col, { ascending: asc }).order('user_id', { ascending: asc }).range(page.from, page.to);
      if (error) throw new Error('user list failed');
      const rows = await attachRoles((data as Row[] | null) ?? []);
      return { rows, pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'User service unavailable');
    }
  },

  get: async (id: string) => {
    try {
      const row = await getProfileOrThrow(id);
      const roleIds = await roleIdsForUser(id);
      const roles = await roleNamesByIds(roleIds);
      return { ...row, roles: roles.sort() };
    } catch (error) {
      throw toServiceError(error, 'User service unavailable');
    }
  },

  invite: async (actorId: string, input: AdminUserInvite) => {
    try {
      const roleIds = input.roleIds ?? [];
      await assertRoleIdsExist(roleIds);
      const created = await authUserCreator(input.email, input.display_name ?? null).catch(() => {
        throw new Error('auth user creation failed');
      });
      const client = serviceClient() as AnyClient;
      // Idempotent mirrors (production trigger may race us).
      await client.from('profiles').upsert(
        { user_id: created.id, display_name: input.display_name ?? null, status: 'active' },
        { onConflict: 'user_id' },
      );
      const baseId = await roleIdByName('user');
      const full = [...new Set([...roleIds, ...(baseId !== null ? [baseId] : [])])];
      if (full.length > 0) {
        await client.from('user_roles').upsert(
          full.map((role_id) => ({ user_id: created.id, role_id })),
          { onConflict: 'user_id,role_id' },
        );
      }
      await writeAdminAudit({
        userId: actorId, action: 'users.create', resource: 'users', resourceId: created.id,
        newData: { email: input.email, roles: await roleNamesByIds(full) },
      });
      return { id: created.id, email: created.email, roles: await roleNamesByIds(full) };
    } catch (error) {
      throw toServiceError(error, 'User service unavailable');
    }
  },

  update: async (
    actorId: string,
    id: string,
    patch: { display_name?: string | null; username?: string | null; avatar_url?: string | null; status?: string; roleIds?: number[] },
  ) => {
    try {
      const before = await getProfileOrThrow(id);
      if (patch.username !== undefined && patch.username !== null) {
        const client = serviceClient() as AnyClient;
        const { data } = await client.from('profiles').select('user_id').eq('username', patch.username).maybeSingle();
        const hit = data as { user_id: string } | null;
        if (hit && hit.user_id !== id) throw conflict('username is taken');
      }
      if (patch.status !== undefined && !['active', 'suspended', 'deleted'].includes(patch.status)) {
        throw badRequest('status must be active, suspended or deleted');
      }
      if (patch.status !== undefined && patch.status !== 'active') {
        const sole = await activeSuperAdminIds();
        if (sole.length === 1 && sole[0] === id) {
          throw conflict('Cannot disable the last active super_admin');
        }
      }
      let roleNames: string[] | undefined;
      if (patch.roleIds !== undefined) {
        await assertRoleIdsExist(patch.roleIds);
        const superId = await roleIdByName('super_admin');
        if (superId !== null && !patch.roleIds.includes(superId)) {
          const sole = await activeSuperAdminIds();
          if (sole.length === 1 && sole[0] === id) {
            throw conflict('Cannot remove super_admin from the last active super_admin');
          }
        }
        await replaceRoles(id, patch.roleIds);
        roleNames = await roleNamesByIds(await roleIdsForUser(id));
      }
      const update: Record<string, unknown> = {};
      for (const key of ['display_name', 'username', 'avatar_url', 'status'] as const) {
        if (patch[key] !== undefined) update[key] = patch[key];
      }
      const client = serviceClient() as AnyClient;
      let after = before;
      if (Object.keys(update).length > 0) {
        const { data, error } = await client.from('profiles').update(update).eq('user_id', id).select(COLUMNS).maybeSingle();
        const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
        if (error || !updated) throw new Error('user update failed');
        after = updated;
      }
      const result = roleNames ? { ...after, roles: roleNames.sort() } : after;
      await writeAdminAudit({ userId: actorId, action: 'users.update', resource: 'users', resourceId: id, previousData: before, newData: result });
      return result;
    } catch (error) {
      throw toServiceError(error, 'User service unavailable');
    }
  },

  revoke: async (actorId: string, id: string) => {
    try {
      const before = await getProfileOrThrow(id);
      const sole = await activeSuperAdminIds();
      if (sole.length === 1 && sole[0] === id) {
        throw conflict('Cannot revoke the last active super_admin');
      }
      const client = serviceClient() as AnyClient;
      const baseId = await roleIdByName('user');
      const { data: staff } = await client.from('user_roles').select('role_id').eq('user_id', id);
      const staffIds = ((staff as Array<{ role_id: number }> | null) ?? [])
        .map((row) => row.role_id)
        .filter((roleId) => roleId !== baseId);
      if (staffIds.length > 0) {
        await client.from('user_roles').delete().eq('user_id', id).in('role_id', staffIds);
      }
      if (baseId !== null) {
        await client.from('user_roles').upsert({ user_id: id, role_id: baseId }, { onConflict: 'user_id,role_id' });
      }
      await writeAdminAudit({ userId: actorId, action: 'users.revoke', resource: 'users', resourceId: id, previousData: before });
      return { id, revoked: true };
    } catch (error) {
      throw toServiceError(error, 'User service unavailable');
    }
  },
};

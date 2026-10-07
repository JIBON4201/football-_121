/**
 * Step 13 — Admin roles service (reuses public.roles + grants).
 *
 * Role names mirror the app_role enum (super_admin/admin/editor/author/
 * moderator/user); names are immutable once created. super_admin grants
 * are immutable (assignment endpoint refuses them); super_admin/admin
 * roles and roles with members cannot be deleted.
 */
import { badRequest, conflict, forbidden, notFound, toServiceError } from '../../lib/errors';
import { serviceClient } from '../../lib/supabase';
import { writeAdminAudit } from '../audit';
import { adminList, type AdminListInput } from './_list';

const COLUMNS = 'id,name,description,created_at';

/** Mirrors the public.app_role enum — validation only, mappings stay in DB. */
export const APP_ROLE_NAMES = ['super_admin', 'admin', 'editor', 'author', 'moderator', 'user'] as const;

const SYSTEM_ROLES = ['super_admin', 'admin'];

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function getRoleOrThrow(id: number): Promise<Row> {
  const client = serviceClient() as AnyClient;
  const { data, error } = await client.from('roles').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw toServiceError(error, 'Role service unavailable');
  if (!data) throw notFound('Role');
  return data as Row;
}

async function permissionKeysForRole(roleId: number): Promise<string[]> {
  const client = serviceClient() as AnyClient;
  const { data: grants } = await client.from('admin_role_permissions').select('permission_id').eq('role_id', roleId);
  const ids = ((grants as Array<{ permission_id: string }> | null) ?? []).map((g) => g.permission_id);
  if (ids.length === 0) return [];
  const { data: perms } = await client.from('admin_permissions').select('key').in('id', ids);
  return (((perms as Array<{ key: string }> | null) ?? []).map((p) => p.key)).sort();
}

async function memberCount(roleId: number): Promise<number> {
  const client = serviceClient() as AnyClient;
  const { count } = (await client.from('user_roles').select('user_id', { count: 'exact' }).eq('role_id', roleId).range(0, 0)) as unknown as {
    count: number | null;
  };
  return count ?? 0;
}

export const adminRolesService = {
  list: async (input: AdminListInput) => {
    const { rows, pagination } = await adminList('roles', COLUMNS, input, undefined, (query) =>
      query.order('id', { ascending: true }),
    );
    const withCounts = await Promise.all(
      (rows as Row[]).map(async (row) => ({ ...row, memberCount: await memberCount(row.id as number) })),
    );
    return { rows: withCounts, pagination };
  },

  get: async (id: number) => {
    try {
      const row = await getRoleOrThrow(id);
      return { ...row, permissions: await permissionKeysForRole(id), memberCount: await memberCount(id) };
    } catch (error) {
      throw toServiceError(error, 'Role service unavailable');
    }
  },

  create: async (actorId: string, input: { name: string; description?: string | null }) => {
    try {
      if (!(APP_ROLE_NAMES as readonly string[]).includes(input.name)) {
        throw badRequest(`name must be one of: ${APP_ROLE_NAMES.join(', ')}`);
      }
      const client = serviceClient() as AnyClient;
      const { data: existing } = await client.from('roles').select('id').eq('name', input.name).maybeSingle();
      if (existing) throw conflict('Role already exists');
      const { data: all } = await client.from('roles').select('id');
      const maxId = Math.max(0, ...(((all as Array<{ id: number }> | null) ?? []).map((r) => r.id)));
      const { data, error } = await client
        .from('roles')
        .insert({ id: maxId + 1, name: input.name, description: input.description ?? null })
        .select(COLUMNS)
        .maybeSingle();
      const inserted = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !inserted) throw new Error('role insert failed');
      await writeAdminAudit({ userId: actorId, action: 'roles.create', resource: 'roles', resourceId: String(inserted.id), newData: inserted });
      return inserted;
    } catch (error) {
      throw toServiceError(error, 'Role service unavailable');
    }
  },

  update: async (actorId: string, id: number, patch: { description?: string | null }) => {
    try {
      const before = await getRoleOrThrow(id);
      const client = serviceClient() as AnyClient;
      const { data, error } = await client
        .from('roles')
        .update({ description: patch.description ?? null })
        .eq('id', id)
        .select(COLUMNS)
        .maybeSingle();
      const updated = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (error || !updated) throw new Error('role update failed');
      await writeAdminAudit({ userId: actorId, action: 'roles.update', resource: 'roles', resourceId: String(id), previousData: before, newData: updated });
      return updated;
    } catch (error) {
      throw toServiceError(error, 'Role service unavailable');
    }
  },

  remove: async (actorId: string, id: number) => {
    try {
      const before = await getRoleOrThrow(id);
      if ((SYSTEM_ROLES as string[]).includes(String(before.name))) {
        throw forbidden(`${before.name} is a system role and cannot be deleted`);
      }
      if ((await memberCount(id)) > 0) {
        throw conflict('Role is assigned to users and cannot be deleted');
      }
      const client = serviceClient() as AnyClient;
      await client.from('admin_role_permissions').delete().eq('role_id', id);
      const { error } = await client.from('roles').delete().eq('id', id);
      if (error) throw new Error('role delete failed');
      await writeAdminAudit({ userId: actorId, action: 'roles.delete', resource: 'roles', resourceId: String(id), previousData: before });
    } catch (error) {
      throw toServiceError(error, 'Role service unavailable');
    }
  },

  setPermissions: async (actorId: string, id: number, permissionIds: string[]) => {
    try {
      const role = await getRoleOrThrow(id);
      if (String(role.name) === 'super_admin') {
        throw forbidden('super_admin grants are immutable');
      }
      const client = serviceClient() as AnyClient;
      if (permissionIds.length > 0) {
        const { data } = await client.from('admin_permissions').select('id,key').in('id', permissionIds);
        const found = new Map(((data as Array<{ id: string; key: string }> | null) ?? []).map((p) => [p.id, p.key]));
        const unknown = permissionIds.filter((pid) => !found.has(pid));
        if (unknown.length > 0) throw badRequest(`Unknown permission id(s): ${unknown.join(',')}`);
      }
      const before = await permissionKeysForRole(id);
      const { data: current } = await client.from('admin_role_permissions').select('permission_id').eq('role_id', id);
      const currentIds = new Set(((current as Array<{ permission_id: string }> | null) ?? []).map((g) => g.permission_id));
      const wanted = new Set(permissionIds);
      const toDelete = [...currentIds].filter((pid) => !wanted.has(pid));
      const toInsert = [...wanted].filter((pid) => !currentIds.has(pid));
      if (toDelete.length > 0) {
        await client.from('admin_role_permissions').delete().eq('role_id', id).in('permission_id', toDelete);
      }
      if (toInsert.length > 0) {
        const { error } = await client.from('admin_role_permissions').insert(toInsert.map((permission_id) => ({ role_id: id, permission_id })));
        if (error) throw new Error('permission assignment failed');
      }
      const after = await permissionKeysForRole(id);
      await writeAdminAudit({
        userId: actorId, action: 'roles.permissions', resource: 'roles', resourceId: String(id),
        previousData: { permissions: before }, newData: { permissions: after },
      });
      return { roleId: id, permissions: after };
    } catch (error) {
      throw toServiceError(error, 'Role service unavailable');
    }
  },
};

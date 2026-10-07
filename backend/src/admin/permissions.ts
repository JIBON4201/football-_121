/**
 * Step 3 — Admin identity resolution.
 *
 * Reuses Supabase Auth as the sole identity provider. The JWT is verified by
 * `authenticate()` (src/middleware/auth.ts); this module maps the verified
 * user id to an admin context using ONLY server-side database state:
 *
 *   profiles (status) -> user_roles (role ids)
 *     -> admin_role_permissions -> admin_permissions (keys)
 *
 * Never reads role/permission claims from headers, body, or query.
 * A normal website user (role 'user', zero admin grants) resolves to
 * "not an admin" and every admin guard returns 403.
 */
import { serviceClient } from '../lib/supabase';

export type AdminStatus = 'active' | 'suspended' | 'deleted' | string;

export interface AdminIdentity {
  userId: string;
  email?: string;
  status: AdminStatus;
  roles: string[];
  roleIds: number[];
  permissions: string[];
}

type IdentityFetcher = (userId: string) => Promise<AdminIdentity | null>;

async function defaultIdentityFetcher(userId: string): Promise<AdminIdentity | null> {
  const db = serviceClient();

  // 1. Must exist in admin_users (profiles) and be active. Disabled accounts
  //    (suspended/deleted) resolve to null -> 403, never 401 (they ARE authenticated).
  const { data: profile, error: profileError } = (await db
    .from('profiles')
    .select('user_id,status')
    .eq('user_id', userId)
    .maybeSingle()) as unknown as {
    data: { user_id: string; status: string } | null;
    error: unknown;
  };
  if (profileError || !profile || profile.status !== 'active') return null;

  // 2. Role ids (no names needed for enforcement; names loaded for observability).
  const { data: memberships, error: membershipError } = (await db
    .from('user_roles')
    .select('role_id')
    .eq('user_id', userId)) as unknown as {
    data: Array<{ role_id: number }> | null;
    error: unknown;
  };
  if (membershipError || !memberships) return null;
  const roleIds = [...new Set(memberships.map((m) => m.role_id))];
  if (roleIds.length === 0) return null;

  // 3. Permission ids granted to those roles (the ONLY source of authority).
  const { data: grants, error: grantsError } = (await db
    .from('admin_role_permissions')
    .select('permission_id')
    .in('role_id', roleIds)) as unknown as {
    data: Array<{ permission_id: string }> | null;
    error: unknown;
  };
  if (grantsError || !grants) return null;
  const permissionIds = [...new Set(grants.map((g) => g.permission_id))];
  if (permissionIds.length === 0) return null;

  // 4. Permission keys (resource.action).
  const { data: permissions, error: permissionsError } = (await db
    .from('admin_permissions')
    .select('key')
    .in('id', permissionIds)) as unknown as {
    data: Array<{ key: string }> | null;
    error: unknown;
  };
  if (permissionsError || !permissions) return null;
  const keys = [...new Set(permissions.map((p) => p.key).filter(Boolean))];
  // Zero grants -> not an admin (normal website user lands here).
  if (keys.length === 0) return null;

  // 5. Role names for logs/audit only (never for decisions).
  let roles: string[] = [];
  try {
    const { data: roleRows } = (await db
      .from('roles')
      .select('id,name')
      .in('id', roleIds)) as unknown as {
      data: Array<{ id: number; name: string }> | null;
    };
    roles = (roleRows ?? []).map((r) => r.name).filter(Boolean);
  } catch {
    roles = [];
  }

  return { userId, status: profile.status, roles, roleIds, permissions: keys };
}

let identityFetcher: IdentityFetcher = defaultIdentityFetcher;

/** Test seam: stub admin identity resolution. */
export function setAdminIdentityFetcher(fetcher: IdentityFetcher): void {
  identityFetcher = fetcher;
}

export function resetAdminIdentityFetcher(): void {
  identityFetcher = defaultIdentityFetcher;
}

/**
 * Resolve the admin identity for a verified user id.
 * Returns null when the caller is not an (active, granted) admin.
 * Never throws for missing rows — absence means "not authorized".
 */
export async function resolveAdminIdentity(userId: string): Promise<AdminIdentity | null> {
  try {
    return await identityFetcher(userId);
  } catch {
    return null;
  }
}

export function hasPermission(identity: AdminIdentity, key: string): boolean {
  return identity.permissions.includes(key);
}

export function hasAnyPermission(identity: AdminIdentity, keys: readonly string[]): boolean {
  return keys.some((key) => identity.permissions.includes(key));
}

export function hasAllPermissions(identity: AdminIdentity, keys: readonly string[]): boolean {
  return keys.every((key) => identity.permissions.includes(key));
}

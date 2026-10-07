import { serviceClient } from './supabase';

export const STAFF_ROLES = ['super_admin', 'admin', 'editor', 'author', 'moderator'] as const;
export const EDITOR_ROLES = ['super_admin', 'admin', 'editor'] as const;
export const ADMIN_ROLES = ['super_admin', 'admin'] as const;

export type RoleName = (typeof STAFF_ROLES)[number] | 'user';

type RoleFetcher = (userId: string) => Promise<string[]>;

async function defaultRoleFetcher(userId: string): Promise<string[]> {
  const { data, error } = await serviceClient()
    .from('user_roles')
    .select('roles!inner(name)')
    .eq('user_id', userId);
  if (error || !data) return [];
  return (data as Array<{ roles: { name: string } | Array<{ name: string }> }>).map((row) => {
    const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    return role?.name ?? '';
  });
}

let roleFetcher: RoleFetcher = defaultRoleFetcher;

/** Test seam: stub role resolution. */
export function setRoleFetcher(fetcher: RoleFetcher): void {
  roleFetcher = fetcher;
}

export function resetRoleFetcher(): void {
  roleFetcher = defaultRoleFetcher;
}

export async function getUserRoles(userId: string): Promise<string[]> {
  try {
    return await roleFetcher(userId);
  } catch {
    return [];
  }
}

export async function userHasAnyRole(userId: string, roles: readonly string[]): Promise<boolean> {
  const assigned = await getUserRoles(userId);
  return roles.some((role) => assigned.includes(role));
}

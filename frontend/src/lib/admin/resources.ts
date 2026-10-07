/**
 * Typed Control Center resources.
 *
 * One place that maps each admin module to its real `/api/v1/admin/*` endpoint.
 * Pages and server actions import from here instead of hand-rolling fetch calls,
 * so a route rename is a single edit and every module gets identical status
 * handling, pagination and `no-store` reads.
 *
 * Paths mirror the backend router mounts in `src/routes/v1/admin.routes.ts`.
 * Nothing here writes to Supabase — every mutation goes through the admin API,
 * which is the only layer authorized to use the service-role key.
 */
import { adminClient, createAdminResource, toAdminError, type AdminResult, type AdminPage } from './resource';
import type {
  AdminAuditLogRow,
  AdminCompetitionCreateInput,
  AdminCompetitionRow,
  AdminCompetitionUpdateInput,
  AdminMediaRow,
  AdminMediaUpdateInput,
  AdminPermissionRow,
  AdminPlayerCreateInput,
  AdminPlayerRow,
  AdminPlayerUpdateInput,
  AdminRoleRow,
  AdminSeasonCreateInput,
  AdminSeasonRow,
  AdminSeasonUpdateInput,
  AdminSettingRow,
  AdminTeamCreateInput,
  AdminTeamRow,
  AdminTeamUpdateInput,
  AdminUserRow,
  AdminVenueCreateInput,
  AdminVenueRow,
  AdminVenueUpdateInput,
} from '@/types/api';

export type { AdminResult, AdminPage };

export const adminTeams = createAdminResource<AdminTeamRow, AdminTeamCreateInput, AdminTeamUpdateInput>({
  path: '/admin/teams',
  label: 'Team',
});

export const adminPlayers = createAdminResource<AdminPlayerRow, AdminPlayerCreateInput, AdminPlayerUpdateInput>({
  path: '/admin/players',
  label: 'Player',
});

export const adminCompetitions = createAdminResource<
  AdminCompetitionRow,
  AdminCompetitionCreateInput,
  AdminCompetitionUpdateInput
>({
  path: '/admin/competitions',
  label: 'Competition',
});

export const adminSeasons = createAdminResource<AdminSeasonRow, AdminSeasonCreateInput, AdminSeasonUpdateInput>({
  path: '/admin/seasons',
  label: 'Season',
});

export const adminVenues = createAdminResource<AdminVenueRow, AdminVenueCreateInput, AdminVenueUpdateInput>({
  path: '/admin/venues',
  label: 'Venue',
});

/**
 * Media has no `POST` here even though the backend exposes one: uploads go
 * through the multipart `POST /admin/media` endpoint in `media.service.ts`,
 * which needs the base64 upload envelope rather than a JSON body. Listing,
 * patching metadata and deleting are all reachable through this resource.
 */
export const adminMedia = createAdminResource<AdminMediaRow, never, AdminMediaUpdateInput>({
  path: '/admin/media',
  label: 'Media',
});

/** Settings are key/value pairs — `PATCH /admin/settings/:key` is the only write. */
export const adminSettings = {
  async list(): Promise<AdminResult<AdminSettingRow[]>> {
    try {
      const envelope = await adminClient().get<AdminSettingRow[]>('/admin/settings', {
        query: { limit: 100 },
        cache: 'no-store',
      });
      return { status: 'ok', data: Array.isArray(envelope?.data) ? envelope.data : [] };
    } catch (error) {
      return toAdminError(error, 'Settings unavailable');
    }
  },
  async update(key: string, value: unknown): Promise<AdminResult<AdminSettingRow>> {
    try {
      const envelope = await adminClient().request<AdminSettingRow>(
        `/admin/settings/${encodeURIComponent(key)}`,
        { method: 'PATCH', body: { value } },
      );
      const row = envelope?.data;
      if (!row || typeof row.key !== 'string') return { status: 'error', message: 'Malformed setting response' };
      return { status: 'ok', data: row };
    } catch (error) {
      return toAdminError(error, 'Setting could not be saved');
    }
  },
};

/**
 * Identity reads (`admin_users`, `admin_roles`, `admin_permissions`) depend on
 * migration 025. Until it is applied these return 503 from the backend, which
 * surfaces as `error` here and renders the page's error state rather than an
 * empty table that looks like "no administrators".
 */
/**
 * Identity reads come from the `admin_users` view, which only exists once
 * migration 025 is applied. Until then the backend answers 503 and this renders
 * the page's error state rather than an empty table that reads as "no users".
 */
export const adminUsers = {
  async list(query: Record<string, string | number | undefined> = {}): Promise<AdminResult<AdminPage<AdminUserRow>>> {
    try {
      const envelope = await adminClient().get<AdminUserRow[]>('/admin/users', { query: { limit: 20, ...query }, cache: 'no-store' });
      const rows = Array.isArray(envelope?.data) ? envelope.data : [];
      const raw = (isObjectRow(envelope?.pagination) ? envelope.pagination : {}) as Record<string, unknown>;
      return {
        status: 'ok',
        data: {
          rows,
          pagination: {
            page: typeof raw.page === 'number' ? raw.page : 1,
            limit: typeof raw.limit === 'number' ? raw.limit : 20,
            total: typeof raw.total === 'number' ? raw.total : rows.length,
            totalPages: typeof raw.totalPages === 'number' ? raw.totalPages : 1,
          },
        },
      };
    } catch (error) {
      return toAdminError(error, 'Users unavailable');
    }
  },
  async update(id: string, body: Record<string, unknown>): Promise<AdminResult<AdminUserRow>> {
    try {
      const envelope = await adminClient().request<AdminUserRow>(`/admin/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
      });
      const row = envelope?.data;
      if (!row || typeof row.id !== 'string') return { status: 'error', message: 'Malformed user response' };
      return { status: 'ok', data: row };
    } catch (error) {
      return toAdminError(error, 'User could not be updated');
    }
  },
  async remove(id: string): Promise<AdminResult<{ id: string }>> {
    try {
      await adminClient().request(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return { status: 'ok', data: { id } };
    } catch (error) {
      return toAdminError(error, 'User could not be revoked');
    }
  },
};

function isObjectRow(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export const adminRoles = {
  async list(query: Record<string, string | number | undefined> = {}): Promise<AdminResult<AdminPage<AdminRoleRow>>> {
    try {
      const envelope = await adminClient().get<AdminRoleRow[]>('/admin/roles', { query: { limit: 20, ...query }, cache: 'no-store' });
      const rows = Array.isArray(envelope?.data) ? envelope.data : [];
      const raw = (isObjectRow(envelope?.pagination) ? envelope.pagination : {}) as Record<string, unknown>;
      return {
        status: 'ok',
        data: {
          rows,
          pagination: {
            page: typeof raw.page === 'number' ? raw.page : 1,
            limit: typeof raw.limit === 'number' ? raw.limit : 20,
            total: typeof raw.total === 'number' ? raw.total : rows.length,
            totalPages: typeof raw.totalPages === 'number' ? raw.totalPages : 1,
          },
        },
      };
    } catch (error) {
      return toAdminError(error, 'Roles unavailable');
    }
  },
  async updatePermissions(id: number, permissionIds: string[]): Promise<AdminResult<AdminRoleRow>> {
    try {
      const envelope = await adminClient().request<AdminRoleRow>(`/admin/roles/${id}/permissions`, {
        method: 'PUT',
        // Backend body key is camelCase (`permissionIds`), see
        // admin/roles.routes.ts. Sending `permission_ids` was silently dropped
        // by the zod schema, so a save would have reported success while
        // changing nothing.
        body: { permissionIds },
      });
      return { status: 'ok', data: envelope.data };
    } catch (error) {
      return toAdminError(error, 'Permissions could not be saved');
    }
  },
};
export const adminPermissions = {
  async list(): Promise<AdminResult<AdminPermissionRow[]>> {
    try {
      const envelope = await adminClient().get<AdminPermissionRow[]>('/admin/permissions', {
        query: { limit: 100 },
        cache: 'no-store',
      });
      return { status: 'ok', data: Array.isArray(envelope?.data) ? envelope.data : [] };
    } catch (error) {
      return toAdminError(error, 'Permissions unavailable');
    }
  },
};

export const adminAuditLogs = {
  list: (
    query: Record<string, string | number | undefined> = {},
  ): Promise<AdminResult<AdminPage<AdminAuditLogRow>>> =>
    createAdminResource<AdminAuditLogRow>({ path: '/admin/audit-logs', label: 'Audit log' }).list(query),
};

/** Dashboard keeps its bespoke normaliser in `lib/admin/dashboard.ts`. */
export { fetchAdminDashboard, normalizeDashboard } from './dashboard';
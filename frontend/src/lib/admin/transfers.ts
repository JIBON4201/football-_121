/**
 * Step 19 — Admin transfers data access.
 *
 * Single seam for `/api/v1/admin/transfers`. Transport/retries/envelope come
 * from the shared ApiClient; this module maps status codes to UI states and
 * defensively normalises rows. Business logic (FK validation, enums, date
 * rules) lives in the backend service layer, never here.
 */
import { createApiClient } from '@/lib/api-client';
import { toAdminError, type AdminFailure, type AdminPagination } from './resource';
import { fetchOptionPlayers, fetchOptionTeams, fetchOptionWindows } from './options';
import { getAdminAccessToken } from '@/lib/admin-session';
import { siteConfig } from '@/config/site';
import type {
  AdminTransferCreateInput,
  AdminTransferDetail,
  AdminTransferRow,
  AdminTransferUpdateInput,
} from '@/types/api';
import {
  TRANSFERS_DEFAULT_LIMIT,
  parseTransfersQuery,
  transfersQueryToSearch,
  type AdminTransfersQuery,
} from './transfer-query';

export { TRANSFERS_DEFAULT_LIMIT, parseTransfersQuery, transfersQueryToSearch };
export type { AdminTransfersQuery };

export type TransfersListResult =
  | { status: 'ok'; rows: AdminTransferRow[]; pagination: AdminPagination }
  | AdminFailure;

export type TransferResult =
  | { status: 'ok'; transfer: AdminTransferDetail }
  | AdminFailure;

export type DeleteResult =
  | { status: 'ok' }
  | AdminFailure;

function adminClient() {
  return createApiClient({ baseUrl: siteConfig.apiUrl, getToken: () => getAdminAccessToken() ?? null });
}

function isObjectRow(row: unknown): row is Record<string, unknown> {
  return row !== null && typeof row === 'object' && !Array.isArray(row);
}

const asStrOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNumOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toRow(row: unknown): AdminTransferRow | null {
  if (!isObjectRow(row) || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    player_id: typeof row.player_id === 'string' ? row.player_id : '',
    from_team_id: asStrOrNull(row.from_team_id),
    to_team_id: asStrOrNull(row.to_team_id),
    transfer_type: typeof row.transfer_type === 'string' ? row.transfer_type : 'unknown',
    status: typeof row.status === 'string' ? row.status : 'unknown',
    fee: asNumOrNull(row.fee),
    currency: asStrOrNull(row.currency),
    announcement_date: asStrOrNull(row.announcement_date),
    effective_date: asStrOrNull(row.effective_date),
    season_id: typeof row.season_id === 'string' ? row.season_id : '',
    window_id: asStrOrNull(row.window_id),
    metadata: row.metadata,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

function toDetail(row: unknown): AdminTransferDetail | null {
  const base = toRow(row);
  if (!base) return null;
  const r = row as Record<string, unknown>;
  const ref = (v: unknown): AdminTransferDetail['player'] | null => {
    if (!isObjectRow(v) || typeof v.id !== 'string') return null;
    return { id: v.id, name: asStrOrNull(v.name), display_name: asStrOrNull(v.display_name), slug: asStrOrNull(v.slug) };
  };
  return {
    ...base,
    player: ref(r.player),
    fromTeam: ref(r.fromTeam),
    toTeam: ref(r.toTeam),
    season:
      isObjectRow(r.season) && typeof r.season.id === 'string'
        ? { id: r.season.id, name: typeof r.season.name === 'string' ? r.season.name : '', competition_id: asStrOrNull(r.season.competition_id) }
        : null,
    window:
      isObjectRow(r.window) && typeof r.window.id === 'string'
        ? {
            id: r.window.id,
            name: typeof r.window.name === 'string' ? r.window.name : '',
            season_id: typeof r.window.season_id === 'string' ? r.window.season_id : '',
            start_date: typeof r.window.start_date === 'string' ? r.window.start_date : '',
            end_date: typeof r.window.end_date === 'string' ? r.window.end_date : '',
          }
        : null,
  };
}

export function normalizeTransfersListResult(envelope: unknown): TransfersListResult {
  if (!isObjectRow(envelope)) return { status: 'error', message: 'Malformed response' };
  const rows = Array.isArray(envelope.data)
    ? (envelope.data as unknown[]).map(toRow).filter((r): r is AdminTransferRow => r !== null)
    : [];
  const p = isObjectRow(envelope.pagination) ? envelope.pagination : {};
  return {
    status: 'ok',
    rows,
    pagination: {
      page: typeof p.page === 'number' ? p.page : 1,
      limit: typeof p.limit === 'number' ? p.limit : TRANSFERS_DEFAULT_LIMIT,
      total: typeof p.total === 'number' ? p.total : rows.length,
      totalPages: typeof p.totalPages === 'number' ? p.totalPages : 1,
    },
  };
}

export async function fetchAdminTransfers(query: AdminTransfersQuery): Promise<TransfersListResult> {
  try {
    const envelope = await adminClient().get<AdminTransferRow[]>('/admin/transfers', {
      query: Object.fromEntries(transfersQueryToSearch(query)),
      cache: 'no-store',
    });
    return normalizeTransfersListResult(envelope);
  } catch (error) {
    return toListError(error);
  }
}

export async function fetchAdminTransfer(id: string): Promise<TransferResult> {
  try {
    const envelope = await adminClient().get<AdminTransferDetail>(`/admin/transfers/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    const transfer = toDetail(envelope?.data);
    if (!transfer) return { status: 'error', message: 'Malformed transfer' };
    return { status: 'ok', transfer };
  } catch (error) {
    return toTransferError(error);
  }
}

export async function createAdminTransfer(input: AdminTransferCreateInput): Promise<TransferResult> {
  try {
    const envelope = await adminClient().post<AdminTransferDetail>('/admin/transfers', input);
    const transfer = toDetail(envelope?.data) ?? toRow(envelope?.data);
    if (!transfer) return { status: 'error', message: 'Malformed response' };
    return { status: 'ok', transfer: { ...transfer } };
  } catch (error) {
    return toTransferError(error);
  }
}

export async function updateAdminTransfer(id: string, input: AdminTransferUpdateInput): Promise<TransferResult> {
  try {
    const envelope = await adminClient().request<AdminTransferDetail>(`/admin/transfers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    });
    const transfer = toDetail(envelope?.data) ?? toRow(envelope?.data);
    if (!transfer) return { status: 'error', message: 'Malformed response' };
    return { status: 'ok', transfer: { ...transfer } };
  } catch (error) {
    return toTransferError(error);
  }
}

export async function deleteAdminTransfer(id: string): Promise<DeleteResult> {
  try {
    await adminClient().request(`/admin/transfers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { status: 'ok' };
  } catch (error) {
    return toAdminError(error, 'Request failed');
  }
}

// Delegates to the shared mapper so transfers report every status the same way
// the other admin modules do.
function toListError(error: unknown): TransfersListResult {
  return toAdminError(error, 'Transfers unavailable');
}

function toTransferError(error: unknown): TransferResult {
  return toAdminError(error, 'Request failed');
}

/* Public read-only option lists for the transfer form (players/teams/windows),
 * and the admin seasons list for the required season_id. All are real endpoints. */

export interface OptionRow {
  id: string;
  label: string;
}

/**
 * Option lists delegate to the shared `fetchOptionList` (see `./options`), which
 * uses the project's own API client and the public feeds' cache tags.
 *
 * This previously ran its own `fetch` with `next: { revalidate: 3600 }` and no
 * tags, so a team or player created in the Control Center could take up to an
 * hour to appear in the transfer and match-event pickers. It also bypassed the
 * shared client, so it had no timeout, no retry and no envelope validation.
 */
export function fetchPublicPlayers(): Promise<OptionRow[]> {
  return fetchOptionPlayers();
}

export function fetchPublicTeams(): Promise<OptionRow[]> {
  return fetchOptionTeams();
}

export function fetchPublicWindows(): Promise<OptionRow[]> {
  return fetchOptionWindows();
}

/** Seasons required by the transfer create/update body; admin read grant. */
export async function fetchAdminSeasons(): Promise<OptionRow[]> {
  try {
    const envelope = await adminClient().get<Array<Record<string, unknown>>>('/admin/seasons', {
      query: { limit: 100 },
      cache: 'no-store',
    });
    if (!Array.isArray(envelope?.data)) return [];
    return envelope.data
      .filter((r): r is Record<string, unknown> => isObjectRow(r))
      .map((r) => ({ id: typeof r.id === 'string' ? r.id : '', label: typeof r.name === 'string' ? r.name : '' }))
      .filter((r) => r.id && r.label);
  } catch {
    return [];
  }
}

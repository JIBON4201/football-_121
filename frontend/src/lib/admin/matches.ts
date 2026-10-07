/**
 * Step 20 — Admin matches data access.
 *
 * Single seam for `/api/v1/admin/matches` (+ nested events). ApiClient owns
 * transport/retries/envelope; this module maps status codes and defensively
 * normalises rows. All business logic stays in the backend service layer.
 */
import { createApiClient } from '@/lib/api-client';
import { getAdminAccessToken } from '@/lib/admin-session';
import { siteConfig } from '@/config/site';
import { toAdminError, type AdminFailure, type AdminPagination } from './resource';
import type {
  AdminMatchCreateInput,
  AdminMatchDetail,
  AdminMatchEvent,
  AdminMatchEventCreateInput,
  AdminMatchEventUpdateInput,
  AdminMatchRow,
  AdminMatchUpdateInput,
} from '@/types/api';
import { MATCHES_DEFAULT_LIMIT, matchesQueryToSearch, parseMatchesQuery, type AdminMatchesQuery } from './match-query';

export { MATCHES_DEFAULT_LIMIT, parseMatchesQuery, matchesQueryToSearch };
export type { AdminMatchesQuery };

export type MatchesListResult =
  | { status: 'ok'; rows: AdminMatchRow[]; pagination: AdminPagination }
  | AdminFailure;

export type MatchResult =
  | { status: 'ok'; match: AdminMatchDetail }
  | AdminFailure;

export type EventResult =
  | { status: 'ok'; event: AdminMatchEvent }
  | AdminFailure;

export type EventsListResult =
  | { status: 'ok'; rows: AdminMatchEvent[]; pagination: AdminPagination }
  | AdminFailure;

export type DeleteResult =
  | { status: 'ok' }
  | AdminFailure;

function adminClient() {
  return createApiClient({ baseUrl: siteConfig.apiUrl, getToken: () => getAdminAccessToken() ?? null });
}

function isObjectRow(r: unknown): r is Record<string, unknown> {
  return r !== null && typeof r === 'object' && !Array.isArray(r);
}

const asStrOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNumOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toRow(row: unknown): AdminMatchRow | null {
  if (!isObjectRow(row) || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    slug: typeof row.slug === 'string' ? row.slug : '',
    competition_id: typeof row.competition_id === 'string' ? row.competition_id : '',
    season_id: asStrOrNull(row.season_id),
    venue_id: asStrOrNull(row.venue_id),
    home_team_id: typeof row.home_team_id === 'string' ? row.home_team_id : '',
    away_team_id: typeof row.away_team_id === 'string' ? row.away_team_id : '',
    scheduled_at: typeof row.scheduled_at === 'string' ? row.scheduled_at : '',
    status: typeof row.status === 'string' ? row.status : 'unknown',
    home_score: asNumOrNull(row.home_score),
    away_score: asNumOrNull(row.away_score),
    home_score_ht: asNumOrNull(row.home_score_ht),
    away_score_ht: asNumOrNull(row.away_score_ht),
    home_score_et: asNumOrNull(row.home_score_et),
    away_score_et: asNumOrNull(row.away_score_et),
    home_score_pen: asNumOrNull(row.home_score_pen),
    away_score_pen: asNumOrNull(row.away_score_pen),
    round: asStrOrNull(row.round),
    matchday: asNumOrNull(row.matchday),
    referee_name: asStrOrNull(row.referee_name),
    attendance: asNumOrNull(row.attendance),
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

function toDetail(row: unknown): AdminMatchDetail | null {
  const base = toRow(row);
  if (!base) return null;
  const r = row as Record<string, unknown>;
  const ref = (v: unknown): AdminMatchDetail['homeTeam'] | null =>
    isObjectRow(v) && typeof v.id === 'string' ? { id: v.id, name: typeof v.name === 'string' ? v.name : '', slug: asStrOrNull(v.slug) } : null;
  return {
    ...base,
    homeTeam: ref(r.homeTeam),
    awayTeam: ref(r.awayTeam),
    competition: ref(r.competition),
    season:
      isObjectRow(r.season) && typeof r.season.id === 'string'
        ? { id: r.season.id, name: typeof r.season.name === 'string' ? r.season.name : '', competition_id: asStrOrNull(r.season.competition_id) }
        : null,
    venue: ref(r.venue),
    dependents: isObjectRow(r.dependents) ? (r.dependents as Record<string, number>) : null,
  };
}

function toEvent(row: unknown): AdminMatchEvent | null {
  if (!isObjectRow(row) || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    match_id: typeof row.match_id === 'string' ? row.match_id : '',
    team_id: asStrOrNull(row.team_id),
    player_id: asStrOrNull(row.player_id),
    assist_player_id: asStrOrNull(row.assist_player_id),
    type: typeof row.type === 'string' ? row.type : 'unknown',
    minute: asNumOrNull(row.minute),
    extra_minute: asNumOrNull(row.extra_minute),
    description: asStrOrNull(row.description),
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

function toEventRows(envelope: unknown): AdminMatchEvent[] {
  if (!isObjectRow(envelope) || !Array.isArray(envelope.data)) return [];
  return (envelope.data as unknown[]).map(toEvent).filter((e): e is AdminMatchEvent => e !== null);
}

export function normalizeMatchesListResult(envelope: unknown): MatchesListResult {
  if (!isObjectRow(envelope)) return { status: 'error', message: 'Malformed response' };
  const rows = Array.isArray(envelope.data) ? (envelope.data as unknown[]).map(toRow).filter((r): r is AdminMatchRow => r !== null) : [];
  const p = isObjectRow(envelope.pagination) ? envelope.pagination : {};
  return {
    status: 'ok',
    rows,
    pagination: {
      page: typeof p.page === 'number' ? p.page : 1,
      limit: typeof p.limit === 'number' ? p.limit : MATCHES_DEFAULT_LIMIT,
      total: typeof p.total === 'number' ? p.total : rows.length,
      totalPages: typeof p.totalPages === 'number' ? p.totalPages : 1,
    },
  };
}

export async function fetchAdminMatches(query: AdminMatchesQuery): Promise<MatchesListResult> {
  try {
    const envelope = await adminClient().get<AdminMatchRow[]>('/admin/matches', {
      query: Object.fromEntries(matchesQueryToSearch(query)),
      cache: 'no-store',
    });
    return normalizeMatchesListResult(envelope);
  } catch (error) {
    return toListError(error, 'Matches unavailable');
  }
}

export async function fetchAdminMatch(id: string): Promise<MatchResult> {
  try {
    const envelope = await adminClient().get<AdminMatchDetail>(`/admin/matches/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const match = toDetail(envelope?.data);
    if (!match) return { status: 'error', message: 'Malformed match' };
    return { status: 'ok', match };
  } catch (error) {
    return toItemError(error);
  }
}

export async function createAdminMatch(input: AdminMatchCreateInput): Promise<MatchResult> {
  try {
    const envelope = await adminClient().post<AdminMatchDetail>('/admin/matches', input);
    const match = toDetail(envelope?.data) ?? toRow(envelope?.data);
    if (!match) return { status: 'error', message: 'Malformed response' };
    return { status: 'ok', match };
  } catch (error) {
    return toItemError(error);
  }
}

export async function updateAdminMatch(id: string, input: AdminMatchUpdateInput): Promise<MatchResult> {
  try {
    const envelope = await adminClient().request<AdminMatchDetail>(`/admin/matches/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
    const match = toDetail(envelope?.data) ?? toRow(envelope?.data);
    if (!match) return { status: 'error', message: 'Malformed response' };
    return { status: 'ok', match };
  } catch (error) {
    return toItemError(error);
  }
}

export async function deleteAdminMatch(id: string): Promise<DeleteResult> {
  try {
    await adminClient().request(`/admin/matches/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { status: 'ok' };
  } catch (error) {
    return toDeleteError(error);
  }
}

export async function fetchMatchEvents(matchId: string): Promise<EventsListResult> {
  try {
    const envelope = await adminClient().get<AdminMatchEvent[]>(`/admin/matches/${encodeURIComponent(matchId)}/events`, {
      query: { limit: 50 },
      cache: 'no-store',
    });
    const rows = toEventRows(envelope);
    const p: Record<string, unknown> =
      isObjectRow(envelope) && isObjectRow((envelope as Record<string, unknown>).pagination)
        ? ((envelope as Record<string, unknown>).pagination as Record<string, unknown>)
        : {};
    return {
      status: 'ok',
      rows,
      pagination: {
        page: typeof p.page === 'number' ? p.page : 1,
        limit: typeof p.limit === 'number' ? p.limit : 50,
        total: typeof p.total === 'number' ? p.total : rows.length,
        totalPages: typeof p.totalPages === 'number' ? p.totalPages : 1,
      },
    };
  } catch (error) {
    return toListError(error, 'Match events unavailable');
  }
}

export async function createMatchEvent(matchId: string, input: AdminMatchEventCreateInput): Promise<EventResult> {
  try {
    const envelope = await adminClient().post<AdminMatchEvent>(`/admin/matches/${encodeURIComponent(matchId)}/events`, input);
    const event = toEvent(envelope?.data);
    if (!event) return { status: 'error', message: 'Malformed response' };
    return { status: 'ok', event };
  } catch (error) {
    return toItemError(error);
  }
}

export async function updateMatchEvent(matchId: string, eventId: string, input: AdminMatchEventUpdateInput): Promise<EventResult> {
  try {
    const envelope = await adminClient().request<AdminMatchEvent>(`/admin/matches/${encodeURIComponent(matchId)}/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: input });
    const event = toEvent(envelope?.data);
    if (!event) return { status: 'error', message: 'Malformed response' };
    return { status: 'ok', event };
  } catch (error) {
    return toItemError(error);
  }
}

export async function deleteMatchEvent(matchId: string, eventId: string): Promise<DeleteResult> {
  try {
    await adminClient().request(`/admin/matches/${encodeURIComponent(matchId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    return { status: 'ok' };
  } catch (error) {
    return toDeleteError(error);
  }
}

// All three mappers delegate to the shared mapper so every admin module reports
// 401/403/404/409/400/429/5xx identically — previously each module re-implemented
// this and only ever distinguished 401/403.
type ListError = AdminFailure;
type ItemError = AdminFailure;

function toListError(error: unknown, fallback: string): ListError {
  return toAdminError(error, fallback);
}

function toItemError(error: unknown): ItemError {
  return toAdminError(error, 'Request failed');
}

function toDeleteError(error: unknown): DeleteResult {
  return toAdminError(error, 'Request failed');
}

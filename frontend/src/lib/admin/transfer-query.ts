/**
 * Step 19 — shared, client-safe transfer query helpers.
 *
 * No server-only imports so the filter UI (client) and the server data layer
 * share the same parse/serialise rules. Mirrors the backend list query
 * (q/status/playerId/fromTeamId/toTeamId/windowId/seasonId/date ranges/sort).
 */

export const TRANSFERS_DEFAULT_LIMIT = 20;

export interface AdminTransfersQuery {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  playerId?: string;
  fromTeamId?: string;
  toTeamId?: string;
  windowId?: string;
  seasonId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  sort?: 'asc' | 'desc';
  sortField?: 'announcement_date' | 'effective_date';
}

function asSingle(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

const SORT_FIELDS = ['announcement_date', 'effective_date'] as const;

export function parseTransfersQuery(searchParams: Record<string, string | string[] | undefined>): AdminTransfersQuery {
  const pageRaw = asSingle(searchParams.page);
  const page = pageRaw && /^\d+$/.test(pageRaw) ? Math.max(1, Math.floor(Number(pageRaw))) : 1;

  const limitRaw = asSingle(searchParams.limit);
  const limit =
    limitRaw && /^\d+$/.test(limitRaw) ? Math.min(100, Math.max(1, Math.floor(Number(limitRaw)))) : TRANSFERS_DEFAULT_LIMIT;

  const sortRaw = asSingle(searchParams.sort);
  const sort = sortRaw === 'asc' ? 'asc' : sortRaw === 'desc' ? 'desc' : undefined;

  const sortFieldRaw = asSingle(searchParams.sortField);
  const sortField = sortFieldRaw && (SORT_FIELDS as readonly string[]).includes(sortFieldRaw)
    ? (sortFieldRaw as AdminTransfersQuery['sortField'])
    : undefined;

  return {
    page,
    limit,
    q: asSingle(searchParams.q),
    status: asSingle(searchParams.status),
    playerId: asSingle(searchParams.playerId),
    fromTeamId: asSingle(searchParams.fromTeamId),
    toTeamId: asSingle(searchParams.toTeamId),
    windowId: asSingle(searchParams.windowId),
    seasonId: asSingle(searchParams.seasonId),
    effectiveFrom: asSingle(searchParams.effectiveFrom),
    effectiveTo: asSingle(searchParams.effectiveTo),
    sort,
    sortField,
  };
}

export function transfersQueryToSearch(query: AdminTransfersQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.page > 1) params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.playerId) params.set('playerId', query.playerId);
  if (query.fromTeamId) params.set('fromTeamId', query.fromTeamId);
  if (query.toTeamId) params.set('toTeamId', query.toTeamId);
  if (query.windowId) params.set('windowId', query.windowId);
  if (query.seasonId) params.set('seasonId', query.seasonId);
  if (query.effectiveFrom) params.set('effectiveFrom', query.effectiveFrom);
  if (query.effectiveTo) params.set('effectiveTo', query.effectiveTo);
  if (query.sort) params.set('sort', query.sort);
  if (query.sortField) params.set('sortField', query.sortField);
  return params;
}

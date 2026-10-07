/**
 * Step 20 — shared, client-safe match query helpers (no server-only imports).
 * Mirrors the backend admin match list query (q/status/competitionId/seasonId/
 * teamId/from/to/sort).
 */

export const MATCHES_DEFAULT_LIMIT = 20;

export interface AdminMatchesQuery {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  competitionId?: string;
  seasonId?: string;
  teamId?: string;
  from?: string;
  to?: string;
  sort?: 'asc' | 'desc';
}

function asSingle(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

const asDate = (v: string | string[] | undefined): string | undefined => {
  const s = asSingle(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};

export function parseMatchesQuery(searchParams: Record<string, string | string[] | undefined>): AdminMatchesQuery {
  const pageRaw = asSingle(searchParams.page);
  const page = pageRaw && /^\d+$/.test(pageRaw) ? Math.max(1, Math.floor(Number(pageRaw))) : 1;
  const limitRaw = asSingle(searchParams.limit);
  const limit = limitRaw && /^\d+$/.test(limitRaw) ? Math.min(100, Math.max(1, Math.floor(Number(limitRaw)))) : MATCHES_DEFAULT_LIMIT;
  const sortRaw = asSingle(searchParams.sort);
  const sort = sortRaw === 'asc' ? 'asc' : sortRaw === 'desc' ? 'desc' : undefined;
  return {
    page,
    limit,
    q: asSingle(searchParams.q),
    status: asSingle(searchParams.status),
    competitionId: asSingle(searchParams.competitionId),
    seasonId: asSingle(searchParams.seasonId),
    teamId: asSingle(searchParams.teamId),
    from: asDate(searchParams.from),
    to: asDate(searchParams.to),
    sort,
  };
}

export function matchesQueryToSearch(query: AdminMatchesQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.page > 1) params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.competitionId) params.set('competitionId', query.competitionId);
  if (query.seasonId) params.set('seasonId', query.seasonId);
  if (query.teamId) params.set('teamId', query.teamId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.sort) params.set('sort', query.sort);
  return params;
}

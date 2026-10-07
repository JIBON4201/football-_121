/**
 * Step 17 — Admin Dashboard data access.
 *
 * One seam for the dashboard aggregate: the only place the UI touches
 * `GET /api/v1/admin/dashboard`. No business logic and no second query
 * system — the existing API client owns transport, envelope handling and
 * safe GET retries; this module owns the response → typed state mapping and
 * the defensive shape guard.
 */
import { ApiClientError, createApiClient } from '@/lib/api-client';
import { getAdminAccessToken } from '@/lib/admin-session';
import { siteConfig } from '@/config/site';
import type {
  AdminDashboard,
  AdminDashboardActivityEntry,
  AdminDashboardArticleCard,
  AdminDashboardMatchCard,
  AdminDashboardNamedRef,
  AdminDashboardSync,
  AdminDashboardSyncDomain,
  AdminDashboardSyncError,
  AdminDashboardSyncSource,
  AdminDashboardTransferCard,
  AdminTransferWindow,
} from '@/types/api';

export type AdminDashboardResult =
  | { status: 'ok'; data: AdminDashboard }
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

function isObjectRow(row: unknown): row is Record<string, unknown> {
  return row !== null && typeof row === 'object' && !Array.isArray(row);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isObjectRow(value) ? value : {};
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function asNamedRef(value: unknown): AdminDashboardNamedRef | null {
  if (!isObjectRow(value) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    name: typeof value.name === 'string' && value.name.length > 0 ? value.name : value.id,
    slug: typeof value.slug === 'string' ? value.slug : '',
  };
}

function asMinute(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function asDateString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toMatchCard(row: unknown): AdminDashboardMatchCard | null {
  if (!isObjectRow(row) || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    slug: typeof row.slug === 'string' ? row.slug : '',
    home_team_id: typeof row.home_team_id === 'string' ? row.home_team_id : '',
    away_team_id: typeof row.away_team_id === 'string' ? row.away_team_id : '',
    scheduled_at: typeof row.scheduled_at === 'string' ? row.scheduled_at : '',
    status: typeof row.status === 'string' ? row.status : '',
    home_score: typeof row.home_score === 'number' ? row.home_score : null,
    away_score: typeof row.away_score === 'number' ? row.away_score : null,
    competition_id: typeof row.competition_id === 'string' ? row.competition_id : null,
    competition: asNamedRef(row.competition),
    homeTeam: asNamedRef(row.homeTeam),
    awayTeam: asNamedRef(row.awayTeam),
    latestMinute: asMinute(row.latestMinute),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

function toArticleCard(row: unknown): AdminDashboardArticleCard | null {
  if (!isObjectRow(row) || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title : 'Untitled',
    slug: typeof row.slug === 'string' ? row.slug : '',
    status: typeof row.status === 'string' ? row.status : 'unknown',
    article_type: typeof row.article_type === 'string' ? row.article_type : 'article',
    published_at: typeof row.published_at === 'string' ? row.published_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

function toTransferCard(row: unknown): AdminDashboardTransferCard | null {
  if (!isObjectRow(row) || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    player_id: typeof row.player_id === 'string' ? row.player_id : '',
    from_team_id: typeof row.from_team_id === 'string' ? row.from_team_id : null,
    to_team_id: typeof row.to_team_id === 'string' ? row.to_team_id : null,
    status: typeof row.status === 'string' ? row.status : 'unknown',
    effective_date: typeof row.effective_date === 'string' ? row.effective_date : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    player: asNamedRef(row.player),
    fromTeam: asNamedRef(row.fromTeam),
    toTeam: asNamedRef(row.toTeam),
  };
}

function toSyncSource(row: unknown): AdminDashboardSyncSource | null {
  if (!isObjectRow(row) || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : 'Unnamed source',
    provider: typeof row.provider === 'string' ? row.provider : 'unknown',
    isActive: row.isActive === true,
  };
}

function toSyncError(row: unknown): AdminDashboardSyncError | null {
  if (!isObjectRow(row) || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    syncJobId: typeof row.syncJobId === 'string' ? row.syncJobId : null,
    entityType: typeof row.entityType === 'string' ? row.entityType : null,
    errorCode: typeof row.errorCode === 'string' ? row.errorCode : null,
    message: typeof row.message === 'string' && row.message.length > 0 ? row.message : 'Sync record failed',
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
  };
}

function toSyncDomain(row: unknown): AdminDashboardSyncDomain | null {
  if (!isObjectRow(row) || typeof row.domain !== 'string') return null;
  return {
    domain: row.domain,
    status: typeof row.status === 'string' ? row.status : 'unknown',
    at: asDateString(row.at),
  };
}

function toSync(value: unknown): AdminDashboardSync {
  const fallback: AdminDashboardSync = {
    queued: 0, running: 0, failed: 0, completed: 0,
    lastSuccessAt: null, lastFailureAt: null, lastFailureMessage: null,
    sources: [], recentErrors: [], byDomain: [],
  };
  if (!isObjectRow(value)) return fallback;
  return {
    queued: asCount(value.queued),
    running: asCount(value.running),
    failed: asCount(value.failed),
    completed: asCount(value.completed),
    lastSuccessAt: asDateString(value.lastSuccessAt),
    lastFailureAt: asDateString(value.lastFailureAt),
    lastFailureMessage: typeof value.lastFailureMessage === 'string' ? value.lastFailureMessage : null,
    sources: mapList(value.sources, toSyncSource),
    recentErrors: mapList(value.recentErrors, toSyncError),
    byDomain: mapList(value.byDomain, toSyncDomain),
  };
}

function toActivity(row: unknown): AdminDashboardActivityEntry | null {
  if (!isObjectRow(row) || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    user_id: typeof row.user_id === 'string' ? row.user_id : null,
    action: typeof row.action === 'string' ? row.action : 'unknown',
    entity_type: typeof row.entity_type === 'string' ? row.entity_type : null,
    entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

function toWindow(value: unknown): AdminTransferWindow | null {
  if (!isObjectRow(value) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : 'Transfer window',
    season_id: typeof value.season_id === 'string' ? value.season_id : null,
    start_date: typeof value.start_date === 'string' ? value.start_date : '',
    end_date: typeof value.end_date === 'string' ? value.end_date : '',
  };
}

function mapList<T>(value: unknown, map: (row: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(map).filter((row): row is T => row !== null);
}

/**
 * Coerce the wire payload into the typed contract. Anything missing or
 * malformed degrades to a neutral value (0 / empty list / null window) rather
 * than throwing — the dashboard must render something honest, never a
 * fabricated number and never a crash on a single bad row.
 */
export function normalizeDashboard(raw: unknown): AdminDashboard | null {
  if (!isObjectRow(raw)) return null;
  const articles = asRecord(raw.articles);
  const transfers = asRecord(raw.transfers);
  const matches = asRecord(raw.matches);
  const teams = asRecord(raw.teams);
  const players = asRecord(raw.players);
  const competitions = asRecord(raw.competitions);
  const seasons = asRecord(raw.seasons);
  const venues = asRecord(raw.venues);
  const adminUsers = asRecord(raw.adminUsers);
  const freshness = asRecord(raw.freshness);
  return {
    articles: {
      total: asCount(articles.total),
      published: asCount(articles.published),
      draft: asCount(articles.draft),
      archived: asCount(articles.archived),
      breaking: asCount(articles.breaking),
      review: asCount(articles.review),
      scheduled: asCount(articles.scheduled),
      scheduledOverdue: asCount(articles.scheduledOverdue),
    },
    transfers: { total: asCount(transfers.total), rumour: asCount(transfers.rumour) },
    matches: {
      upcoming: asCount(matches.upcoming),
      live: asCount(matches.live),
      finished: asCount(matches.finished),
      today: asCount(matches.today),
      total: asCount(matches.total),
      attention: asCount(matches.attention),
    },
    teams: { total: asCount(teams.total) },
    players: { total: asCount(players.total) },
    competitions: { total: asCount(competitions.total) },
    seasons: { total: asCount(seasons.total) },
    venues: { total: asCount(venues.total) },
    adminUsers: {
      total: asCount(adminUsers.total),
      active: asCount(adminUsers.active),
      disabled: asCount(adminUsers.disabled),
    },
    sync: toSync(raw.sync),
    freshness: {
      matchesAt: asDateString(freshness.matchesAt),
      articlesAt: asDateString(freshness.articlesAt),
      transfersAt: asDateString(freshness.transfersAt),
    },
    activeWindow: toWindow(raw.activeWindow),
    liveMatches: mapList(raw.liveMatches, toMatchCard),
    upcomingMatches: mapList(raw.upcomingMatches, toMatchCard),
    recentMatches: mapList(raw.recentMatches, toMatchCard),
    recentArticles: mapList(raw.recentArticles, toArticleCard),
    recentTransfers: mapList(raw.recentTransfers, toTransferCard),
    recentActivity: mapList(raw.recentActivity, toActivity),
  };
}

/**
 * Load the dashboard. Server-side only (reads the session cookie). The client
 * is created per call — cheap (no connection pool) and keeps the token read
 * honest on every request.
 */
export async function fetchAdminDashboard(): Promise<AdminDashboardResult> {
  const client = createApiClient({
    baseUrl: siteConfig.apiUrl,
    getToken: () => getAdminAccessToken() ?? null,
  });
  try {
    const envelope = await client.get<AdminDashboard>('/admin/dashboard', { cache: 'no-store' });
    const data = normalizeDashboard(envelope?.data);
    if (!data) return { status: 'error', message: 'Unexpected dashboard payload' };
    return { status: 'ok', data };
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.status === 401) return { status: 'unauthenticated' };
      if (error.status === 403) return { status: 'forbidden' };
      return { status: 'error', message: error.message };
    }
    return { status: 'error', message: 'Dashboard unavailable' };
  }
}

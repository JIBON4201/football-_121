/**
 * Step 14 — Admin dashboard (stats + activity + bounded lists).
 *
 * Every metric is an exact-count probe (one row fetched); every list is
 * explicitly bounded (5–10 rows, minimal columns). Independent queries run
 * via Promise.all. No caching: admin reads are noStore() by design and the
 * probes are cheap indexed counts — a cache would only risk stale ops data
 * (the public matches list already accepts 30s staleness; the dashboard
 * must read-your-write). Legacy Step-4 keys are preserved verbatim.
 */
import { toServiceError } from '../../lib/errors';
import { serviceClient } from '../../lib/supabase';
import { adminCount } from './_list';

const LIVE = ['live', 'half_time', 'extra_time', 'penalty_shootout'];
const UPCOMING = ['scheduled', 'pre_match'];
/** Results that need operator attention (postponed/cancelled/disrupted). */
const ATTENTION_MATCH = ['postponed', 'cancelled', 'abandoned', 'suspended'];
const STAFF_ROLE_NAMES = ['super_admin', 'admin', 'editor', 'author', 'moderator'];
const SYNC_DOMAINS = ['matches', 'teams', 'players', 'competitions', 'venues', 'transfers', 'articles'];

const MATCH_CARD = 'id,slug,competition_id,home_team_id,away_team_id,scheduled_at,status,home_score,away_score,updated_at';
const ARTICLE_CARD = 'id,title,slug,status,article_type,published_at,created_at';
const TRANSFER_CARD = 'id,player_id,from_team_id,to_team_id,status,effective_date,created_at';
const ACTIVITY_COLUMNS = 'id,user_id,action,entity_type,entity_id,created_at';
const SYNC_JOB_CARD = 'id,data_source_id,job_type,entity_type,status,started_at,completed_at,records_processed,records_failed,error_message,created_at';
const SYNC_ERROR_CARD = 'id,sync_job_id,entity_type,external_id,error_code,error_message,created_at';

function todayRange(now = new Date()): { start: string; end: string } {
  const day = now.toISOString().slice(0, 10);
  return { start: `${day}T00:00:00.000Z`, end: `${day}T23:59:59.999Z` };
}

export interface DashboardNamedRef {
  id: string;
  name: string;
  slug: string;
}

export interface DashboardMatchCard {
  id: string;
  slug: string;
  competition: DashboardNamedRef | null;
  homeTeam: DashboardNamedRef | null;
  awayTeam: DashboardNamedRef | null;
  scheduled_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  /** Latest event minute for live matches (from match_events); null when unknown. */
  latestMinute: number | null;
  updated_at: string;
  // Raw FKs preserved for admin deep-links and tests.
  competition_id: string | null;
  home_team_id: string;
  away_team_id: string;
}

export interface DashboardTransferCard {
  id: string;
  player: DashboardNamedRef | null;
  fromTeam: DashboardNamedRef | null;
  toTeam: DashboardNamedRef | null;
  status: string;
  effective_date: string | null;
  created_at: string;
  player_id: string;
  from_team_id: string | null;
  to_team_id: string | null;
}

export interface DashboardSyncSource {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
}

export interface DashboardSyncError {
  id: string;
  syncJobId: string | null;
  entityType: string | null;
  errorCode: string | null;
  message: string;
  createdAt: string;
}

export interface DashboardSyncDomain {
  domain: string;
  /** Latest job status for the domain, or 'never' when no job was recorded. */
  status: string;
  at: string | null;
}

export interface DashboardSyncHealth {
  queued: number;
  running: number;
  failed: number;
  completed: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  sources: DashboardSyncSource[];
  recentErrors: DashboardSyncError[];
  byDomain: DashboardSyncDomain[];
}

export interface AdminDashboard {
  articles: { total: number; published: number; draft: number; review: number; scheduled: number; scheduledOverdue: number; archived: number; breaking: number };
  transfers: { total: number; rumour: number };
  matches: { total: number; upcoming: number; live: number; finished: number; today: number; attention: number };
  teams: { total: number };
  players: { total: number };
  competitions: { total: number };
  seasons: { total: number };
  venues: { total: number };
  adminUsers: { total: number; active: number; disabled: number };
  sync: DashboardSyncHealth;
  freshness: { matchesAt: string | null; articlesAt: string | null; transfersAt: string | null };
  activeWindow: Record<string, unknown> | null;
  liveMatches: DashboardMatchCard[];
  upcomingMatches: DashboardMatchCard[];
  recentMatches: DashboardMatchCard[];
  recentArticles: unknown[];
  recentTransfers: DashboardTransferCard[];
  recentActivity: unknown[];
}

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function adminUserStats(): Promise<AdminDashboard['adminUsers']> {
  const client = serviceClient() as AnyClient;
  const { data: roles } = await client.from('roles').select('id,name').in('name', STAFF_ROLE_NAMES);
  const staffIds = ((roles as Array<{ id: number }> | null) ?? []).map((r) => r.id);
  if (staffIds.length === 0) return { total: 0, active: 0, disabled: 0 };
  const { data: memberships } = await client.from('user_roles').select('user_id').in('role_id', staffIds).range(0, 499);
  const ids = [...new Set(((memberships as Array<{ user_id: string }> | null) ?? []).map((m) => m.user_id))];
  if (ids.length === 0) return { total: 0, active: 0, disabled: 0 };
  const { data: profiles } = await client.from('profiles').select('user_id,status').in('user_id', ids).range(0, 499);
  const rows = ((profiles as Array<{ user_id: string; status: string }> | null) ?? []).filter((p) => ids.includes(p.user_id));
  return {
    total: rows.length,
    active: rows.filter((p) => p.status === 'active').length,
    disabled: rows.filter((p) => p.status !== 'active').length,
  };
}

async function activeTransferWindow(): Promise<Record<string, unknown> | null> {
  const client = serviceClient() as AnyClient;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await client
    .from('transfer_windows')
    .select('id,name,season_id,start_date,end_date')
    .lte('start_date', today)
    .gte('end_date', today)
    .order('start_date', { ascending: false })
    .range(0, 0);
  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  return rows[0] ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function boundedList(table: string, columns: string, limit: number, apply?: (q: any) => any, orderCol = 'created_at'): Promise<unknown[]> {
  const client = serviceClient() as AnyClient;
  let query = client.from(table).select(columns);
  if (apply) query = apply(query);
  const { data, error } = await query.order(orderCol, { ascending: false }).order('id', { ascending: false }).range(0, limit - 1);
  if (error) throw new Error(`${table} list failed`);
  return (data as unknown[]) ?? [];
}

async function fetchRecentActivity(limit = 10): Promise<Array<Record<string, unknown>>> {
  // Projected in code (not just in SELECT) so ip/user_agent can never leak
  // even if the column list regresses — the fake test client ignores
  // column selection, which is exactly how this was verified.
  const rows = (await boundedList('audit_logs', ACTIVITY_COLUMNS, limit)) as Row[];
  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    created_at: row.created_at,
  }));
}

/** Batch-resolve id -> {name, slug} for dashboard cards (bounded input). */
async function resolveRefs(
  table: string,
  ids: string[],
  nameCol: string,
): Promise<Map<string, DashboardNamedRef>> {
  const out = new Map<string, DashboardNamedRef>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const client = serviceClient() as AnyClient;
    const { data } = await client.from(table).select(`id,${nameCol},slug`).in('id', chunk).range(0, 49);
    for (const row of ((data as Row[] | null) ?? [])) {
      if (typeof row.id !== 'string') continue;
      const name = typeof row[nameCol] === 'string' && (row[nameCol] as string).length > 0
        ? (row[nameCol] as string)
        : typeof row.slug === 'string' ? (row.slug as string) : row.id;
      out.set(row.id, { id: row.id, name, slug: typeof row.slug === 'string' ? (row.slug as string) : '' });
    }
  }
  return out;
}

/** Latest event minute per match (drives the live-monitor minute column). */
async function latestMinutes(matchIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = [...new Set(matchIds.filter(Boolean))];
  if (unique.length === 0) return out;
  const client = serviceClient() as AnyClient;
  const { data } = await client
    .from('match_events')
    .select('match_id,minute')
    .in('match_id', unique)
    .order('minute', { ascending: false })
    .range(0, 499);
  for (const row of ((data as Row[] | null) ?? [])) {
    const mid = row.match_id;
    if (typeof mid !== 'string' || out.has(mid)) continue;
    if (typeof row.minute === 'number' && Number.isFinite(row.minute)) out.set(mid, row.minute);
  }
  return out;
}

async function enrichMatches(rows: Row[]): Promise<DashboardMatchCard[]> {
  const teamIds = rows.flatMap((r) => [r.home_team_id, r.away_team_id]).filter((v): v is string => typeof v === 'string');
  const compIds = rows.map((r) => r.competition_id).filter((v): v is string => typeof v === 'string');
  const [teams, competitions, minutes] = await Promise.all([
    resolveRefs('teams', teamIds, 'name'),
    resolveRefs('competitions', compIds, 'name'),
    latestMinutes(rows.map((r) => r.id).filter((v): v is string => typeof v === 'string')),
  ]);
  return rows
    .filter((r) => typeof r.id === 'string')
    .map((r) => {
      const id = r.id as string;
      const homeId = typeof r.home_team_id === 'string' ? r.home_team_id : '';
      const awayId = typeof r.away_team_id === 'string' ? r.away_team_id : '';
      const compId = typeof r.competition_id === 'string' ? r.competition_id : null;
      return {
        id,
        slug: typeof r.slug === 'string' ? r.slug : '',
        competition: compId ? (competitions.get(compId) ?? null) : null,
        homeTeam: teams.get(homeId) ?? null,
        awayTeam: teams.get(awayId) ?? null,
        scheduled_at: typeof r.scheduled_at === 'string' ? r.scheduled_at : '',
        status: typeof r.status === 'string' ? r.status : '',
        home_score: typeof r.home_score === 'number' ? r.home_score : null,
        away_score: typeof r.away_score === 'number' ? r.away_score : null,
        latestMinute: minutes.get(id) ?? null,
        updated_at: typeof r.updated_at === 'string' ? r.updated_at : '',
        competition_id: compId,
        home_team_id: homeId,
        away_team_id: awayId,
      };
    });
}

async function enrichTransfers(rows: Row[]): Promise<DashboardTransferCard[]> {
  const playerIds = rows.map((r) => r.player_id).filter((v): v is string => typeof v === 'string');
  const teamIds = rows.flatMap((r) => [r.from_team_id, r.to_team_id]).filter((v): v is string => typeof v === 'string');
  const [players, teams] = await Promise.all([
    resolveRefs('players', playerIds, 'display_name'),
    resolveRefs('teams', teamIds, 'name'),
  ]);
  return rows
    .filter((r) => typeof r.id === 'string')
    .map((r) => {
      const playerId = typeof r.player_id === 'string' ? r.player_id : '';
      const fromId = typeof r.from_team_id === 'string' ? r.from_team_id : null;
      const toId = typeof r.to_team_id === 'string' ? r.to_team_id : null;
      return {
        id: r.id as string,
        player: players.get(playerId) ?? null,
        fromTeam: fromId ? (teams.get(fromId) ?? null) : null,
        toTeam: toId ? (teams.get(toId) ?? null) : null,
        status: typeof r.status === 'string' ? r.status : '',
        effective_date: typeof r.effective_date === 'string' ? r.effective_date : null,
        created_at: typeof r.created_at === 'string' ? r.created_at : '',
        player_id: playerId,
        from_team_id: fromId,
        to_team_id: toId,
      };
    });
}

async function syncHealth(): Promise<DashboardSyncHealth> {
  const client = serviceClient() as AnyClient;
  const [queued, running, failed, completed, recentJobs, sources, recentErrors] = await Promise.all([
    adminCount('sync_jobs', (q) => q.eq('status', 'queued')),
    adminCount('sync_jobs', (q) => q.eq('status', 'running')),
    adminCount('sync_jobs', (q) => q.eq('status', 'failed')),
    adminCount('sync_jobs', (q) => q.eq('status', 'completed')),
    boundedList('sync_jobs', SYNC_JOB_CARD, 30, undefined, 'created_at'),
    boundedList('data_sources', 'id,name,provider,is_active', 20),
    boundedList('sync_errors', SYNC_ERROR_CARD, 5, undefined, 'created_at'),
  ]);
  const jobs = recentJobs as Row[];
  let lastSuccessAt: string | null = null;
  let lastFailureAt: string | null = null;
  let lastFailureMessage: string | null = null;
  for (const job of jobs) {
    if (job.status === 'completed' && typeof job.completed_at === 'string' && !lastSuccessAt) {
      lastSuccessAt = job.completed_at;
    }
    if (job.status === 'failed' && !lastFailureAt) {
      lastFailureAt = typeof job.completed_at === 'string' ? job.completed_at
        : typeof job.created_at === 'string' ? job.created_at : null;
      lastFailureMessage = typeof job.error_message === 'string' ? job.error_message : null;
    }
    if (lastSuccessAt && lastFailureAt) break;
  }
  // Latest job per known domain (honest 'never' when the domain never synced).
  const latestByDomain = new Map<string, { status: string; at: string | null }>();
  for (const job of jobs) {
    const domain = typeof job.entity_type === 'string' ? job.entity_type : null;
    if (!domain || !SYNC_DOMAINS.includes(domain) || latestByDomain.has(domain)) continue;
    latestByDomain.set(domain, {
      status: typeof job.status === 'string' ? job.status : 'unknown',
      at: typeof job.completed_at === 'string' ? job.completed_at
        : typeof job.created_at === 'string' ? job.created_at : null,
    });
  }
  return {
    queued,
    running,
    failed,
    completed,
    lastSuccessAt,
    lastFailureAt,
    lastFailureMessage,
    sources: ((sources as Row[]) ?? [])
      .filter((s) => typeof s.id === 'string')
      .map((s) => ({
        id: s.id as string,
        name: typeof s.name === 'string' ? s.name : 'Unnamed source',
        provider: typeof s.provider === 'string' ? s.provider : 'unknown',
        isActive: s.is_active === true,
      })),
    recentErrors: ((recentErrors as Row[]) ?? [])
      .filter((e) => typeof e.id === 'string')
      .map((e) => ({
        id: e.id as string,
        syncJobId: typeof e.sync_job_id === 'string' ? e.sync_job_id : null,
        entityType: typeof e.entity_type === 'string' ? e.entity_type : null,
        errorCode: typeof e.error_code === 'string' ? e.error_code : null,
        message: typeof e.error_message === 'string' ? e.error_message : 'Sync record failed',
        createdAt: typeof e.created_at === 'string' ? e.created_at : '',
      })),
    byDomain: SYNC_DOMAINS.map((domain) => {
      const hit = latestByDomain.get(domain);
      return hit ? { domain, status: hit.status, at: hit.at } : { domain, status: 'never', at: null };
    }),
  };
}

async function latestUpdatedAt(table: string): Promise<string | null> {
  const client = serviceClient() as AnyClient;
  const { data } = await client.from(table).select('updated_at').order('updated_at', { ascending: false }).range(0, 0);
  const row = (((data as Row[] | null) ?? [])[0]);
  return row && typeof row.updated_at === 'string' ? row.updated_at : null;
}

export const adminDashboardService = {
  summary: async (): Promise<AdminDashboard> => {
    try {
      const { start, end } = todayRange();
      const nowIso = new Date().toISOString();
      const [
        articlesTotal, articlesPublished, articlesDraft, articlesReview, articlesScheduled, scheduledOverdue, articlesArchived, breakingCount,
        transfersTotal, transfersRumour,
        matchesTotal, matchesUpcoming, matchesLive, matchesFinished, matchesToday, matchesAttention,
        teamsTotal, playersTotal, competitionsTotal, seasonsTotal, venuesTotal,
        adminUsers, activeWindow, sync, matchesAt, articlesAt, transfersAt,
        liveRows, upcomingRows, finishedRows, recentArticles, transferRows, recentActivity,
      ] = await Promise.all([
        adminCount('articles'),
        adminCount('articles', (q) => q.eq('status', 'published')),
        adminCount('articles', (q) => q.eq('status', 'draft')),
        adminCount('articles', (q) => q.eq('status', 'review')),
        adminCount('articles', (q) => q.eq('status', 'scheduled')),
        adminCount('articles', (q) => q.eq('status', 'scheduled').lte('scheduled_at', nowIso)),
        adminCount('articles', (q) => q.eq('status', 'archived')),
        adminCount('articles', (q) => q.eq('is_breaking', true)),
        adminCount('transfers'),
        adminCount('transfers', (q) => q.eq('status', 'rumour')),
        adminCount('matches'),
        adminCount('matches', (q) => q.in('status', UPCOMING)),
        adminCount('matches', (q) => q.in('status', LIVE)),
        adminCount('matches', (q) => q.eq('status', 'finished')),
        adminCount('matches', (q) => q.gte('scheduled_at', start).lte('scheduled_at', end)),
        adminCount('matches', (q) => q.in('status', ATTENTION_MATCH)),
        adminCount('teams'),
        adminCount('players'),
        adminCount('competitions'),
        adminCount('seasons'),
        adminCount('venues'),
        adminUserStats(),
        activeTransferWindow(),
        syncHealth(),
        latestUpdatedAt('matches'),
        latestUpdatedAt('articles'),
        latestUpdatedAt('transfers'),
        boundedList('matches', MATCH_CARD, 5, (q) => q.in('status', LIVE), 'scheduled_at'),
        boundedList('matches', MATCH_CARD, 5, (q) => q.in('status', UPCOMING), 'scheduled_at'),
        boundedList('matches', MATCH_CARD, 5, (q) => q.eq('status', 'finished'), 'scheduled_at'),
        boundedList('articles', ARTICLE_CARD, 5),
        boundedList('transfers', TRANSFER_CARD, 5),
        fetchRecentActivity(10),
      ]);
      const [liveMatches, upcomingMatches, recentMatches, recentTransfers] = await Promise.all([
        enrichMatches(liveRows as Row[]),
        enrichMatches(upcomingRows as Row[]),
        enrichMatches(finishedRows as Row[]),
        enrichTransfers(transferRows as Row[]),
      ]);
      return {
        articles: { total: articlesTotal, published: articlesPublished, draft: articlesDraft, review: articlesReview, scheduled: articlesScheduled, scheduledOverdue, archived: articlesArchived, breaking: breakingCount },
        transfers: { total: transfersTotal, rumour: transfersRumour },
        matches: { total: matchesTotal, upcoming: matchesUpcoming, live: matchesLive, finished: matchesFinished, today: matchesToday, attention: matchesAttention },
        teams: { total: teamsTotal },
        players: { total: playersTotal },
        competitions: { total: competitionsTotal },
        seasons: { total: seasonsTotal },
        venues: { total: venuesTotal },
        adminUsers,
        sync,
        freshness: { matchesAt, articlesAt, transfersAt },
        activeWindow,
        liveMatches,
        upcomingMatches,
        recentMatches,
        recentArticles,
        recentTransfers,
        recentActivity,
      };
    } catch (error) {
      throw toServiceError(error, 'Dashboard service unavailable');
    }
  },
};

import { redirect } from 'next/navigation';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { DashboardErrorState } from '@/components/admin/dashboard/DashboardErrorState';
import { DashboardPanel } from '@/components/admin/dashboard/DashboardPanel';
import { DashboardRefreshButton } from '@/components/admin/dashboard/DashboardRefreshButton';
import { StatCard } from '@/components/admin/dashboard/StatCard';
import { AdminDataTable, type AdminColumn } from '@/components/admin/ui/AdminDataTable';
import { StatusBadge } from '@/components/admin/ui/StatusBadge';
import { EmptyState } from '@/components/admin/ui/Feedback';
import { RefCell } from '@/components/admin/RefCell';
import { fetchAdminDashboard } from '@/lib/admin/dashboard';
import { getAdminSession } from '@/lib/admin-session';
import { formatDate, formatDateTime, formatRelative } from '@/lib/dates';
import type {
  AdminDashboard,
  AdminDashboardActivityEntry,
  AdminDashboardArticleCard,
  AdminDashboardMatchCard,
  AdminDashboardSyncDomain,
  AdminDashboardSyncError,
  AdminDashboardTransferCard,
} from '@/types/api';

function teamName(m: AdminDashboardMatchCard, side: 'home' | 'away'): React.ReactNode {
  const ref = side === 'home' ? m.homeTeam : m.awayTeam;
  const id = side === 'home' ? m.home_team_id : m.away_team_id;
  if (ref) return <span className="cc-ellipsis" title={ref.name}>{ref.name}</span>;
  return <RefCell id={id} />;
}

const matchColumns: AdminColumn<AdminDashboardMatchCard>[] = [
  {
    key: 'fixture',
    header: 'Fixture',
    primary: true,
    render: (m) => (
      <span>
        {teamName(m, 'home')} <span className="cc-muted">v</span> {teamName(m, 'away')}
      </span>
    ),
  },
  {
    key: 'score',
    header: 'Score',
    numeric: true,
    render: (m) =>
      m.home_score === null || m.away_score === null ? (
        <span className="cc-muted">—</span>
      ) : (
        <span className="cc-score">
          {m.home_score}–{m.away_score}
        </span>
      ),
  },
  {
    key: 'minute',
    header: 'Min',
    numeric: true,
    render: (m) =>
      m.latestMinute === null || m.latestMinute === undefined ? (
        <span className="cc-muted">—</span>
      ) : (
        <span className="cc-score">{m.latestMinute}′</span>
      ),
  },
  { key: 'competition', header: 'Competition', render: (m) => (m.competition ? <span className="cc-ellipsis">{m.competition.name}</span> : <span className="cc-muted">—</span>) },
  { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> },
  {
    key: 'kickoff',
    header: 'Kickoff',
    numeric: true,
    render: (m) => <span className="cc-dt">{formatDateTime(m.scheduled_at)}</span>,
  },
  {
    key: 'updated',
    header: 'Updated',
    numeric: true,
    render: (m) =>
      m.updated_at ? (
        <span className="cc-dt" title={m.updated_at}>
          {formatRelative(m.updated_at)}
        </span>
      ) : (
        <span className="cc-muted">—</span>
      ),
  },
  {
    key: 'view',
    header: 'View',
    render: (m) => (
      <a className="cc-button cc-button--ghost cc-button--sm" href={`/control-center/matches/${m.id}`}>
        View match
      </a>
    ),
  },
];

const articleColumns: AdminColumn<AdminDashboardArticleCard>[] = [
  { key: 'title', header: 'Title', primary: true, render: (a) => <span className="cc-ellipsis">{a.title}</span> },
  { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
  { key: 'type', header: 'Type', render: (a) => <span className="cc-muted">{a.article_type.replace(/_/g, ' ')}</span> },
  {
    key: 'published',
    header: 'Published',
    numeric: true,
    render: (a) =>
      a.published_at ? <span className="cc-dt">{formatDate(a.published_at)}</span> : <span className="cc-muted">—</span>,
  },
  {
    key: 'view',
    header: 'View',
    render: (a) => (
      <a className="cc-button cc-button--ghost cc-button--sm" href={`/control-center/articles/${a.id}/edit`}>
        View article
      </a>
    ),
  },
];

const transferColumns: AdminColumn<AdminDashboardTransferCard>[] = [
  { key: 'player', header: 'Player', primary: true, render: (t) => (t.player ? <span className="cc-ellipsis">{t.player.name}</span> : <RefCell id={t.player_id} />) },
  { key: 'from', header: 'From', render: (t) => (t.fromTeam ? <span className="cc-ellipsis">{t.fromTeam.name}</span> : t.from_team_id ? <RefCell id={t.from_team_id} /> : <span className="cc-muted">—</span>) },
  { key: 'to', header: 'To', render: (t) => (t.toTeam ? <span className="cc-ellipsis">{t.toTeam.name}</span> : t.to_team_id ? <RefCell id={t.to_team_id} /> : <span className="cc-muted">—</span>) },
  { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
  {
    key: 'effective',
    header: 'Effective',
    numeric: true,
    render: (t) =>
      t.effective_date ? <span className="cc-dt">{formatDate(t.effective_date)}</span> : <span className="cc-muted">—</span>,
  },
];

const syncDomainColumns: AdminColumn<AdminDashboardSyncDomain>[] = [
  { key: 'domain', header: 'Domain', primary: true, render: (r) => <span className="cc-ellipsis">{r.domain}</span> },
  { key: 'status', header: 'Last status', render: (r) => <StatusBadge status={r.status} /> },
  {
    key: 'at',
    header: 'At',
    numeric: true,
    render: (r) =>
      r.at ? (
        <span className="cc-dt" title={r.at}>
          {formatRelative(r.at)}
        </span>
      ) : (
        <span className="cc-muted">Never synced</span>
      ),
  },
];

const syncErrorColumns: AdminColumn<AdminDashboardSyncError>[] = [
  { key: 'code', header: 'Code', render: (e) => <span className="cc-mono">{e.errorCode ?? '—'}</span> },
  { key: 'message', header: 'Message', primary: true, render: (e) => <span className="cc-ellipsis" title={e.message}>{e.message}</span> },
  { key: 'entity', header: 'Entity', render: (e) => (e.entityType ? <span>{e.entityType}</span> : <span className="cc-muted">—</span>) },
  {
    key: 'when',
    header: 'When',
    numeric: true,
    render: (e) => (
      <span className="cc-dt" title={e.createdAt}>
        {formatRelative(e.createdAt)}
      </span>
    ),
  },
];

const activityColumns: AdminColumn<AdminDashboardActivityEntry>[] = [
  { key: 'action', header: 'Action', render: (a) => <span className="cc-mono">{a.action}</span> },
  {
    key: 'entity',
    header: 'Entity',
    render: (a) =>
      a.entity_type ? (
        <span>
          {a.entity_type} <RefCell id={a.entity_id} />
        </span>
      ) : (
        <span className="cc-muted">—</span>
      ),
  },
  { key: 'actor', header: 'Actor', render: (a) => <RefCell id={a.user_id} /> },
  {
    key: 'when',
    header: 'When',
    numeric: true,
    render: (a) => (
      <span className="cc-dt" title={a.created_at}>
        {formatRelative(a.created_at)}
      </span>
    ),
  },
];

function TablePanel<T>({
  title,
  rows,
  columns,
  caption,
  emptyTitle,
}: {
  title: string;
  rows: T[];
  columns: AdminColumn<T>[];
  caption: string;
  emptyTitle: string;
}) {
  return (
    <DashboardPanel title={title} count={rows.length}>
      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} description="Once data lands here, the latest rows will show up." />
      ) : (
        <AdminDataTable<T> columns={columns} rows={rows} caption={caption} rowKey={(row) => (row as { id: string }).id} />
      )}
    </DashboardPanel>
  );
}

interface Alert {
  severity: 'high' | 'medium' | 'low';
  message: string;
  href?: string;
}

/** Actionable problems derived from real backend numbers — never invented. */
function buildAlerts(d: AdminDashboard): Alert[] {
  const alerts: Alert[] = [];
  const sync = d.sync;
  if (sync && sync.failed > 0) {
    alerts.push({
      severity: 'high',
      message: `${sync.failed} sync job${sync.failed === 1 ? '' : 's'} failed${sync.lastFailureMessage ? `: ${sync.lastFailureMessage}` : ''}.`,
    });
  }
  if (sync && sync.running > 0) {
    alerts.push({ severity: 'medium', message: `${sync.running} sync job${sync.running === 1 ? ' is' : 's are'} currently running.` });
  }
  if (sync && sync.queued > 0) {
    alerts.push({ severity: 'low', message: `${sync.queued} sync job${sync.queued === 1 ? ' is' : 's are'} queued.` });
  }
  if (d.articles.scheduledOverdue !== undefined && d.articles.scheduledOverdue > 0) {
    alerts.push({
      severity: 'high',
      message: `${d.articles.scheduledOverdue} scheduled article${d.articles.scheduledOverdue === 1 ? ' is' : 's are'} past its publish time.`,
      href: '/control-center/articles?status=scheduled',
    });
  }
  if (d.matches.attention !== undefined && d.matches.attention > 0) {
    alerts.push({
      severity: 'medium',
      message: `${d.matches.attention} match${d.matches.attention === 1 ? ' needs' : 'es need'} rescheduling (postponed, cancelled, abandoned or suspended).`,
      href: '/control-center/matches',
    });
  }
  if (d.articles.review !== undefined && d.articles.review > 0) {
    alerts.push({
      severity: 'low',
      message: `${d.articles.review} article${d.articles.review === 1 ? ' awaits' : 's await'} review.`,
      href: '/control-center/articles?status=review',
    });
  }
  if (d.transfers.rumour !== undefined && d.transfers.rumour > 0) {
    alerts.push({
      severity: 'low',
      message: `${d.transfers.rumour} transfer${d.transfers.rumour === 1 ? ' is' : 's are'} still an unconfirmed rumour.`,
      href: '/control-center/transfers?status=rumour',
    });
  }
  return alerts;
}

function isCompletelyEmpty(d: AdminDashboard): boolean {
  const syncActive = d.sync
    ? d.sync.queued + d.sync.running + d.sync.failed + d.sync.completed + d.sync.sources.length + d.sync.recentErrors.length
    : 0;
  const totals = [
    d.articles.total,
    d.transfers.total,
    d.teams.total,
    d.players.total,
    d.competitions.total,
    d.seasons.total,
    d.venues.total,
    d.adminUsers.total,
    d.matches.live + d.matches.today + d.matches.upcoming + d.matches.finished + (d.matches.total ?? 0),
    syncActive,
  ];
  return (
    totals.every((n) => n === 0) &&
    d.liveMatches.length === 0 &&
    d.upcomingMatches.length === 0 &&
    (d.recentMatches ?? []).length === 0 &&
    d.recentArticles.length === 0 &&
    d.recentTransfers.length === 0 &&
    d.recentActivity.length === 0
  );
}

const QUICK_ACTIONS: Array<{ permission: string; label: string; href: string }> = [
  { permission: 'matches.create', label: 'Add match', href: '/control-center/matches/new' },
  { permission: 'teams.create', label: 'Add team', href: '/control-center/teams/new' },
  { permission: 'players.create', label: 'Add player', href: '/control-center/players/new' },
  { permission: 'competitions.create', label: 'Add competition', href: '/control-center/competitions/new' },
  { permission: 'seasons.manage', label: 'Add season', href: '/control-center/seasons/new' },
  { permission: 'venues.manage', label: 'Add venue', href: '/control-center/venues/new' },
  { permission: 'articles.create', label: 'Create article', href: '/control-center/articles/new' },
];

/**
 * Admin Dashboard — the only data source is the backend aggregate
 * (`GET /api/v1/admin/dashboard`). Counts, lists, sync health and freshness
 * are all rendered straight from that payload; nothing is invented. Metrics
 * the backend cannot provide (e.g. a sync runner UI) are marked unavailable
 * instead of fabricated.
 */
export default async function DashboardPage() {
  const [session, result] = await Promise.all([getAdminSession(), fetchAdminDashboard()]);
  if (session.status === 'unauthenticated' || result.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'forbidden' || result.status === 'forbidden') return <AccessDenied />;
  if (session.status === 'error') return <DashboardErrorState message={session.message} />;
  if (result.status === 'error') return <DashboardErrorState message={result.message} />;

  const d = result.data;
  const permissions = session.user.permissions;
  const can = (key: string) => permissions.includes(key);
  const alerts = buildAlerts(d);
  const actions = QUICK_ACTIONS.filter((a) => can(a.permission));
  const sync = d.sync;
  const freshness = d.freshness;

  return (
    <section className="cc-dashboard" aria-labelledby="cc-dashboard-title">
      <div className="cc-page-head">
        <h1 id="cc-dashboard-title" className="cc-section__title">
          Dashboard
        </h1>
        <DashboardRefreshButton />
      </div>
      {d.activeWindow ? (
        <p className="cc-dashboard__window">
          Active transfer window: <strong>{d.activeWindow.name}</strong> ({formatDate(d.activeWindow.start_date)} –{' '}
          {formatDate(d.activeWindow.end_date)})
        </p>
      ) : null}

      {isCompletelyEmpty(d) ? (
        <EmptyState
          title="No data yet"
          description="The dashboard will populate once content, matches, transfers and staff exist."
        />
      ) : (
        <>
          <div className="cc-stats-grid">
            <StatCard
              label="Matches"
              value={d.matches.total ?? d.matches.upcoming + d.matches.live + d.matches.finished}
              sub={`${d.matches.live} live · ${d.matches.upcoming} upcoming · ${d.matches.finished} finished · ${d.matches.today} today`}
              href="/control-center/matches"
            />
            <StatCard label="Live matches" value={d.matches.live} sub={`${d.matches.today} today`} href="/control-center/matches?status=live" />
            <StatCard label="Upcoming matches" value={d.matches.upcoming} sub={`${d.matches.finished} finished`} href="/control-center/matches" />
            <StatCard label="Teams" value={d.teams.total} href="/control-center/teams" />
            <StatCard label="Players" value={d.players.total} href="/control-center/players" />
            <StatCard label="Competitions" value={d.competitions.total} href="/control-center/competitions" />
            <StatCard label="Seasons" value={d.seasons.total} href="/control-center/seasons" />
            <StatCard label="Venues" value={d.venues.total} href="/control-center/venues" />
            <StatCard
              label="Articles"
              value={d.articles.total}
              sub={`${d.articles.published} published · ${d.articles.draft} draft · ${d.articles.scheduled ?? 0} scheduled · ${d.articles.breaking} breaking`}
              href="/control-center/articles"
            />
            <StatCard
              label="Transfers"
              value={d.transfers.total}
              sub={d.activeWindow ? `Active window: ${d.activeWindow.name}` : `${d.transfers.rumour ?? 0} rumours`}
              href="/control-center/transfers"
            />
            <StatCard
              label="Admin users"
              value={d.adminUsers.total}
              sub={`${d.adminUsers.active} active · ${d.adminUsers.disabled} disabled`}
              href="/control-center/users"
            />
            <StatCard
              label="Failed syncs"
              value={sync ? sync.failed : 0}
              sub={sync ? `${sync.queued} queued · ${sync.running} running · ${sync.completed} completed` : 'Sync reporting unavailable'}
            />
          </div>

          <div className="cc-panel-grid">
            <DashboardPanel title="Attention required" count={alerts.length}>
              {alerts.length === 0 ? (
                <EmptyState title="No issues detected" description="Failed syncs, overdue content and disrupted matches will appear here." />
              ) : (
                <ul className="cc-alerts">
                  {alerts.map((alert, i) => (
                    <li key={i} className={`cc-alert cc-alert--${alert.severity}`}>
                      <StatusBadge status={alert.severity} />
                      <span>{alert.message}</span>
                      {alert.href ? (
                        <a className="cc-button cc-button--ghost cc-button--sm" href={alert.href}>
                          Review
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </DashboardPanel>

            <TablePanel title="Live matches" caption="live matches" emptyTitle="No live matches" rows={d.liveMatches} columns={matchColumns} />
            <TablePanel title="Upcoming matches" caption="upcoming matches" emptyTitle="No upcoming matches" rows={d.upcomingMatches} columns={matchColumns} />
            <TablePanel title="Recently finished" caption="recently finished matches" emptyTitle="No finished matches" rows={d.recentMatches ?? []} columns={matchColumns} />

            <DashboardPanel title="Content overview" count={d.articles.total}>
              <p className="cc-muted">
                {d.articles.published} published · {d.articles.draft} draft · {d.articles.review ?? 0} in review ·{' '}
                {d.articles.scheduled ?? 0} scheduled · {d.articles.archived} archived · {d.articles.breaking} breaking
              </p>
              <div className="cc-actions">
                {can('articles.create') ? (
                  <a className="cc-button cc-button--primary cc-button--sm" href="/control-center/articles/new">
                    Create article
                  </a>
                ) : null}
                <a className="cc-button cc-button--ghost cc-button--sm" href="/control-center/articles">
                  Manage articles
                </a>
              </div>
            </DashboardPanel>

            <TablePanel title="Recent articles" caption="articles" emptyTitle="No articles yet" rows={d.recentArticles} columns={articleColumns} />
            <TablePanel title="Recent transfers" caption="transfers" emptyTitle="No transfers yet" rows={d.recentTransfers} columns={transferColumns} />

            <DashboardPanel title="System health">
              {sync ? (
                <>
                  <p className="cc-muted">Database: operational (dashboard aggregate query succeeded).</p>
                  <p className="cc-muted">
                    Sync jobs: {sync.queued} queued · {sync.running} running · {sync.failed} failed · {sync.completed}{' '}
                    completed
                    {sync.lastSuccessAt ? (
                      <>
                        {' '}· last success <span className="cc-dt" title={sync.lastSuccessAt}>{formatRelative(sync.lastSuccessAt)}</span>
                      </>
                    ) : (
                      ' · no successful sync recorded'
                    )}
                    {sync.lastFailureAt ? (
                      <>
                        {' '}· last failure <span className="cc-dt" title={sync.lastFailureAt}>{formatRelative(sync.lastFailureAt)}</span>
                      </>
                    ) : null}
                  </p>
                  {sync.lastFailureMessage ? <p className="cc-muted">Last failure: {sync.lastFailureMessage}</p> : null}
                  <p className="cc-muted">
                    Data providers:{' '}
                    {sync.sources.length === 0
                      ? 'none registered'
                      : sync.sources.map((s) => `${s.name} (${s.provider}, ${s.isActive ? 'active' : 'inactive'})`).join(' · ')}
                  </p>
                  {freshness ? (
                    <p className="cc-muted">
                      Freshness: matches {freshness.matchesAt ? formatRelative(freshness.matchesAt) : 'no records yet'} ·{' '}
                      articles {freshness.articlesAt ? formatRelative(freshness.articlesAt) : 'no records yet'} · transfers{' '}
                      {freshness.transfersAt ? formatRelative(freshness.transfersAt) : 'no records yet'}
                    </p>
                  ) : null}
                  <p className="cc-muted">Sync execution is CLI/worker-only; no run-sync endpoint exists in the admin API.</p>
                </>
              ) : (
                <EmptyState title="Sync reporting unavailable" description="The backend did not return sync health." />
              )}
            </DashboardPanel>

            {sync && sync.byDomain.length > 0 ? (
              <DashboardPanel title="Sync status by domain" count={sync.byDomain.length}>
                <AdminDataTable<AdminDashboardSyncDomain>
                  columns={syncDomainColumns}
                  rows={sync.byDomain}
                  caption="sync status by domain"
                  rowKey={(row) => row.domain}
                />
              </DashboardPanel>
            ) : null}

            {sync && sync.recentErrors.length > 0 ? (
              <DashboardPanel title="Recent sync errors" count={sync.recentErrors.length}>
                <AdminDataTable<AdminDashboardSyncError>
                  columns={syncErrorColumns}
                  rows={sync.recentErrors}
                  caption="recent sync errors"
                  rowKey={(row) => row.id}
                />
              </DashboardPanel>
            ) : null}

            {actions.length > 0 ? (
              <DashboardPanel title="Quick actions">
                <div className="cc-actions">
                  {actions.map((a) => (
                    <a key={a.href} className="cc-button cc-button--ghost cc-button--sm" href={a.href}>
                      {a.label}
                    </a>
                  ))}
                </div>
              </DashboardPanel>
            ) : null}

            <TablePanel title="Recent admin activity" caption="activity entries" emptyTitle="No admin activity yet" rows={d.recentActivity} columns={activityColumns} />
          </div>
        </>
      )}
    </section>
  );
}

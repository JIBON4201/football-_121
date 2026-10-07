import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { AccessDenied } from '@/components/admin/AccessDenied';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { EventManager } from '@/components/admin/matches/EventManager';
import { DeleteMatchButton } from '@/components/admin/matches/DeleteMatchButton';
import { fetchAdminMatch, fetchMatchEvents } from '@/lib/admin/matches';
import { adminFailureMessage } from '@/lib/admin/resource';
import { fetchOptionTeams } from '@/lib/admin/options';
import { fetchPublicPlayers } from '@/lib/admin/transfers';
import { getAdminSession } from '@/lib/admin-session';
import { formatDateTime } from '@/lib/dates';
import { StatusBadge } from '@/components/admin/ui/StatusBadge';

export const metadata: Metadata = { title: 'Match Â· Control Center', robots: { index: false, follow: false } };

export default async function MatchDetailPage({ params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (session.status === 'unauthenticated') redirect('/control-center/login');
  if (session.status === 'error') return <AdminErrorState title="Admin API unavailable" message={session.message} />;
  if (session.status === 'forbidden' || !session.user.permissions.includes('matches.read')) return <AccessDenied />;

  const result = await fetchAdminMatch(params.id);
  if (result.status === 'unauthenticated') redirect('/control-center/login');
  if (result.status === 'forbidden') return <AccessDenied />;
  if (result.status === 'not-found') notFound();
  if (result.status !== 'ok') return <AdminErrorState title="Match unavailable" message={adminFailureMessage(result)} />;

  const m = result.match;
  const canManageEvents = session.user.permissions.includes('match_events.manage');
  const canDelete = session.user.permissions.includes('matches.delete');
  const canUpdate = session.user.permissions.includes('matches.update');

  // Events and form option lists (players/teams) â€” events only if the admin
  // holds the event permission (that endpoint is permission-gated too).
  const eventsResult = canManageEvents ? await fetchMatchEvents(params.id) : null;
  const [teams, players] = await Promise.all([fetchOptionTeams(), fetchPublicPlayers()]);

  return (
    <section className="cc-dashboard" aria-labelledby="cc-match-title">
      <div className="cc-page-head">
        <div>
          <h1 id="cc-match-title" className="cc-section__title">
            {m.homeTeam?.name ?? 'Home'} vs {m.awayTeam?.name ?? 'Away'}
          </h1>
          <p className="cc-muted">
            {m.competition?.name ?? 'â€”'} Â· {m.season?.name ?? 'â€”'} Â· {formatDateTime(m.scheduled_at)}
          </p>
        </div>
        <div className="cc-row-actions">
          <Link href="/control-center/matches" className="cc-button cc-button--ghost">Back to list</Link>
          {canUpdate ? <Link href={`/control-center/matches/${m.id}/edit`} className="cc-button cc-button--ghost">Edit</Link> : null}
          {canDelete ? <DeleteMatchButton id={m.id} /> : null}
        </div>
      </div>

      <dl className="cc-facts">
        <div><dt>Status</dt><dd><StatusBadge status={m.status} /></dd></div>
        <div><dt>Score</dt><dd className="cc-score">{m.home_score === null || m.away_score === null ? 'â€”' : `${m.home_score}â€“${m.away_score}`}</dd></div>
        <div><dt>Venue</dt><dd>{m.venue?.name ?? 'â€”'}</dd></div>
        <div><dt>Round</dt><dd>{m.round ?? 'â€”'}</dd></div>
        <div><dt>Matchday</dt><dd>{m.matchday ?? 'â€”'}</dd></div>
        <div><dt>Referee</dt><dd>{m.referee_name ?? 'â€”'}</dd></div>
        <div><dt>Attendance</dt><dd>{m.attendance !== null ? m.attendance.toLocaleString('en-GB') : 'â€”'}</dd></div>
      </dl>

      {m.dependents ? (
        <p className="cc-dashboard__window">
          Dependents: {Object.entries(m.dependents).map(([k, v]) => `${v} ${k.replace('match_', '')}`).join(', ')} â€” a match with dependents cannot be hard-deleted.
        </p>
      ) : null}

      {canManageEvents ? (
        !eventsResult ? null : eventsResult.status === 'unauthenticated' ? (
          <AdminErrorState title="Events unavailable" message="Your session expired. Reload and sign in again." />
        ) : eventsResult.status === 'forbidden' ? (
          <AccessDenied />
        ) : eventsResult.status !== 'ok' ? (
          // Every non-ok state must surface, not just 'error': collapsing a 429
          // or a transient 5xx into an empty list would read as "no events yet".
          <AdminErrorState title="Events unavailable" message={adminFailureMessage(eventsResult)} />
        ) : (
          <EventManager matchId={m.id} events={eventsResult.rows} teams={teams} players={players} />
        )
      ) : (
        <p className="cc-muted">Match events are managed via the <code>match_events.manage</code> permission, which your account does not have.</p>
      )}
    </section>
  );
}

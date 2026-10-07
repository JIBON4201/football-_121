import { entityUrl, routeUrl } from '@/config/routes';
import { PlayerAvatar, TeamBadge } from '@/components/domain/Badges';
import { formatDate } from '@/lib/dates';
import { sanitizeText } from '@/lib/validation';
import { Badge } from '@/components/ui/Badge';
import {
  classifyFee,
  formatFee,
  isConfirmedStatus,
  statusLabel,
  transferUrl,
  typeLabel,
  type TransferDetail,
  type TransferListItem,
  type TransferStatus,
  type TransferType,
} from '@/lib/transfers';

const STATUS_TONE: Record<TransferStatus, 'live' | 'info' | 'neutral' | 'warning'> = {
  rumour: 'warning',
  announced: 'info',
  completed: 'info',
  cancelled: 'neutral',
  rejected: 'neutral',
};

/**
 * Status pill. An unconfirmed status is worded so it can never be misread as a
 * completed move, and the text — not the colour — carries the meaning.
 */
export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-status={status}>
      <span>{isConfirmedStatus(status) ? statusLabel(status) : `${statusLabel(status)} — not confirmed`}</span>
    </Badge>
  );
}

function TeamSide({ team, role }: { team: { name: string; slug: string; logo_url: string | null } | null; role: string }) {
  if (!team) {
    return (
      <span className="transfer-card__team transfer-card__team--unknown">
        <span className="transfer-card__team-role">{role}</span>
        <span className="visually-hidden">not identified</span>
        <span aria-hidden="true">—</span>
      </span>
    );
  }
  return (
    <a className="transfer-card__team" href={entityUrl('team', team.slug)}>
      <TeamBadge name={team.name} logoUrl={team.logo_url} size={24} />
      <span className="transfer-card__team-name">{sanitizeText(team.name)}</span>
      <span className="visually-hidden">{role}</span>
    </a>
  );
}

function PlayerLink({ player }: { player: { display_name: string; slug: string; photo_url: string | null } | null }) {
  if (!player) return <span className="transfer-card__player transfer-card__player--unknown">Player not identified</span>;
  return (
    <a className="transfer-card__player" href={entityUrl('player', player.slug)}>
      <PlayerAvatar name={player.display_name} photoUrl={player.photo_url} size={32} />
      <span>{sanitizeText(player.display_name)}</span>
    </a>
  );
}

/**
 * Fee label. An unknown fee reads "Undisclosed" — never 0. A free transfer is
 * stated as free, and a known fee keeps the currency it was recorded in.
 */
export function TransferFee({ fee, currency, transferType }: { fee: number | null; currency: string | null; transferType: TransferType | null }) {
  const kind = classifyFee(fee, transferType);
  const formatted = formatFee(fee, currency, transferType);
  if (kind === 'undisclosed') {
    return <span className="transfer-card__fee transfer-card__fee--unknown">Fee undisclosed</span>;
  }
  return (
    <span className="transfer-card__fee" data-fee={kind}>
      <span className="visually-hidden">Fee: </span>
      {formatted}
    </span>
  );
}

interface TransferCardProps {
  item: TransferListItem;
}

function cardLabel(item: TransferListItem): string {
  const player = item.player?.display_name ?? 'a player';
  const from = item.fromTeam?.name ?? 'an unidentified club';
  const to = item.toTeam?.name ?? 'an unidentified club';
  return `${player}: ${from} to ${to}`;
}

/** Reusable transfer card. Mobile shows player → from → to → status in order. */
export function TransferCard({ item }: TransferCardProps) {
  const { transfer, player, fromTeam, toTeam } = item;
  return (
    <article className="transfer-card" aria-label={cardLabel(item)} data-status={transfer.status}>
      <div className="transfer-card__head">
        <PlayerLink player={player} />
        <TransferStatusBadge status={transfer.status} />
      </div>

      <p className="transfer-card__move">
        <TeamSide team={fromTeam} role="From" />
        <span className="transfer-card__arrow" aria-hidden="true">
          →
        </span>
        <TeamSide team={toTeam} role="To" />
      </p>

      <p className="transfer-card__meta">
        {transfer.transfer_type ? (
          <span className="transfer-card__type">{typeLabel(transfer.transfer_type)}</span>
        ) : (
          <span className="transfer-card__type transfer-card__type--unknown">Type not recorded</span>
        )}
        <TransferFee fee={transfer.fee} currency={transfer.currency} transferType={transfer.transfer_type} />
        {transfer.announcement_date ? (
          <span className="transfer-card__date">Announced {sanitizeText(formatDate(transfer.announcement_date))}</span>
        ) : null}
        {transfer.effective_date ? (
          <span className="transfer-card__date">Effective {sanitizeText(formatDate(transfer.effective_date))}</span>
        ) : null}
      </p>

      <a className="transfer-card__link" href={transferUrl(transfer.id)}>
        Transfer details
      </a>
    </article>
  );
}

interface TransferTimelineProps {
  detail: TransferDetail;
}

/**
 * Chronological record of what actually happened. Only the stored dates and
 * the current status are shown — no intermediate steps are invented.
 */
export function TransferTimeline({ detail }: TransferTimelineProps) {
  const { transfer } = detail;
  const dated: Array<{ key: string; label: string; date: string; note?: string }> = [];

  if (transfer.status === 'rumour' && transfer.announcement_date) {
    dated.push({ key: 'rumour', label: 'Rumour', date: transfer.announcement_date, note: 'Unverified' });
  }
  if (transfer.announcement_date) {
    dated.push({ key: 'announced', label: 'Announced', date: transfer.announcement_date });
  }
  if (transfer.effective_date) {
    dated.push({ key: 'effective', label: 'Effective', date: transfer.effective_date });
  }

  const statusNote = isConfirmedStatus(transfer.status)
    ? transfer.status === 'announced'
      ? 'Announced, not yet completed'
      : 'Completed'
    : 'Not a completed move';

  return (
    <>
      {dated.length === 0 ? (
        <p className="transfer-timeline__empty">No dates have been recorded for this transfer.</p>
      ) : (
        <ol className="transfer-timeline">
          {dated.map((event) => (
            <li className="transfer-timeline__event" key={event.key}>
              <span className="transfer-timeline__label">{event.label}</span>
              <span className="transfer-timeline__date">{sanitizeText(formatDate(event.date))}</span>
              {event.note ? <span className="transfer-timeline__note">{event.note}</span> : null}
            </li>
          ))}
        </ol>
      )}
      {/* The recorded status is always stated; no other steps are invented. */}
      <p className="transfer-timeline__status">
        Current status: {statusLabel(transfer.status)} — {statusNote}
      </p>
    </>
  );
}

interface TransferFactProps {
  label: string;
  children: React.ReactNode;
}

function TransferFact({ label, children }: TransferFactProps) {
  return (
    <div className="transfer-facts__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Full record for one transfer, with every relation linked canonically. */
export function TransferDetailView({ detail }: { detail: TransferDetail }) {
  const { transfer, player, fromTeam, toTeam, season, window, competition } = detail;

  return (
    <div className="transfer-detail">
      {!isConfirmedStatus(transfer.status) ? (
        <p className="transfer-detail__warning" role="status">
          This is not a completed transfer. Treat it as unverified until a club confirms it.
        </p>
      ) : null}

      <dl className="transfer-facts">
        <TransferFact label="Status">
          <TransferStatusBadge status={transfer.status} />
        </TransferFact>
        <TransferFact label="Type">
          {transfer.transfer_type ? typeLabel(transfer.transfer_type) : 'Not recorded'}
        </TransferFact>
        <TransferFact label="Fee">
          <TransferFee fee={transfer.fee} currency={transfer.currency} transferType={transfer.transfer_type} />
        </TransferFact>
        <TransferFact label="From">
          {fromTeam ? <a href={entityUrl('team', fromTeam.slug)}>{sanitizeText(fromTeam.name)}</a> : 'Not recorded'}
        </TransferFact>
        <TransferFact label="To">
          {toTeam ? <a href={entityUrl('team', toTeam.slug)}>{sanitizeText(toTeam.name)}</a> : 'Not recorded'}
        </TransferFact>
        <TransferFact label="Season">
          {season ? sanitizeText(season.name) : 'Not recorded'}
        </TransferFact>
        <TransferFact label="Transfer window">
          {window ? (
            <span>
              {sanitizeText(window.name)}
              {window.start_date || window.end_date ? (
                <span className="transfer-facts__dates">
                  {' · '}
                  {window.start_date ? sanitizeText(formatDate(window.start_date)) : '—'}
                  {' – '}
                  {window.end_date ? sanitizeText(formatDate(window.end_date)) : '—'}
                </span>
              ) : null}
            </span>
          ) : (
            'No window recorded'
          )}
        </TransferFact>
        {competition ? (
          <TransferFact label="Competition">
            {/* Reached through the transfer's own season, never inferred. */}
            <a href={entityUrl('competition', competition.slug)}>{sanitizeText(competition.name)}</a>
          </TransferFact>
        ) : null}
      </dl>

      <section className="transfer-detail__timeline" aria-labelledby="transfer-timeline-heading">
        <h2 id="transfer-timeline-heading">Timeline</h2>
        <TransferTimeline detail={detail} />
      </section>

      <p className="transfer-detail__links">
        <a href={routeUrl('transfers')}>All transfers</a>
        {player ? (
          <>
            {' · '}
            <a href={entityUrl('player', player.slug)}>{sanitizeText(player.display_name)} profile</a>
          </>
        ) : null}
      </p>
    </div>
  );
}

import { Badge } from '@/components/ui/Badge';
import { isLiveStatus } from '@/lib/live-state';

const FINISHED_STATUSES = new Set(['finished']);

export { isLiveStatus };

/** Match status pill. Live statuses expose a polite live region. */
export function MatchStatus({ status, label }: { status: string; label?: string }) {
  const text = label ?? status.replace(/_/g, ' ');
  if (isLiveStatus(status)) {
    return (
      <Badge tone="live">
        <span role="status" aria-live="polite">
          {text}
        </span>
      </Badge>
    );
  }
  return <Badge tone={FINISHED_STATUSES.has(status) ? 'neutral' : 'info'}>{text}</Badge>;
}

/** Score display with explicit full-time/short labels for screen readers. */
export function ScoreDisplay({
  homeScore,
  awayScore,
  homeName,
  awayName,
  status,
}: {
  homeScore: number | null;
  awayScore: number | null;
  homeName: string;
  awayName: string;
  status: string;
}) {
  const known = homeScore !== null && awayScore !== null;
  const label = known
    ? `${homeName} ${homeScore}, ${awayName} ${awayScore}${FINISHED_STATUSES.has(status) ? ', full time' : ''}`
    : `${homeName} versus ${awayName}, score not available`;
  return (
    <p aria-label={label}>
      <span aria-hidden="true">{known ? `${homeScore} - ${awayScore}` : 'vs'}</span>
      <span className="visually-hidden">{label}</span>
    </p>
  );
}

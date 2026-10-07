import { formatStatus, statusTone } from './statusTokens';

const TONE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  neutral: '',
  success: 'cc-badge--success',
  warning: 'cc-badge--warning',
  danger: 'cc-badge--danger',
  info: 'cc-badge--info',
  live: 'cc-badge--live',
};

/**
 * The single status renderer for the whole panel. Takes any backend status
 * string and maps it to a tone from `statusTokens`, which is sourced from the
 * Postgres enums — so a badge can never claim a state the database does not
 * have.
 *
 * A dot is omitted for neutral values: not every row needs a colour, and a wall
 * of grey pills is just noise.
 */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = statusTone(status);
  return (
    <span className={`cc-badge ${TONE_CLASS[tone]}`.trim()}>
      {tone === 'live' ? <span className="cc-badge__dot" /> : null}
      {label ?? formatStatus(status)}
    </span>
  );
}
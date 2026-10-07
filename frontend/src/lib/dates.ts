/**
 * Centralized date/time utilities.
 * The API stores/consumes UTC ISO strings. All formatting happens here —
 * never scattered across components — so local vs UTC is always explicit.
 */

export function parseUtc(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time);
}

/** Format a UTC instant in the user's locale and an explicit time zone. */
export function formatDateTime(
  iso: string | null | undefined,
  locale = 'en-GB',
  options: { timeZone?: string; dateStyle?: 'short' | 'medium' | 'long'; timeStyle?: 'short' | 'medium' } = {},
): string {
  const date = parseUtc(iso);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: options.dateStyle ?? 'medium',
      timeStyle: options.timeStyle ?? 'short',
      timeZone: options.timeZone ?? 'UTC',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatDate(iso: string | null | undefined, locale = 'en-GB', timeZone = 'UTC'): string {
  const date = parseUtc(iso);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Kickoff display: local time plus an explicit UTC reference. */
export function formatKickoff(
  iso: string | null | undefined,
  locale = 'en-GB',
  timeZone?: string,
): { local: string; utc: string } {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  return {
    local: formatDateTime(iso, locale, { timeZone: zone }),
    utc: formatDateTime(iso, 'en-GB', { timeZone: 'UTC' }),
  };
}

/** Kickoff in Bangladesh time (Asia/Dhaka) for local supporters. */
export function formatKickoffDhaka(iso: string | null | undefined, locale = 'en-GB'): { local: string; utc: string } {
  return {
    local: formatDateTime(iso, locale, { timeZone: 'Asia/Dhaka' }),
    utc: formatDateTime(iso, 'en-GB', { timeZone: 'UTC' }),
  };
}

export function formatRelative(iso: string | null | undefined, nowMs: number = Date.now()): string {
  const date = parseUtc(iso);
  if (!date) return '';
  const diffMs = nowMs - date.getTime();
  if (diffMs < 0) return 'upcoming';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

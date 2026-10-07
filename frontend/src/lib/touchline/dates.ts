/**
 * Date helpers for API timestamps.
 *
 * The API stores and returns UTC ISO-8601 instants. Formatting is centralised
 * here so UTC-vs-local is always an explicit decision rather than something a
 * component decides by accident.
 */
export function parseUtc(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time);
}

/** Formats a UTC instant. Falls back to the raw ISO date if the format fails. */
export function formatDateTime(iso: string | null | undefined, locale = "en-GB", timeZone = "UTC"): string {
  const date = parseUtc(iso);
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Relative label for a publication or announcement timestamp, matching the
 * format the editorial UI already expects ("18 min ago", "3 hrs ago").
 * Returns an empty string when the API supplied no usable timestamp.
 */
export function formatRelative(iso: string | null | undefined, nowMs: number = Date.now()): string {
  const date = parseUtc(iso);
  if (!date) return "";
  const diffMinutes = Math.floor((nowMs - date.getTime()) / 60_000);
  if (diffMinutes < 0) return "";
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return formatDateTime(iso);
}

/** Coerces a `numeric` PostgREST value that may arrive as a number or a string. */
export function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
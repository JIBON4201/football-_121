import { formatDateTime } from '@/lib/dates';

interface DateTimeDisplayProps {
  iso: string | null | undefined;
  locale?: string;
  timeZone?: string;
  label?: string;
}

/** Centralized <time> rendering (UTC stored, explicit zone shown). */
export function DateTimeDisplay({ iso, locale = 'en-GB', timeZone = 'UTC', label }: DateTimeDisplayProps) {
  if (!iso) return null;
  const text = formatDateTime(iso, locale, { timeZone });
  if (!text) return null;
  return (
    <time dateTime={iso} aria-label={label ?? text}>
      {text}
    </time>
  );
}

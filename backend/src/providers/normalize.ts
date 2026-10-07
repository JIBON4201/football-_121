/**
 * Centralized normalization. Adapters map provider-specific values first;
 * everything below runs afterward so all providers converge identically.
 * Invalid values are dropped (undefined), never silently coerced into
 * trusted canonical data.
 */

/** URL/filename-safe slug with diacritics stripped. */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  if (slug) return slug;
  const hint = fallback.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 12) || 'entity';
  return `entity-${hint}`.toLowerCase();
}

/** Uppercase 2-3 letter country code, or undefined when unusable. */
export function normalizeCountryCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2,3}$/.test(code) ? code : undefined;
}

/** Valid ISO datetime, or undefined. */
export function normalizeDateTime(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** Valid YYYY-MM-DD date, or undefined. */
export function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  const time = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(time) ? undefined : `${match[1]}-${match[2]}-${match[3]}`;
}

export function normalizeInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.floor(value);
  return rounded >= min && rounded <= max ? rounded : undefined;
}

export function normalizeNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value >= min && value <= max ? value : undefined;
}

export function normalizeCurrency(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : undefined;
}

export function normalizeFoot(value: unknown): 'left' | 'right' | 'both' | undefined {
  if (typeof value !== 'string') return undefined;
  const foot = value.trim().toLowerCase();
  return foot === 'left' || foot === 'right' || foot === 'both' ? foot : undefined;
}

export function normalizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.slice(0, maxLength);
}

export function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    return url.toString().slice(0, 500);
  } catch {
    return undefined;
  }
}

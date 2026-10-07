import { siteConfig } from '@/config/site';

const SLUG_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** Mirror of the backend slug rule — invalid slugs must 404, never fetch. */
export function isValidSlug(slug: string): boolean {
  return typeof slug === 'string' && slug.length >= 1 && slug.length <= 300 && SLUG_PATTERN.test(slug);
}

/**
 * Safe href for user/content-provided URLs. Allows same-site relative paths
 * and absolute URLs on the configured site origin; everything else (including
 * javascript:, data:, protocol-relative and foreign origins) is rejected.
 */
export function toSafeHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (value.length === 0 || value.length > 2000) return null;
  if (/[\0<>"'\s]/.test(value)) return null;
  const lower = value.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) return null;
  if (value.startsWith('//')) return null;
  if (value.startsWith('/')) {
    if (!value.startsWith('/') || value.startsWith('/\\')) return null;
    return value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const site = new URL(siteConfig.siteUrl);
    if (parsed.origin !== site.origin) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Strip markup for safe text rendering (previews, aria-labels, metadata). */
export function sanitizeText(raw: string | null | undefined, maxLength = 500): string {
  if (!raw) return '';
  return String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function parsePositiveInt(raw: string | string[] | undefined, fallback: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

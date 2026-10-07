import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';

/** Slugs are URL-safe tokens only — quotes, spaces and SQL metacharacters rejected. */
export const slugSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9_.-]+$/, 'Invalid slug');

export const uuidSchema = z.string().uuid('Invalid UUID');

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date, expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');

export const pageSchema = z.coerce.number().int().min(1).default(1);
export const limitSchema = z.coerce.number().int().min(1).default(20);
export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');
export const searchSchema = z.string().min(1).max(200).optional();

/**
 * Escape user input for PostgREST `ilike` patterns embedded in `or=` filters.
 * PostgREST splits `or` on commas and treats `%`/`_` as wildcards and
 * `()/"/'`/`:` as filter syntax. Strip the structural characters and escape
 * LIKE wildcards so search input is always treated as a literal.
 */
export function escapeIlike(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/[,()"':;*?.!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export const ARTICLE_TYPES = [
  'news',
  'breaking_news',
  'transfer',
  'match_report',
  'analysis',
  'opinion',
] as const;

export const MATCH_STATUSES = [
  'scheduled',
  'pre_match',
  'live',
  'half_time',
  'extra_time',
  'penalty_shootout',
  'finished',
  'postponed',
  'cancelled',
  'abandoned',
  'suspended',
] as const;

export const MATCH_PHASES = ['upcoming', 'live', 'finished'] as const;

/** Public transfer visibility is restricted to announced/completed. */
export const PUBLIC_TRANSFER_STATUSES = ['announced', 'completed'] as const;

export const TRANSFER_TYPES = ['permanent', 'loan', 'loan_return', 'free_transfer'] as const;

/**
 * Statuses that count as in-play.
 *
 * `suspended` is included deliberately: a halted match has not finished, and
 * excluding it would make the fixture vanish from the live feed precisely when
 * a reader most wants to know it is suspended.
 */
export const LIVE_MATCH_STATUSES: readonly string[] = [
  'live',
  'half_time',
  'extra_time',
  'penalty_shootout',
  'suspended',
];

export const UPCOMING_MATCH_STATUSES: readonly string[] = ['scheduled', 'pre_match'];

export const ARTICLE_STATUSES = ['draft', 'review', 'scheduled', 'published', 'archived'] as const;

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const articleTitleSchema = z.string().trim().min(5, 'Title too short').max(300, 'Title too long');

export const articleExcerptSchema = z.string().trim().max(2000).optional();

export const articleContentSchema = z.string().trim().min(20, 'Content too short').max(200_000);

export const articleTypeSchema = z.enum(ARTICLE_TYPES);

export const mediaIdSchema = uuidSchema;

export const seoMetaTitleSchema = z.string().trim().max(70).optional();

export const seoMetaDescriptionSchema = z.string().trim().max(160).optional();

export const canonicalUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('/') || v.startsWith('https://') || v.startsWith('http://'), 'Invalid canonical URL')
  .optional();

/** URL-safe deterministic slug base from a title. Uniqueness is enforced at write time. */
export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 120);
  return base.length > 0 ? base : 'article';
}

/**
 * Allowlist HTML sanitization. The previous regex-based stripper left
 * encoded `javascript:` URIs, `<iframe>`/`<form>`/`<base>`/`<meta>` and
 * `data:` URLs intact — replace it wholesale with sanitize-html.
 */
export function sanitizeContent(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'strong', 'em', 'b', 'i', 'u', 's', 'br', 'hr',
      'figure', 'figcaption', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'loading'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  }).trim();
}

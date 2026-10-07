import sanitizeHtml from 'sanitize-html';

/**
 * Article body sanitization. Untrusted CMS content is cleaned through an
 * allowlist before dangerouslySetInnerHTML — raw HTML is never injected.
 * Formatting intent is preserved: headings, paragraphs, lists, links,
 * images, quotes. Scripts, styles, event handlers and unsafe schemes are
 * always stripped.
 */
const ALLOWED_TAGS = [
  'p',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'strong',
  'em',
  'blockquote',
  'img',
  'figure',
  'figcaption',
  'br',
  'hr',
];

export function sanitizeArticleContent(dirty: string | null | undefined): string {
  if (!dirty) return '';
  return sanitizeHtml(String(dirty), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    enforceHtmlBoundary: true,
  }).trim();
}

/** True when sanitized output still carries readable content. */
export function hasRenderableContent(dirty: string | null | undefined): boolean {
  if (!dirty) return false;
  const text = sanitizeHtml(String(dirty), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0;
}

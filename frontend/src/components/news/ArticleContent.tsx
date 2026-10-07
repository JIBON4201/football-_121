import { hasRenderableContent, sanitizeArticleContent } from '@/lib/content';

/**
 * Article body. CMS HTML is allowlist-sanitized before injection — raw
 * untrusted markup never reaches the DOM. Empty bodies render nothing.
 */
export function ArticleContent({ content }: { content: string | null | undefined }) {
  if (!hasRenderableContent(content)) return null;
  const html = sanitizeArticleContent(content);
  if (!html) return null;
  return <div className="article-content" dangerouslySetInnerHTML={{ __html: html }} />;
}

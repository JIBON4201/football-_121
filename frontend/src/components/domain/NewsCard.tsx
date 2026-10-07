import type { Article } from '@/types/api';
import { trackAttributes } from '@/lib/analytics';
import { Badge } from '@/components/ui/Badge';
import { formatRelative } from '@/lib/dates';
import { sanitizeText } from '@/lib/validation';

/** Presentation-only news card. */
export function NewsCard({ article, href }: { article: Article; href: string }) {
  return (
    <article aria-label={sanitizeText(article.title)}>
      <a href={href} {...trackAttributes('article', article.id)}>
        <h3>{sanitizeText(article.title)}</h3>
      </a>
      {article.excerpt ? <p>{sanitizeText(article.excerpt, 200)}</p> : null}
      <p>
        {article.is_breaking ? <Badge tone="warning">Breaking</Badge> : null}
        {article.published_at ? (
          <time dateTime={article.published_at}>{formatRelative(article.published_at)}</time>
        ) : null}
      </p>
    </article>
  );
}

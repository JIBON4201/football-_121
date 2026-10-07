import { entityUrl } from '@/config/routes';
import { trackAttributes } from '@/lib/analytics';
import { Badge } from '@/components/ui/Badge';
import { DateTimeDisplay } from '@/components/domain/DateTimeDisplay';
import { formatRelative } from '@/lib/dates';
import { sanitizeText } from '@/lib/validation';
import { ArticleContent } from '@/components/news/ArticleContent';
import { EntityLinks } from '@/components/news/EntityLinks';
import { RelatedArticles } from '@/components/news/RelatedArticles';
import { ShareButtons } from '@/components/news/ShareButtons';
import type { AdjacentArticles, RelatedLink } from '@/lib/news';
import type { Article } from '@/types/api';

interface ArticleDetailViewProps {
  article: Article;
  canonicalUrl: string;
  entities: RelatedLink[];
  related: RelatedLink[];
  adjacent: AdjacentArticles | null;
}

/**
 * Full article page composition. Everything shown comes from public API
 * data — categories, tags, authors and images are absent from the public
 * contract and are omitted rather than invented.
 */
export function ArticleDetailView({ article, canonicalUrl, entities, related, adjacent }: ArticleDetailViewProps) {
  return (
    <article aria-labelledby="article-heading" className="container article-detail">
      <p className="article-detail__kicker">
        <Badge tone={article.is_breaking ? 'warning' : 'info'}>{article.article_type.replace(/_/g, ' ')}</Badge>
        {article.is_breaking ? <Badge tone="warning">Breaking</Badge> : null}
      </p>
      <h1 id="article-heading">{sanitizeText(article.title)}</h1>
      <p className="article-detail__meta">
        {article.published_at ? (
          <>
            <DateTimeDisplay iso={article.published_at} label={`Published ${article.published_at}`} />{' '}
            <span>({formatRelative(article.published_at)})</span>
          </>
        ) : null}
      </p>
      {article.excerpt ? <p className="article-detail__excerpt">{sanitizeText(article.excerpt, 280)}</p> : null}
      <ArticleContent content={article.content} />
      <ShareButtons url={canonicalUrl} title={sanitizeText(article.title)} />
      <EntityLinks entities={entities} />
      <RelatedArticles links={related} />
      <nav aria-label="Article navigation">
        <ul className="article-detail__nav">
          {adjacent?.newer ? (
            <li>
              <a href={entityUrl('news', adjacent.newer.slug)} rel="prev" {...trackAttributes('article', adjacent.newer.id)}>
                Newer: {sanitizeText(adjacent.newer.title)}
              </a>
            </li>
          ) : null}
          {adjacent?.older ? (
            <li>
              <a href={entityUrl('news', adjacent.older.slug)} rel="next" {...trackAttributes('article', adjacent.older.id)}>
                Older: {sanitizeText(adjacent.older.title)}
              </a>
            </li>
          ) : null}
          <li>
            <a href="/news">Back to all news</a>
          </li>
        </ul>
      </nav>
    </article>
  );
}

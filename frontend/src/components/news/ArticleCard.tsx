import { trackAttributes } from '@/lib/analytics';
import { Badge } from '@/components/ui/Badge';
import { formatRelative } from '@/lib/dates';
import { ResponsiveImage } from '@/components/media/ResponsiveImage';
import { sanitizeText } from '@/lib/validation';
import type { Article, MediaVariant } from '@/types/api';

export interface ArticleImage {
  media: {
    public_url: string | null;
    width: number | null;
    height: number | null;
    alt_text: string | null;
    file_name: string;
  };
  variants?: MediaVariant[];
}

interface ArticleCardProps {
  article: Article;
  href: string;
  /** Hero cards use larger type and eager art; list cards stay lazy. */
  variant?: 'standard' | 'hero';
  image?: ArticleImage | null;
}

/**
 * News card with optional Media Service imagery. Without image data the
 * card stays text-first — visuals are never fabricated.
 */
export function ArticleCard({ article, href, variant = 'standard', image = null }: ArticleCardProps) {
  const Heading = variant === 'hero' ? 'h2' : 'h3';
  return (
    <article aria-label={sanitizeText(article.title)} className={`article-card article-card--${variant}`}>
      {image ? (
        <a href={href} aria-hidden="true" tabIndex={-1} {...trackAttributes('article', article.id)}>
          <ResponsiveImage
            media={{ ...image.media, alt_text: image.media.alt_text ?? article.title }}
            variants={image.variants ?? []}
            eager={variant === 'hero'}
          />
        </a>
      ) : null}
      <a href={href} {...trackAttributes('article', article.id)}>
        <Heading>{sanitizeText(article.title)}</Heading>
      </a>
      {article.excerpt ? <p>{sanitizeText(article.excerpt, variant === 'hero' ? 280 : 200)}</p> : null}
      <p className="article-card__meta">
        {article.is_breaking ? <Badge tone="warning">Breaking</Badge> : null}
        <Badge tone="info">{article.article_type.replace(/_/g, ' ')}</Badge>
        {article.published_at ? (
          <time dateTime={article.published_at}>{formatRelative(article.published_at)}</time>
        ) : null}
      </p>
    </article>
  );
}

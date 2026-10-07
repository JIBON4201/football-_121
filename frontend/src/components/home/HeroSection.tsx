import { entityUrl } from '@/config/routes';
import { trackAttributes } from '@/lib/analytics';
import {
  loadBreakingNews,
  loadLatestNews,
  selectHeroArticle,
  withoutId,
} from '@/lib/homepage';
import { Badge } from '@/components/ui/Badge';
import { formatRelative } from '@/lib/dates';
import { sanitizeText } from '@/lib/validation';
import type { Article } from '@/types/api';
import { HomeSectionSkeleton } from '@/components/home/SectionShell';

/**
 * Hero: breaking article preferred, latest fallback. Text-first because the
 * public news API carries no image data — no fabricated visuals.
 */
export function HeroView({ article }: { article: Article }) {
  const href = entityUrl('news', article.slug);
  return (
    <section aria-labelledby="home-hero-heading" className="home-hero">
      <p className="home-hero__kicker">
        {article.is_breaking ? <Badge tone="warning">Breaking</Badge> : <Badge tone="info">{article.article_type.replace(/_/g, ' ')}</Badge>}
      </p>
      <h2 id="home-hero-heading" className="home-hero__headline">
        <a href={href} {...trackAttributes('article', article.id)}>
          {sanitizeText(article.title)}
        </a>
      </h2>
      {article.excerpt ? <p className="home-hero__excerpt">{sanitizeText(article.excerpt, 200)}</p> : null}
      <p className="home-hero__meta">
        {article.published_at ? (
          <time dateTime={article.published_at}>{formatRelative(article.published_at)}</time>
        ) : null}
      </p>
    </section>
  );
}

/**
 * Secondary headlines beside the feature. Same request as the feature
 * selection (breaking + latest), so identical fetches elsewhere on the page
 * resolve from the request cache — no additional API traffic.
 */
export function HeroSecondary({ articles }: { articles: Article[] }) {
  if (articles.length === 0) return null;
  return (
    <div className="hero-secondary">
      <ul className="hero-secondary__list" aria-label="More top stories">
        {articles.map((article) => (
          <li key={article.id} className="hero-secondary__item">
            <p className="hero-secondary__kicker">
              {article.is_breaking ? (
                <Badge tone="warning">Breaking</Badge>
              ) : (
                <Badge tone="info">{article.article_type.replace(/_/g, ' ')}</Badge>
              )}
            </p>
            <a
              className="hero-secondary__link"
              href={entityUrl('news', article.slug)}
              {...trackAttributes('article', article.id)}
            >
              {sanitizeText(article.title)}
            </a>
            {article.published_at ? (
              <p className="hero-secondary__meta">
                <time dateTime={article.published_at}>{formatRelative(article.published_at)}</time>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HeroEmpty() {
  return null;
}

export async function HeroSection() {
  const [breaking, latest] = await Promise.all([
    loadBreakingNews().catch(() => ({ status: 'error' as const, items: [] })),
    loadLatestNews().catch(() => ({ status: 'error' as const, items: [] })),
  ]);
  const featured = selectHeroArticle(breaking.items, latest.items);
  if (!featured) return <HeroEmpty />;
  // Next two stories after the feature: remaining breaking first, then latest.
  const secondary = [...withoutId(breaking.items, featured.id), ...withoutId(latest.items, featured.id)].slice(0, 2);
  return (
    <div className="home-hero-grid">
      <HeroView article={featured} />
      <HeroSecondary articles={secondary} />
    </div>
  );
}

export function HeroSkeleton() {
  return <HomeSectionSkeleton label="Loading featured story" />;
}

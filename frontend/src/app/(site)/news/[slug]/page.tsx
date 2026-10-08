import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/touchline/empty-state";
import { NewsCard } from "@/components/touchline/news-card";
import { BreadcrumbStructuredData, Breadcrumbs, ContentSection, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { siteConfig } from "@/config/site";
import { getArticlePageData, getArticleBySlug, getRelatedStories, getSiteUrl } from "@/lib/touchline/site-data";

type RouteProps = { params: { slug: string } };

interface ArticleLink {
  title: string;
  url: string;
}

interface RelatedCoverage {
  entities: ArticleLink[];
  related: ArticleLink[];
}

/**
 * Entity and article relations for the story, from real relation rows only.
 * A failure here is reported as "no relations" so the article still renders.
 */
async function fetchRelatedCoverage(slug: string): Promise<RelatedCoverage> {
  try {
    const mod = await import("@/lib/news");
    const rel = await mod.fetchRelatedArticles(slug, 6);
    return {
      entities: (rel.entities ?? [])
        .slice(0, 8)
        .map((e) => ({ title: e.title, url: e.url.replace(/^https?:\/\/[^/]+/, "") }))
        .filter((e) => e.url.startsWith("/")),
      related: (rel.related ?? [])
        .slice(0, 6)
        .map((e) => ({ title: e.title, url: e.url.replace(/^https?:\/\/[^/]+/, "") }))
        .filter((e) => e.url.startsWith("/news/")),
    };
  } catch {
    return { entities: [], related: [] };
  }
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = params;
  const article = await getArticleBySlug(slug);
  if (!article) return buildPageMetadata({ title: "Article not found", description: "This football story could not be found.", path: `/news/${slug}`, noIndex: true });
  return buildPageMetadata({
    title: article.story.title,
    description: article.story.summary ?? `${article.story.category} from Touchline.`,
    path: `/news/${slug}`,
    image: article.story.image?.src,
    type: "article",
  });
}

export default async function NewsArticlePage({ params }: RouteProps) {
  const { slug } = params;
  // The article plus the newsroom pool its sidebar and related-coverage links
  // are matched against. The related-entity feed is read alongside them rather
  // than after them.
  const [{ article, stories, isDemo }, relations] = await Promise.all([
    getArticlePageData(slug),
    fetchRelatedCoverage(slug),
  ]);
  if (!article) notFound();
  // Entity-specific internal links from real article relations (no invented links).
  // Falls back to empty so the page still renders when the SEO service is down.
  const entityLinks = relations.entities;
  const relatedSeo = relations.related;
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: "News", href: "/news" }, { label: article.story.title, href: `/news/${slug}` }];
  const related = getRelatedStories(stories.filter((story) => story.href !== article.story.href), [article.story.category]).slice(0, 3);
  const relatedHrefs = new Set(related.map((story) => story.href));
  const sidebarStories = stories.filter((story) => story.href !== article.story.href && !relatedHrefs.has(story.href)).slice(0, 4);
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.story.title,
    description: article.story.summary,
    image: article.story.image ? [article.story.image.src] : [],
    mainEntityOfPage: new URL(`/news/${slug}`, getSiteUrl()).toString(),
    author: article.author ? { "@type": "Organization", name: article.author } : undefined,
    publisher: {
      "@type": "Organization",
      name: siteConfig.name,
      url: getSiteUrl(),
      logo: { "@type": "ImageObject", url: new URL(siteConfig.defaultImage, getSiteUrl()).toString() },
    },
    datePublished: article.publishedIso,
  };
  return (
    <PageLayout isDemo={isDemo}>
      <BreadcrumbStructuredData items={breadcrumbItems} />
      <StructuredData data={articleJsonLd} />
      <article className="page-container article-page">
        <Breadcrumbs items={breadcrumbItems} />
        <header className="article-header">
          <div className="meta-line"><span className="category-label category-label--accent">{article.story.category}</span><span className="meta-separator" aria-hidden="true">·</span><time>{article.story.publishedAt}</time>{article.readingMinutes ? (<><span className="meta-separator" aria-hidden="true">·</span><span>{article.readingMinutes} min read</span></>) : null}</div>
          <h1>{article.story.title}</h1>
          {article.story.summary && <p className="article-header__summary">{article.story.summary}</p>}
          {article.author && <div className="article-byline"><span className="article-byline__avatar" aria-hidden="true">T</span><span><strong>{article.author}</strong><small>Independent football journalism</small></span></div>}
        </header>
        {article.story.image && <figure className="article-cover"><img src={article.story.image.src} srcSet={article.story.image.srcSet} sizes="(max-width: 760px) 100vw, 1200px" alt={article.story.image.alt} fetchPriority="high" /><figcaption>{article.story.image.alt}</figcaption></figure>}
        <div className="article-layout">
          <div className="article-body">
            {article.body.length ? article.body.map((paragraph, index) => <p key={`${slug}-paragraph-${index}`}>{paragraph}</p>) : <EmptyState title="Article unavailable" description="Check back soon." />}
            <div className="article-endmark" aria-label="End of article"><span /><span /><span /></div>
            {entityLinks.length > 0 && (
              <nav aria-label="Related teams, players and competitions" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {entityLinks.map((link) => (
                  <a key={link.url} className="filter-chip" href={link.url}>{link.title}</a>
                ))}
              </nav>
            )}
            <nav aria-label="Article sections" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <a className="filter-chip" href="/news">More {article.story.category}</a>
              <a className="filter-chip" href="/matches">Fixtures &amp; results</a>
              <a className="filter-chip" href="/transfers">Transfer centre</a>
            </nav>
            {relatedSeo.length > 0 && (
              <nav aria-label="Related coverage" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {relatedSeo.map((link) => (
                  <a key={link.url} className="text-link" href={link.url}>{link.title}</a>
                ))}
              </nav>
            )}
          </div>
          <aside className="article-sidebar" aria-label="More from the newsroom"><p className="eyebrow">Keep reading</p><h2>More from the newsroom</h2>{sidebarStories.length ? <ul className="article-sidebar__list">{sidebarStories.map((story) => <li key={story.id}><a href={story.href}>{story.title}</a><time>{story.category} · {story.publishedAt}</time></li>)}</ul> : <p>Follow the latest reporting, analysis and detail from across football.</p>}<a className="text-link" href="/news">Explore all news <span aria-hidden="true">→</span></a></aside>
        </div>
        <ContentSection eyebrow="Related" title="More coverage">
          {related.length ? <div className="editorial-card-grid">{related.map((story) => <NewsCard story={story} key={story.id} />)}</div> : <EmptyState title="No related stories" description="Check back soon." compact />}
        </ContentSection>
      </article>
    </PageLayout>
  );
}

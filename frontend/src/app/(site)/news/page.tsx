import type { Metadata } from "next";
import { NewsExplorer } from "@/components/touchline/directory-explorer";
import { BreadcrumbStructuredData, PageIntro, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getNewsroomPageData } from "@/lib/touchline/site-data";
import { siteConfig } from "@/config/site";

type SearchParams = { type?: string; page?: string };

export async function generateMetadata({ searchParams }: { searchParams?: SearchParams }): Promise<Metadata> {
  const params = searchParams ?? {};
  const type = typeof params.type === "string" ? params.type : undefined;
  // The newsroom is a single-view archive (all stories server-rendered in one
  // HTML payload via NewsExplorer). Paged query strings do not slice content,
  // so they canonicalize to the stable base rather than minting duplicate
  // "Page N" canonicals with identical bodies. Breaking lives at
  // /breaking-news so /news?type=breaking never duplicates it.
  if (type === "breaking" || type === "breaking_news") {
    return buildPageMetadata({
      title: "Latest Football News",
      description: "The latest football news, breaking updates, analysis, features and match previews from around the world.",
      path: "/breaking-news",
    });
  }
  return buildPageMetadata({
    title: "Latest Football News",
    description: "The latest football news, breaking updates, analysis, features and match previews from around the world.",
    path: "/news",
  });
}

export default async function NewsPage({ searchParams }: { searchParams?: SearchParams }) {
  const params = searchParams ?? {};
  const initialCategory = params.type === "breaking" ? "Breaking" : "All";
  // The published archive, the breaking strip behind it and the taxonomy links
  // that close the sitemap-orphan gap for category and tag pages — four parallel
  // reads, and no duplicate latest-news request.
  const { stories, breakingNews, categoryLinks, tagLinks, isDemo } = await getNewsroomPageData();
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: "News" }];
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: stories.slice(0, 30).map((story, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: new URL(story.href, siteConfig.siteUrl).toString(),
      name: story.title,
    })),
  };
  return (
    <PageLayout isDemo={isDemo}>
      <BreadcrumbStructuredData items={breadcrumbItems} />
      <StructuredData data={itemListJsonLd} />
      <div className="page-container page-container--content news-page">
        <PageIntro eyebrow="Newsroom" title="Football news" breadcrumbs={[{ label: "Home", href: "/" }, { label: "News" }]} />
        {breakingNews.length > 0 && <section className="news-breaking-strip" aria-labelledby="news-breaking-heading">
          <div className="news-breaking-strip__label"><span className="breaking-pulse" aria-hidden="true" /><h2 id="news-breaking-heading">Breaking</h2></div>
          <div className="news-breaking-strip__items">{breakingNews.slice(0, 3).map((item) => <article className="news-breaking-strip__item" key={item.id}><a href={item.href}>{item.headline}</a><time>{item.publishedAt}</time></article>)}</div>
          <a className="news-breaking-strip__all" href="/breaking-news">All <span aria-hidden="true">→</span></a>
        </section>}
        <NewsExplorer key={initialCategory} stories={stories} initialCategory={initialCategory} />
        {(categoryLinks.length > 0 || tagLinks.length > 0) && (
          <nav aria-label="Browse news by topic" style={{ marginTop: 28 }}>
            {categoryLinks.length > 0 && (
              <section aria-labelledby="news-categories-heading">
                <h2 id="news-categories-heading">Browse by category</h2>
                <ul style={{ display: "flex", gap: 8, flexWrap: "wrap", listStyle: "none", padding: 0 }}>
                  {categoryLinks.map((c) => (
                    <li key={c.slug}><a className="filter-chip" href={`/news/category/${c.slug}`}>{c.name}</a></li>
                  ))}
                </ul>
              </section>
            )}
            {tagLinks.length > 0 && (
              <section aria-labelledby="news-tags-heading" style={{ marginTop: 16 }}>
                <h2 id="news-tags-heading">Browse by tag</h2>
                <ul style={{ display: "flex", gap: 8, flexWrap: "wrap", listStyle: "none", padding: 0 }}>
                  {tagLinks.map((t) => (
                    <li key={t.slug}><a className="filter-chip" href={`/news/tag/${t.slug}`}>{t.name}</a></li>
                  ))}
                </ul>
              </section>
            )}
          </nav>
        )}
      </div>
    </PageLayout>
  );
}

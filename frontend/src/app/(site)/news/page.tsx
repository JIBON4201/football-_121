import type { Metadata } from "next";
import { NewsExplorer } from "@/components/touchline/directory-explorer";
import { BreadcrumbStructuredData, PageIntro, PageLayout, StructuredData } from "@/components/touchline/page-components";
import { buildPageMetadata } from "@/lib/touchline/seo";
import { getFootballSiteData } from "@/lib/touchline/site-data";

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
  const data = await getFootballSiteData();
  const params = searchParams ?? {};
  const initialCategory = params.type === "breaking" ? "Breaking" : "All";
  // Merge the full backend archive so every sitemap-listed article is linked
  // from the newsroom (the homepage pool only carries the latest window).
  // Same NewsExplorer UI — just a complete story set, no invented content.
  try {
    const { fetchNewsList } = await import("@/lib/news");
    const archive = await fetchNewsList({ page: 1, limit: 100 }).catch(() => null);
    if (archive && archive.rows.length > 0) {
      const { toNewsStory } = await import("@/lib/touchline/homepage-api");
      const seen = new Set(data.allNews.map((s) => s.href));
      for (const row of archive.rows) {
        if (!row.slug) continue;
        const href = `/news/${row.slug}`;
        if (seen.has(href)) continue;
        seen.add(href);
        try {
          data.allNews.push(toNewsStory(row as never));
        } catch {
          // skip unmappable rows — never invent a story
        }
      }
    }
  } catch {
    // pool-only fallback — page still renders crawlable links
  }
  // Category/tag directory: these taxonomy pages are sitemap-listed but have
  // no header/footer entry point. Server-rendered <a> links here close the
  // orphan gap without inventing relationships — only real taxonomy rows.
  let categoryLinks: Array<{ name: string; slug: string }> = [];
  let tagLinks: Array<{ name: string; slug: string }> = [];
  try {
    const { fetchServer } = await import("@/lib/data-fetch");
    const [cats, tags] = await Promise.all([
      fetchServer<Array<{ name: string; slug: string }>>("/categories", { page: 1, limit: 50, revalidate: 3600 }).catch(() => null),
      fetchServer<Array<{ name: string; slug: string }>>("/tags", { page: 1, limit: 50, revalidate: 3600 }).catch(() => null),
    ]);
    const pick = (v: unknown): Array<{ name: string; slug: string }> =>
      Array.isArray(v)
        ? v.filter((r): r is { name: string; slug: string } => typeof r === "object" && r !== null && typeof (r as { slug?: unknown }).slug === "string" && typeof (r as { name?: unknown }).name === "string").slice(0, 30)
        : [];
    categoryLinks = pick(cats?.data);
    tagLinks = pick(tags?.data);
  } catch {
    categoryLinks = [];
    tagLinks = [];
  }
  const breadcrumbItems = [{ label: "Home", href: "/" }, { label: "News" }];
  const { siteConfig } = await import("@/config/site");
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: data.allNews.slice(0, 30).map((story, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: new URL(story.href, siteConfig.siteUrl).toString(),
      name: story.title,
    })),
  };
  return (
    <PageLayout isDemo={data.isDemo}>
      <BreadcrumbStructuredData items={breadcrumbItems} />
      <StructuredData data={itemListJsonLd} />
      <div className="page-container page-container--content news-page">
        <PageIntro eyebrow="Newsroom" title="Football news" breadcrumbs={[{ label: "Home", href: "/" }, { label: "News" }]} />
        {data.breakingNews.length > 0 && <section className="news-breaking-strip" aria-labelledby="news-breaking-heading">
          <div className="news-breaking-strip__label"><span className="breaking-pulse" aria-hidden="true" /><h2 id="news-breaking-heading">Breaking</h2></div>
          <div className="news-breaking-strip__items">{data.breakingNews.slice(0, 3).map((item) => <article className="news-breaking-strip__item" key={item.id}><a href={item.href}>{item.headline}</a><time>{item.publishedAt}</time></article>)}</div>
          <a className="news-breaking-strip__all" href="/breaking-news">All <span aria-hidden="true">→</span></a>
        </section>}
        <NewsExplorer key={initialCategory} stories={data.allNews} initialCategory={initialCategory} />
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

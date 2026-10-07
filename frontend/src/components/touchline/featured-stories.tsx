/* Native responsive images are used so the existing media URLs can provide srcSet without requiring a next.config remote-host change. */
import type { NewsStory } from "@/lib/touchline/homepage-types";
import { Icon } from "./icons";

function SupportingStory({ story }: { story: NewsStory }) {
  return (
    <article className={`support-story${story.image ? "" : " support-story--no-image"}`}>
      {story.image ? (
        <a className="support-story__image media-frame" href={story.href} tabIndex={-1} aria-hidden="true">
          <img src={story.image.src} srcSet={story.image.srcSet} sizes="(max-width: 680px) 32vw, 220px" alt="" loading="lazy" decoding="async" />
        </a>
      ) : null}
      <div className="support-story__body">
        <div className="meta-line"><span className="category-label">{story.category}</span><span className="meta-separator" aria-hidden="true">·</span><time>{story.publishedAt}</time></div>
        <h2><a href={story.href}>{story.title}</a></h2>
      </div>
    </article>
  );
}

export function FeaturedStories({ featuredStory, supportingStories }: { featuredStory?: NewsStory; supportingStories: NewsStory[] }) {
  if (!featuredStory) {
    return (
      <section className="hero-section" aria-labelledby="featured-title">
        <div className="page-container">
          <div className="hero-empty">
            <p className="eyebrow">Top stories</p>
            <h1 id="featured-title">Football, in focus.</h1>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="hero-section" aria-labelledby="featured-title">
      <div className="page-container">
        <div className="hero-kicker"><span className="eyebrow">Top stories</span><span className="hero-kicker__rule" /></div>
        <div className="hero-grid">
          <article className={`hero-feature${featuredStory.image ? "" : " hero-feature--no-image"}`}>
            {featuredStory.image ? (
              <a className="hero-feature__image media-frame" href={featuredStory.href} tabIndex={-1} aria-hidden="true">
                <img src={featuredStory.image.src} srcSet={featuredStory.image.srcSet} sizes="(max-width: 680px) 100vw, (max-width: 1024px) 100vw, 62vw" alt="" fetchPriority="high" decoding="async" />
                <span className="hero-feature__image-label">The big story <Icon name="arrow-up-right" size={14} /></span>
              </a>
            ) : null}
            <div className="hero-feature__content">
              <div className="meta-line"><span className="category-label category-label--accent">{featuredStory.category}</span><span className="meta-separator" aria-hidden="true">·</span><time>{featuredStory.publishedAt}</time></div>
              <h1 id="featured-title"><a href={featuredStory.href}>{featuredStory.title}</a></h1>
              {featuredStory.summary && <p className="hero-feature__summary">{featuredStory.summary}</p>}
              <a className="read-more" href={featuredStory.href}>Read the full story <Icon name="arrow-right" size={16} /></a>
            </div>
          </article>
          <aside className="hero-supporting" aria-label="More top stories">
            <div className="hero-supporting__heading"><span className="eyebrow">Latest headlines</span><span className="hero-supporting__count">{supportingStories.length} stories</span></div>
            {supportingStories.map((story) => <SupportingStory key={story.id} story={story} />)}
            <a className="hero-supporting__all" href="/news">All news <Icon name="arrow-right" size={16} /></a>
          </aside>
        </div>
      </div>
    </section>
  );
}

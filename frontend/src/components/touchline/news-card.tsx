/* Native responsive images are used so the existing media URLs can provide srcSet without requiring a next.config remote-host change. */
import type { NewsStory } from "@/lib/touchline/homepage-types";

export type NewsCardVariant = "standard" | "compact" | "headline";

export function NewsCard({ story, variant = "standard" }: { story: NewsStory; variant?: NewsCardVariant }) {
  if (variant === "headline") {
    return (
      <article className="news-card news-card--headline">
        <div className="meta-line"><span className="category-label">{story.category}</span><span className="meta-separator" aria-hidden="true">·</span><time>{story.publishedAt}</time></div>
        <h3><a href={story.href}>{story.title}</a></h3>
      </article>
    );
  }
  return (
    <article className={`news-card news-card--${variant}${story.image ? "" : " news-card--no-image"}`}>
      {story.image ? (
        <a className="news-card__image-link" href={story.href} tabIndex={-1} aria-hidden="true">
          <div className="news-card__image media-frame">
            <img src={story.image.src} srcSet={story.image.srcSet} sizes={variant === "compact" ? "(max-width: 680px) 32vw, 200px" : "(max-width: 680px) 100vw, (max-width: 1024px) 46vw, 30vw"} alt="" loading="lazy" decoding="async" />
          </div>
        </a>
      ) : null}
      <div className="news-card__body">
        <div className="meta-line"><span className="category-label">{story.category}</span><span className="meta-separator" aria-hidden="true">·</span><time>{story.publishedAt}</time></div>
        <h3><a href={story.href}>{story.title}</a></h3>
        {story.summary && variant === "standard" && <p className="news-card__summary">{story.summary}</p>}
      </div>
    </article>
  );
}

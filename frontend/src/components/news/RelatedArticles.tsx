import { sanitizeText } from '@/lib/validation';
import type { RelatedLink } from '@/lib/news';

/**
 * Related articles from backend shared-entity scoring (self excluded
 * server-side). LinkTargets carry only id/slug/title/url, so related items
 * render as honest title links — excerpt and timestamps are never invented.
 */
export function RelatedArticles({ links }: { links: RelatedLink[] }) {
  const safe = links.filter((link) => link.url.startsWith('/'));
  if (safe.length === 0) return null;
  return (
    <section aria-labelledby="related-heading">
      <h2 id="related-heading">Related articles</h2>
      <ul className="grid-cards" aria-label="Related articles">
        {safe.map((link) => (
          <li key={`${link.entityType}-${link.id}`}>
            <article aria-label={sanitizeText(link.title)}>
              <a href={link.url}>
                <h3>{sanitizeText(link.title)}</h3>
              </a>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { sanitizeText } from '@/lib/validation';
import { trackAttributes, type TrackableKind } from '@/lib/analytics';

interface EntityCardProps {
  title: string;
  subtitle?: string | null;
  href: string;
  image?: { src: string | null; alt: string };
  /** Entity kind + id for analytics hooks. Omitted when unknown. */
  trackKind?: TrackableKind;
  trackId?: string;
}

/** Generic entity card for teams/players/competitions search + listing use. */
export function EntityCard({ title, subtitle, href, image, trackKind, trackId }: EntityCardProps) {
  const tracking = trackKind && trackId ? trackAttributes(trackKind, trackId) : {};
  return (
    <article aria-label={sanitizeText(title)}>
      {image?.src ? <img src={image.src} alt={sanitizeText(image.alt)} loading="lazy" decoding="async" /> : null}
      <a href={href} {...tracking}>
        <h3>{sanitizeText(title)}</h3>
      </a>
      {subtitle ? <p>{sanitizeText(subtitle)}</p> : null}
    </article>
  );
}

import { sanitizeText } from '@/lib/validation';

interface BadgeImageProps {
  src: string | null;
  alt: string;
  size?: number;
  /** Above-the-fold badges (e.g. live matches) load eagerly. */
  eager?: boolean;
}

/** Shared <img> for badges/avatars with lazy loading + text fallback. */
function BadgeImage({ src, alt, size = 40, eager = false }: BadgeImageProps) {
  if (!src) {
    return (
      <span role="img" aria-label={alt} style={{ width: size, height: size }}>
        {sanitizeText(alt).slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={sanitizeText(alt)}
      width={size}
      height={size}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={(event) => {
        (event.target as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

export function TeamBadge({ name, logoUrl, size, eager }: { name: string; logoUrl: string | null; size?: number; eager?: boolean }) {
  return <BadgeImage src={logoUrl} alt={`${name} badge`} size={size} eager={eager} />;
}

export function CompetitionBadge({ name, logoUrl, size, eager }: { name: string; logoUrl: string | null; size?: number; eager?: boolean }) {
  return <BadgeImage src={logoUrl} alt={`${name} logo`} size={size} eager={eager} />;
}

export function PlayerAvatar({ name, photoUrl, size, eager }: { name: string; photoUrl: string | null; size?: number; eager?: boolean }) {
  return <BadgeImage src={photoUrl} alt={`${name}`} size={size} eager={eager} />;
}

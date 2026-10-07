import { responsiveProps } from '@/lib/media';
import type { MediaRecord, MediaVariant } from '@/types/api';

interface ResponsiveImageProps {
  media: Pick<MediaRecord, 'public_url' | 'width' | 'height' | 'alt_text'> & { file_name: string };
  variants?: MediaVariant[];
  sizes?: string;
  eager?: boolean;
  className?: string;
}

/**
 * Optimized image wired to the backend Media Service: variant srcset,
 * explicit dimensions (no layout shift), lazy decoding, graceful fallback.
 * CDN-compatible — absolute variant URLs pass straight through.
 */
export function ResponsiveImage({ media, variants = [], sizes, eager = false, className }: ResponsiveImageProps) {
  const props = responsiveProps(media, variants, sizes);
  return (
    <img
      src={props.src}
      srcSet={props.srcSet}
      sizes={props.sizes}
      width={props.width}
      height={props.height}
      alt={props.alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={className}
      onError={(event) => {
        const target = event.target as HTMLImageElement;
        if (target.src !== '/og-default.png') target.src = '/og-default.png';
      }}
    />
  );
}

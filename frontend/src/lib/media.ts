import type { MediaRecord, MediaVariant } from '@/types/api';

/**
 * Frontend media helpers. Presentation only — all processing happens in the
 * backend Media Service. URLs are CDN-compatible (absolute or site-relative).
 */

export interface ResponsiveSpec {
  src: string;
  srcSet: string | undefined;
  sizes: string;
  width: number | undefined;
  height: number | undefined;
}

/** Order variants smallest → largest for srcset construction. */
export function orderVariants(variants: MediaVariant[]): MediaVariant[] {
  return [...variants].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
}

/** Build srcset from variant URLs, skipping entries without URLs/widths. */
export function buildSrcSet(variants: MediaVariant[]): string | undefined {
  const parts = orderVariants(variants)
    .filter((variant) => variant.public_url && variant.width && variant.width > 0)
    .map((variant) => `${variant.public_url as string} ${variant.width}w`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export function pickFallback(variants: MediaVariant[], fallbackUrl: string | null): string {
  const medium = variants.find((variant) => variant.variant === 'medium' && variant.public_url);
  if (medium?.public_url) return medium.public_url;
  const largest = orderVariants(variants).reverse().find((variant) => variant.public_url);
  return largest?.public_url ?? fallbackUrl ?? '/og-default.png';
}

/** Responsive props for an <img>: original dims prevent layout shift. */
export function responsiveProps(
  media: Pick<MediaRecord, 'public_url' | 'width' | 'height' | 'alt_text'> & { file_name: string },
  variants: MediaVariant[] = [],
  sizes = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw',
): ResponsiveSpec & { alt: string } {
  const fallback = media.public_url ?? '/og-default.png';
  return {
    src: pickFallback(variants, fallback),
    srcSet: variants.length > 0 ? buildSrcSet(variants) : undefined,
    sizes,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
    alt: media.alt_text ?? media.file_name,
  };
}

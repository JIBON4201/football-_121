import { describe, expect, it } from 'vitest';
import { buildSrcSet, orderVariants, pickFallback, responsiveProps } from '@/lib/media';
import type { MediaVariant } from '@/types/api';

const variants: MediaVariant[] = [
  { variant: 'large', width: 1600, height: 900, mime_type: 'image/jpeg', storage_path: 'a', public_url: 'https://cdn.test/large.jpg', file_size: 1 },
  { variant: 'small', width: 400, height: 225, mime_type: 'image/jpeg', storage_path: 'b', public_url: 'https://cdn.test/small.jpg', file_size: 1 },
  { variant: 'broken', width: 200, height: 100, mime_type: 'image/jpeg', storage_path: 'c', public_url: null, file_size: 1 },
];

describe('media rendering helpers', () => {
  it('orders variants and builds width-based srcsets', () => {
    expect(orderVariants(variants).map((variant) => variant.variant)).toEqual(['broken', 'small', 'large']);
    const srcSet = buildSrcSet(variants);
    expect(srcSet).toContain('https://cdn.test/small.jpg 400w');
    expect(srcSet).not.toContain('broken');
  });

  it('falls back to medium, largest, then default image', () => {
    expect(pickFallback(variants, 'https://cdn.test/orig.jpg')).toBe('https://cdn.test/large.jpg');
    expect(pickFallback([], null)).toBe('/og-default.png');
  });

  it('preserves dimensions to avoid layout shift', () => {
    const props = responsiveProps(
      { public_url: 'https://cdn.test/orig.jpg', width: 800, height: 600, alt_text: null, file_name: 'hero.jpg' },
      variants,
    );
    expect(props.width).toBe(800);
    expect(props.height).toBe(600);
    expect(props.alt).toBe('hero.jpg');
    expect(props.sizes).toContain('100vw');
  });
});

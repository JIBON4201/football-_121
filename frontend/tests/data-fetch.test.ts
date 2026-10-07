import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBreadcrumbs, fetchSeoMetadata, getPageParams, toNextMetadata, toPaginated } from '@/lib/data-fetch';

describe('SEO bridge + data fetching (backend rules reused, never duplicated)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps backend SEO metadata onto Next metadata', () => {
    const next = toNextMetadata(
      {
        title: 'Big Win',
        description: 'A great match',
        canonical: 'https://football.example.com/news/big-win',
        robots: 'index,follow',
        ogTitle: 'Big Win',
        ogDescription: 'A great match',
        ogImage: 'https://cdn.test/hero.jpg',
        twitterTitle: 'Big Win',
        twitterDescription: 'A great match',
        twitterImage: 'https://cdn.test/hero.jpg',
      },
      'fallback',
    );
    expect(next.title).toBe('Big Win');
    expect(next.alternates?.canonical).toContain('/news/big-win');
    expect(next.robots).toBe('index,follow');
    expect(next.openGraph?.images).toHaveLength(1);
  });

  it('falls back safely when the SEO API is unreachable', () => {
    const next = toNextMetadata(null, 'Teams');
    expect(String(next.title)).toContain('Teams');
    // A fallback canonical is only emitted when the caller supplies the path;
    // without one the page must not claim to be indexable.
    expect(next.alternates).toBeUndefined();
    expect(next.robots).toBe('noindex,follow');
    const withPath = toNextMetadata(null, 'Match report', '/matches/some-slug');
    expect(withPath.alternates?.canonical).toContain('/matches/some-slug');
    expect(withPath.robots).toBe('index,follow');
  });

  it('returns null metadata instead of fabricated content on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down');
    }));
    await expect(fetchSeoMetadata('news', 'x')).resolves.toBeNull();
    await expect(fetchBreadcrumbs('news', 'x')).resolves.toEqual([]);
  });

  it('clamps pagination and defaults safely', () => {
    expect(getPageParams({ page: '2', limit: '10' })).toEqual({ page: 2, limit: 10 });
    expect(getPageParams({ page: '0', limit: 'abc' })).toEqual({ page: 1, limit: 20 });
    expect(getPageParams({ limit: '9999' }).limit).toBe(100);
  });

  it('normalizes paginated envelopes with empty-state defaults', () => {
    expect(toPaginated({ data: [1], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } }, 1, 20).rows).toEqual([1]);
    expect(toPaginated({ data: null }, 1, 20)).toEqual({
      rows: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });
});

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteConfig } from '@/config/site';
import { ArticleDetailView } from '@/components/news/ArticleDetailView';
import { ArticleList } from '@/components/news/ArticleList';
import { FilterTabs } from '@/components/news/FilterTabs';
import { Pagination, buildPageItems } from '@/components/news/Pagination';
import { RelatedArticles } from '@/components/news/RelatedArticles';
import { TransferRecords } from '@/components/news/TransferRecords';
import { metadata as breakingMetadata, revalidate as breakingRevalidate } from '@/app/(site)/breaking-news/page';
import { generateMetadata as transfersMetadataFn } from '@/app/(site)/transfers/page';
import { generateMetadata as newsMetadataFn } from '@/app/(site)/news/page';
import { generateMetadata as categoryMetadata } from '@/app/(site)/news/category/[slug]/page';
import { generateMetadata as tagMetadata } from '@/app/(site)/news/tag/[slug]/page';
import {
  BREAKING_REVALIDATE_SECONDS,
  filterCanonical,
  filterHref,
  fetchAdjacentArticles,
  fetchArticleDetail,
  fetchCategory,
  fetchNewsList,
  fetchRelatedArticles,
  fetchTag,
  fetchTransferRecords,
  NEWS_FILTERS,
  NEWS_PAGE_SIZE,
  type AdjacentArticles,
  type RelatedLink,
} from '@/lib/news';
import type { Article, PaginationMeta, Transfer } from '@/types/api';

const article = (overrides: Partial<Article> = {}): Article => ({
  id: 'article-1',
  title: 'Big Win',
  slug: 'big-win',
  excerpt: 'A great match under the lights.',
  article_type: 'news',
  published_at: '2026-09-01T10:00:00.000Z',
  is_featured: false,
  is_breaking: false,
  view_count: 10,
  ...overrides,
});

const transfer = (overrides: Partial<Transfer> = {}): Transfer => ({
  id: 'transfer-1',
  status: 'announced',
  player_id: 'player-1',
  from_team_id: 'team-1',
  to_team_id: 'team-2',
  transfer_type: 'permanent',
  announcement_date: '2026-08-01',
  effective_date: '2026-07-01',
  ...overrides,
});

const pagination = (overrides: Partial<PaginationMeta> = {}): PaginationMeta => ({
  page: 1,
  limit: NEWS_PAGE_SIZE,
  total: 24,
  totalPages: 2,
  ...overrides,
});

function mockApi(
  respond: (pathname: string, url: URL) => { status: number; body: unknown } | null,
  seen?: Array<{ url: string; init?: unknown }>,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      seen?.push({ url, init });
      const parsed = new URL(url);
      const pathname = parsed.pathname.replace(/^\/api\/v1/, '') || '/';
      const hit = respond(pathname, parsed);
      if (!hit) {
        return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND', message: 'Not found' } }) };
      }
      return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, json: async () => hit.body };
    }) as unknown as typeof fetch,
  );
}

const envelope = (data: unknown, paginationMeta?: unknown) => ({ data, pagination: paginationMeta, requestId: 'test' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('news filter URLs', () => {
  it('gives each filter a deterministic route', () => {
    expect(filterHref('latest')).toBe('/news');
    // breaking has its own canonical route so it is never duplicated
    expect(filterHref('breaking_news')).toBe('/breaking-news');
    expect(filterHref('transfer')).toBe('/news?type=transfer');
    expect(filterCanonical('breaking_news')).toBe(`${siteConfig.siteUrl}/breaking-news`);
    for (const filter of NEWS_FILTERS) {
      expect(filter.href.startsWith('/')).toBe(true);
    }
  });
});

describe('news listing data layer', () => {
  it('sends filters to the backend and returns pagination', async () => {
    const seen: Array<{ url: string; init?: unknown }> = [];
    mockApi((pathname) => (pathname === '/news' ? { status: 200, body: envelope([article()], pagination()) } : null), seen);
    const result = await fetchNewsList({ page: 2, type: 'transfer' });
    expect(result.status).toBe('ready');
    expect(result.pagination.totalPages).toBe(2);
    const url = new URL(seen[0].url);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('type')).toBe('transfer');
  });

  it('separates empty from a transport failure', async () => {
    mockApi((pathname) => (pathname === '/news' ? { status: 200, body: envelope([], pagination({ total: 0, totalPages: 0 })) } : null));
    await expect(fetchNewsList({})).resolves.toMatchObject({ status: 'empty', rows: [] });

    mockApi(() => null);
    const failed = await fetchNewsList({});
    expect(failed.status).toBe('error');
    expect(failed.rows).toEqual([]);
    expect(failed.pagination.totalPages).toBe(0);
  });

  it('filters by category and by tag', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/news') return null;
      seen.push(url.search);
      return { status: 200, body: envelope([article()], pagination()) };
    });
    await fetchNewsList({ category: 'premier-league' });
    await fetchNewsList({ tag: 'derby' });
    expect(seen[0]).toContain('category=premier-league');
    expect(seen[1]).toContain('tag=derby');
  });
});

describe('article detail data layer', () => {
  it('returns a published article and maps a 404 to not-found', async () => {
    mockApi((pathname) =>
      pathname === '/news/big-win' ? { status: 200, body: envelope(article({ content: '<p>Body</p>' })) } : null,
    );
    const ready = await fetchArticleDetail('big-win');
    expect(ready.status).toBe('ready');
    expect(ready.article?.content).toBe('<p>Body</p>');

    mockApi(() => null);
    const missing = await fetchArticleDetail('big-win');
    expect(missing.status).toBe('not-found');
    expect(missing.article).toBeNull();
  });

  it('rejects an empty payload as not-found rather than rendering a blank story', async () => {
    mockApi((pathname) => (pathname === '/news/big-win' ? { status: 200, body: envelope(null) } : null));
    await expect(fetchArticleDetail('big-win')).resolves.toMatchObject({ status: 'not-found' });
  });

  it('degrades to empty relations instead of throwing', async () => {
    mockApi(() => null);
    await expect(fetchRelatedArticles('big-win')).resolves.toEqual({ related: [], entities: [] });
  });

  it('reads related and entity links from the SEO service', async () => {
    const related: RelatedLink = { entityType: 'news', id: 'a2', slug: 'other', title: 'Other', url: '/news/other' };
    const entities: RelatedLink = { entityType: 'team', id: 't1', slug: 'fc-example', title: 'FC Example', url: '/teams/fc-example' };
    mockApi((pathname) =>
      pathname === '/seo/related' ? { status: 200, body: envelope({ related: [related], entities: [entities] }) } : null,
    );
    const result = await fetchRelatedArticles('big-win');
    expect(result.related).toHaveLength(1);
    expect(result.entities[0].url).toBe('/teams/fc-example');
  });

  it('derives previous/next navigation from one ordered window', async () => {
    mockApi((pathname) =>
      pathname === '/news'
        ? { status: 200, body: envelope([article({ id: 'a2', slug: 'newer' }), article({ id: 'a1', slug: 'older' })]) }
        : null,
    );
    const adjacent = await fetchAdjacentArticles('newer');
    expect(adjacent?.newer).toBeNull();
    expect(adjacent?.older?.slug).toBe('older');

    mockApi((pathname) => (pathname === '/news' ? { status: 200, body: envelope([article({ slug: 'big-win' })]) } : null));
    const middle = await fetchAdjacentArticles('big-win');
    expect(middle?.newer).toBeNull();
    expect(middle?.older).toBeNull();

    mockApi(() => null);
    await expect(fetchAdjacentArticles('big-win')).resolves.toBeNull();
  });
});

describe('category and tag lookup', () => {
  it('resolves an active category and rejects an unknown one', async () => {
    mockApi((pathname) =>
      pathname === '/categories/premier-league'
        ? { status: 200, body: envelope({ id: 'c1', name: 'Premier League', slug: 'premier-league', description: 'Top flight' }) }
        : null,
    );
    const found = await fetchCategory('premier-league');
    expect(found?.name).toBe('Premier League');

    mockApi(() => null);
    await expect(fetchCategory('premier-league')).resolves.toBeNull();
  });

  it('resolves a tag and rejects an unknown one', async () => {
    mockApi((pathname) =>
      pathname === '/tags/derby' ? { status: 200, body: envelope({ id: 't1', name: 'Derby', slug: 'derby' }) } : null,
    );
    await expect(fetchTag('derby')).resolves.toMatchObject({ name: 'Derby' });

    mockApi(() => null);
    await expect(fetchTag('derby')).resolves.toBeNull();
  });
});

describe('transfer records', () => {
  it('returns only official records and separates empty from error', async () => {
    mockApi((pathname) => (pathname === '/transfers' ? { status: 200, body: envelope([transfer()], pagination()) } : null));
    const ready = await fetchTransferRecords(10);
    expect(ready.status).toBe('ready');
    expect(ready.items[0].status).toBe('announced');

    mockApi((pathname) => (pathname === '/transfers' ? { status: 200, body: envelope([]) } : null));
    await expect(fetchTransferRecords()).resolves.toMatchObject({ status: 'empty' });

    mockApi(() => null);
    await expect(fetchTransferRecords()).resolves.toMatchObject({ status: 'error', items: [] });
  });
});

describe('news pagination', () => {
  it('builds a stable sliding window without duplicates or gaps', () => {
    expect(buildPageItems(1, 1)).toEqual([{ kind: 'page', page: 1 }]);
    expect(buildPageItems(1, 0)).toEqual([]);
    const middle = buildPageItems(10, 20);
    expect(middle.filter((item) => item.kind === 'page')).toHaveLength(7);
    expect(middle.some((item) => item.kind === 'ellipsis')).toBe(true);
    // out-of-range pages are clamped, never duplicated
    expect(buildPageItems(99, 3).filter((item) => item.kind === 'page')).toHaveLength(3);
  });

  it('preserves the active filter across pages and renders nothing for one page', async () => {
    const html = renderToString(
      createElement(Pagination, { page: 2, totalPages: 5, baseHref: '/news', extraQuery: { type: 'transfer' } }),
    );
    expect(html).toContain('type=transfer');
    expect(html).toContain('rel="next"');
    expect(html).toContain('rel="prev"');
    expect(html).toContain('aria-current="page"');
    expect(renderToString(createElement(Pagination, { page: 1, totalPages: 1, baseHref: '/news' }))).toBe('');
  });
});

describe('news listing components', () => {
  it('links every story canonically and paginates the list', () => {
    const html = renderToString(
      createElement(ArticleList, {
        articles: [article(), article({ id: 'a2', slug: 'second', title: 'Second' })],
        pagination: pagination(),
        baseHref: '/news',
        listLabel: 'Latest news',
      }),
    );
    expect(html).toContain('href="/news/big-win"');
    expect(html).toContain('href="/news/second"');
    expect(html).toContain('aria-label="Latest news"');
    expect(html).toContain('aria-label="Pagination"');
  });

  it('marks the active filter tab and links breaking to its own route', () => {
    const html = renderToString(createElement(FilterTabs, { active: 'breaking_news' }));
    expect(html).toContain('href="/breaking-news"');
    expect(html).toContain('aria-current="page"');
    // no filter tab may point at a filtered URL that duplicates breaking
    expect(html).not.toContain('/news?type=breaking_news');
  });
});

describe('article detail view', () => {
  const adjacent: AdjacentArticles = {
    newer: article({ id: 'a3', slug: 'newer', title: 'Newer story' }),
    older: article({ id: 'a0', slug: 'older', title: 'Older story' }),
  };

  it('renders the story with sharing, relations and navigation', () => {
    const html = renderToString(
      createElement(ArticleDetailView, {
        article: article({ content: '<p>Body copy</p>', is_breaking: true, article_type: 'breaking_news' }),
        canonicalUrl: 'https://football.test/news/big-win',
        entities: [{ entityType: 'team', id: 't1', slug: 'fc-example', title: 'FC Example', url: '/teams/fc-example' }],
        related: [{ entityType: 'news', id: 'a2', slug: 'other', title: 'Other story', url: '/news/other' }],
        adjacent,
      }),
    );
    expect(html).toContain('id="article-heading"');
    expect(html).toContain('Big Win');
    expect(html).toContain('Body copy');
    expect(html).toContain('Breaking');
    expect(html).toContain('football.test%2Fnews%2Fbig-win');
    expect(html).toContain('href="/teams/fc-example"');
    expect(html).toContain('href="/news/other"');
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    expect(html).toContain('Back to all news');
  });

  it('omits related and navigation sections when there is nothing to show', () => {
    const html = renderToString(
      createElement(ArticleDetailView, {
        article: article(),
        canonicalUrl: 'https://football.test/news/big-win',
        entities: [],
        related: [],
        adjacent: null,
      }),
    );
    expect(html).not.toContain('Related articles');
    expect(html).not.toContain('rel="prev"');
    expect(html).toContain('Back to all news');
  });

  it('drops any related link that is not an internal path', () => {
    const html = renderToString(
      createElement(RelatedArticles, {
        links: [
          { entityType: 'news', id: 'ok', slug: 'ok', title: 'Fine', url: '/news/ok' },
          { entityType: 'news', id: 'bad', slug: 'bad', title: 'Hostile', url: 'https://evil.test/x' },
        ],
      }),
    );
    expect(html).toContain('href="/news/ok"');
    expect(html).not.toContain('evil.test');
  });
});

describe('transfer records view', () => {
  it('shows official records verbatim and never promotes a rumour', () => {
    const html = renderToString(
      createElement(TransferRecords, {
        records: [transfer(), transfer({ id: 't2', status: 'completed', transfer_type: 'loan' })],
      }),
    );
    expect(html).toContain('announced');
    expect(html).toContain('completed');
    expect(html).toContain('permanent');
    expect(html).toContain('loan');
    expect(html).toContain('<caption>');
    expect(html).not.toContain('rumour');
    expect(renderToString(createElement(TransferRecords, { records: [] }))).toBe('');
  });

  it('renders an em dash for unknown dates instead of inventing one', () => {
    const html = renderToString(
      createElement(TransferRecords, { records: [transfer({ announcement_date: null, effective_date: null, transfer_type: null })] }),
    );
    expect(html).toContain('—');
  });
});

describe('news route metadata', () => {
  it('canonicalizes the news index regardless of the active filter', async () => {
    // Filter permutations are client-side refinements over one listing, so they
    // all canonicalize to the bare /news route rather than to a query string.
    const newsMetadata = await newsMetadataFn({ searchParams: {} });
    expect(newsMetadata.alternates?.canonical).toBe(`${siteConfig.siteUrl}/news`);
    expect(newsMetadata.robots).toBe('index,follow');
    expect(String(newsMetadata.title)).toContain('Latest Football News');
  });

  it('gives breaking news its own canonical route and a short cache window', () => {
    expect(breakingMetadata.alternates?.canonical).toBe(`${siteConfig.siteUrl}/breaking-news`);
    expect(breakingMetadata.robots).toBe('index,follow');
    expect(breakingRevalidate).toBe(BREAKING_REVALIDATE_SECONDS);
    expect(BREAKING_REVALIDATE_SECONDS).toBeLessThan(300);
  });

  it('canonicalizes the transfer centre', async () => {
    const transfersMetadata = await transfersMetadataFn({ searchParams: {} });
    expect(transfersMetadata.alternates?.canonical).toBe(`${siteConfig.siteUrl}/transfers`);
  });

  it('builds category metadata from the resolved record', async () => {
    mockApi((pathname) =>
      pathname === '/categories/premier-league'
        ? { status: 200, body: envelope({ id: 'c1', name: 'Premier League', slug: 'premier-league', description: 'Top flight news' }) }
        : null,
    );
    const meta = await categoryMetadata({ params: { slug: 'premier-league' }, searchParams: {} });
    expect(String(meta.title)).toContain('Premier League');
    expect(meta.alternates?.canonical).toBe(`${siteConfig.siteUrl}/news/category/premier-league`);
    expect(meta.robots).toBe('index,follow');
  });

  it('marks an unknown category and an invalid slug as not found', async () => {
    mockApi(() => null);
    await expect(categoryMetadata({ params: { slug: 'nope' }, searchParams: {} })).resolves.toMatchObject({
      robots: 'noindex,nofollow',
    });
    await expect(categoryMetadata({ params: { slug: 'bad slug' }, searchParams: {} })).resolves.toMatchObject({
      robots: 'noindex,nofollow',
    });
  });

  it('builds tag metadata and noindexes an unknown tag', async () => {
    mockApi((pathname) =>
      pathname === '/tags/derby' ? { status: 200, body: envelope({ id: 't1', name: 'Derby', slug: 'derby' }) } : null,
    );
    const meta = await tagMetadata({ params: { slug: 'derby' }, searchParams: {} });
    expect(meta.alternates?.canonical).toBe(`${siteConfig.siteUrl}/news/tag/derby`);

    mockApi(() => null);
    await expect(tagMetadata({ params: { slug: 'nope' }, searchParams: {} })).resolves.toMatchObject({
      robots: 'noindex,nofollow',
    });
  });
});

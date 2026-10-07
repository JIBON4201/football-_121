import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { articlesQueryToSearch, fetchAdminArticles, normalizeArticlesListResult, parseArticlesQuery } from '@/lib/admin/articles';

let cookieValue: string | undefined = 'token-123';

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => (name === 'cc_at' && cookieValue ? { value: cookieValue } : undefined),
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

import ArticlesPage from '@/app/control-center/(protected)/articles/page';
import { createArticleAction, deleteArticleAction, updateArticleAction } from '@/app/control-center/articles/actions';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Route fetch calls by URL substring — the page fans out to me/articles/categories. */
function stubFetchByUrl(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [key, handler] of Object.entries(routes)) {
      if (url.includes(key)) return handler(init);
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function meEnvelope(permissions: string[]) {
  return json(200, { data: { id: 'u1', email: 'admin@example.com', roles: ['admin'], permissions } });
}

const LIST_ROW = {
  id: 'a1',
  slug: 'big-win',
  title: 'Big win for the visitors',
  excerpt: 'Short excerpt',
  status: 'published',
  article_type: 'breaking_news',
  author_id: 'u1-user',
  featured_image_id: null,
  published_at: '2026-10-01',
  scheduled_at: null,
  is_breaking: true,
  is_featured: false,
  view_count: 42,
  created_at: '2026-09-30',
  updated_at: '2026-10-02',
};

function listEnvelope(rows: unknown[] = [LIST_ROW]) {
  return json(200, { data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 }, requestId: 'req-1' });
}

describe('parseArticlesQuery', () => {
  it('defaults to page 1, limit 20, no filters', () => {
    expect(parseArticlesQuery({})).toEqual({ page: 1, limit: 20, q: undefined, status: undefined, articleType: undefined, categoryId: undefined, featured: undefined, sort: undefined, order: undefined });
  });

  it('parses valid values and drops junk', () => {
    expect(
      parseArticlesQuery({ page: '3', limit: '50', q: 'derby', status: 'published', articleType: 'news', categoryId: 'c1', featured: 'true', sort: 'published_at', order: 'asc' }),
    ).toMatchObject({ page: 3, limit: 50, q: 'derby', status: 'published', articleType: 'news', categoryId: 'c1', featured: true, sort: 'published_at', order: 'asc' });
    expect(parseArticlesQuery({ page: '-5', limit: '999', sort: 'title', order: 'sideways', featured: 'yes' })).toMatchObject({
      page: 1,
      limit: 100,
      sort: undefined,
      order: undefined,
      featured: undefined,
    });
  });
});

describe('articlesQueryToSearch', () => {
  it('only serialises set values', () => {
    expect(articlesQueryToSearch({ page: 1, limit: 20 }).toString()).toBe('limit=20');
    expect(articlesQueryToSearch({ page: 2, limit: 20, q: 'derby', featured: true }).toString()).toBe('page=2&limit=20&q=derby&featured=true');
  });
});

describe('normalizeArticlesListResult', () => {
  it('maps the envelope and pagination', () => {
    const r = normalizeArticlesListResult({ data: [LIST_ROW], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].title).toBe('Big win for the visitors');
      expect(r.pagination.total).toBe(1);
    }
  });

  it('filters out malformed rows and keeps going', () => {
    const r = normalizeArticlesListResult({ data: [{}, LIST_ROW], pagination: null });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.rows).toHaveLength(1);
  });
});

describe('fetchAdminArticles', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  it('renames articleType to article_type on the wire', async () => {
    const fn = stubFetchByUrl({ '/admin/articles': () => listEnvelope() });
    await fetchAdminArticles({ page: 1, limit: 20, articleType: 'news' });
    const [input] = fn.mock.calls[0] as unknown as [RequestInfo];
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    expect(url).toContain('article_type=news');
    expect(url).not.toContain('articleType=');
  });

  it('maps 401/403/network to the right states', async () => {
    stubFetchByUrl({ '/admin/articles': () => json(401, {}) });
    await expect(fetchAdminArticles({ page: 1, limit: 20 })).resolves.toEqual({ status: 'unauthenticated' });

    stubFetchByUrl({ '/admin/articles': () => json(403, {}) });
    await expect(fetchAdminArticles({ page: 1, limit: 20 })).resolves.toEqual({ status: 'forbidden' });

    stubFetchByUrl({ '/admin/articles': () => { throw new Error('down'); } });
    await expect(fetchAdminArticles({ page: 1, limit: 20 })).resolves.toMatchObject({ status: 'error' });
  });
});

describe('Admin articles page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  it('renders the list from the real API envelope', async () => {
    stubFetchByUrl({
      '/admin/me': () => meEnvelope(['articles.read', 'articles.create', 'articles.update', 'articles.delete']),
      '/admin/articles': () => listEnvelope(),
      '/categories': () => json(200, { data: [] }),
    });
    const html = renderToString(await ArticlesPage({ searchParams: {} }));
    expect(html).toContain('Big win for the visitors');
    expect(html).toContain('published');
    expect(html).toContain('Breaking');
    expect(html).toContain('News');
    expect(html).toContain('New article');
  });

  it('hides actions the admin lacks permission for', async () => {
    stubFetchByUrl({
      '/admin/me': () => meEnvelope(['articles.read']),
      '/admin/articles': () => listEnvelope(),
      '/categories': () => json(200, { data: [] }),
    });
    const html = renderToString(await ArticlesPage({ searchParams: {} }));
    expect(html).not.toContain('New article');
    expect(html).not.toContain('Delete');
    expect(html).not.toContain('Edit');
  });

  it('shows an empty state when no rows come back', async () => {
    stubFetchByUrl({
      '/admin/me': () => meEnvelope(['articles.read']),
      '/admin/articles': () => listEnvelope([]),
      '/categories': () => json(200, { data: [] }),
    });
    const html = renderToString(await ArticlesPage({ searchParams: {} }));
    expect(html).toContain('No articles found');
  });

  it('renders access denied when the session is forbidden', async () => {
    stubFetchByUrl({
      '/admin/me': () => json(403, {}),
      '/admin/articles': () => listEnvelope(),
      '/categories': () => json(200, { data: [] }),
    });
    const html = renderToString(await ArticlesPage({ searchParams: {} }));
    expect(html).toContain('Access denied');
  });

  it('renders the error state when the API fails', async () => {
    stubFetchByUrl({
      '/admin/me': () => meEnvelope(['articles.read']),
      '/admin/articles': () => { throw new Error('down'); },
      '/categories': () => json(200, { data: [] }),
    });
    const html = renderToString(await ArticlesPage({ searchParams: {} }));
    expect(html).toContain('Articles unavailable');
  });
});

describe('createArticleAction', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  function validFormData() {
    const fd = new FormData();
    fd.set('title', 'A very long enough title');
    fd.set('articleType', 'news');
    fd.set('content', 'This is long enough content for a real article body.');
    return fd;
  }

  it('rejects an empty submission without calling the API', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['articles.create']) });
    const result = await createArticleAction({}, new FormData());
    expect(result.error).toContain('fix the highlighted fields');
    expect(result.fields?.title).toBeDefined();
    expect(result.fields?.content).toBeDefined();
  });

  it('posts the valid payload and redirects to the edit page', async () => {
    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['articles.create']),
      '/admin/articles': () => json(201, { data: { id: 'new-id-1', slug: 'x', title: 'T', status: 'draft' } }),
    });
    const result = createArticleAction({}, validFormData());
    await expect(result).rejects.toThrow('NEXT_REDIRECT');
    const postCall = fn.mock.calls.find(([input]) => typeof input === 'string' && input.includes('/admin/articles') && !input.includes('/admin/me'));
    expect(postCall).toBeTruthy();
    const [, init] = postCall as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('"title":"A very long enough title"');
  });

  it('refuses to create without the articles.create permission', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['articles.read']) });
    const result = await createArticleAction({}, validFormData());
    expect(result.error).toContain('permission');
  });
});

describe('deleteArticleAction', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  it('fails closed when there is no session', async () => {
    cookieValue = undefined;
    const result = await deleteArticleAction('a1');
    expect(result.error).toContain('session');
  });

  it('refuses without the delete permission', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['articles.read']) });
    const result = await deleteArticleAction('a1');
    expect(result.error).toContain('permission');
  });

  it('deletes via the API when permitted', async () => {
    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['articles.delete']),
      '/admin/articles/a1': () => json(200, { data: { id: 'a1', deleted: true } }),
    });
    const result = await deleteArticleAction('a1');
    expect(result.success).toBe('Article deleted.');
    const deleteCall = fn.mock.calls.find(([input]) => String(input).includes('/admin/articles/a1'));
    expect(deleteCall).toBeTruthy();
    const [, init] = deleteCall as unknown as [string, RequestInit];
    expect(init.method).toBe('DELETE');
  });
});

describe('updateArticleAction', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  it('rejects invalid input without calling the API', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['articles.update']) });
    const result = await updateArticleAction('a1', {}, new FormData());
    expect(result.error).toContain('fix the highlighted fields');
  });

  it('patches the article when input is valid', async () => {
    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['articles.update']),
      '/admin/articles/a1': () => json(200, { data: { id: 'a1', slug: 'x' } }),
    });
    const fd = new FormData();
    fd.set('title', 'Updated title long enough');
    fd.set('articleType', 'news');
    fd.set('content', 'Updated content that is long enough to pass the rule.');
    const result = await updateArticleAction('a1', {}, fd);
    expect(result.success).toBe('Changes saved.');
    const patchCall = fn.mock.calls.find(([input]) => String(input).includes('/admin/articles/a1'));
    expect(patchCall).toBeTruthy();
    const [, init] = patchCall as unknown as [string, RequestInit];
    expect(init.method).toBe('PATCH');
  });
});

describe('responsive and chrome contracts', () => {
  it('uses the 768/1024/1440 steps for the filters grid', () => {
    const css = readFileSync(new URL('../src/styles/admin.css', import.meta.url), 'utf-8');
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).toContain('@media (min-width: 1440px)');
    expect(css).toContain('.cc-filters');
  });

  it('renders no public site chrome in the articles pages', () => {
    const page = readFileSync(new URL('../src/app/control-center/(protected)/articles/page.tsx', import.meta.url), 'utf-8');
    for (const chrome of ['SiteHeader', 'SiteFooter', 'MobileBottomNav']) {
      expect(page).not.toContain(chrome);
    }
  });
});

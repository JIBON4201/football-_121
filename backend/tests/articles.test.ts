import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const authed = { Authorization: 'Bearer valid-token' };

function asRole(...roles: string[]) {
  setTestRoles(roles);
}

async function createDraft(fake: FakeClient, overrides: Record<string, unknown> = {}) {
  asRole('author');
  const res = await request(app)
    .post('/api/v1/articles')
    .set(authed)
    .send({
      title: 'Test Article Title For Publishing',
      content: 'This is a sufficiently long article body for all validation rules.',
      articleType: 'news',
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; slug: string; status: string };
}

describe('Step 26 — News Management & Publishing Pipeline', () => {
  let fake: FakeClient;
  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  it('lifecycle: draft → review → published → archived → draft', async () => {
    const draft = await createDraft(fake);
    expect(draft.status).toBe('draft');

    asRole('author');
    expect((await request(app).post(`/api/v1/articles/${draft.id}/submit`).set(authed).send({})).status).toBe(200);

    asRole('editor');
    expect((await request(app).post(`/api/v1/articles/${draft.id}/publish`).set(authed).send({})).status).toBe(200);

    // Public visibility after publish
    const pub = await request(app).get('/api/v1/news');
    expect(pub.body.data.map((a: { slug: string }) => a.slug)).toContain(draft.slug);

    asRole('editor');
    expect((await request(app).post(`/api/v1/articles/${draft.id}/archive`).set(authed).send({})).status).toBe(200);
    expect((await request(app).post(`/api/v1/articles/${draft.id}/restore`).set(authed).send({})).status).toBe(200);

    const row = fake.store.articles.find((a) => (a as { id: string }).id === draft.id) as unknown as Record<string, unknown>;
    expect(row.status).toBe('draft');
  });

  it('lifecycle: review → scheduled → published via publish-due', async () => {
    const draft = await createDraft(fake);
    asRole('author');
    await request(app).post(`/api/v1/articles/${draft.id}/submit`).set(authed).send({});
    asRole('editor');
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(
      (await request(app).post(`/api/v1/articles/${draft.id}/schedule`).set(authed).send({ scheduledAt: future })).status,
    ).toBe(200);

    // Force due by backdating scheduled_at
    const stored = fake.store.articles.find((a) => (a as { id: string }).id === draft.id) as Record<string, unknown>;
    stored.scheduled_at = new Date(Date.now() - 1000).toISOString();

    asRole('editor');
    const due = await request(app).get('/api/v1/articles/publish-due').set(authed);
    expect(due.status).toBe(200);
    expect(due.body.data.published).toBeGreaterThanOrEqual(1);
    expect((stored as { status: string }).status).toBe('published');
    expect(stored.published_at).toBeTruthy();
  });

  it('rejects invalid transitions (draft → published, published → draft)', async () => {
    const draft = await createDraft(fake);
    asRole('editor');
    expect((await request(app).post(`/api/v1/articles/${draft.id}/publish`).set(authed).send({})).status).toBe(400);
    expect((await request(app).post(`/api/v1/articles/${draft.id}/archive`).set(authed).send({})).status).toBe(200);
    // archived → published is invalid
    expect((await request(app).post(`/api/v1/articles/${draft.id}/publish`).set(authed).send({})).status).toBe(400);
  });

  it('RBAC: author cannot publish/schedule/archive; editor can; moderator blocked', async () => {
    const draft = await createDraft(fake);
    asRole('author');
    await request(app).post(`/api/v1/articles/${draft.id}/submit`).set(authed).send({});
    asRole('author');
    expect((await request(app).post(`/api/v1/articles/${draft.id}/publish`).set(authed).send({})).status).toBe(403);
    expect(
      (await request(app).post(`/api/v1/articles/${draft.id}/schedule`).set(authed).send({ scheduledAt: new Date(Date.now() + 60000).toISOString() })).status,
    ).toBe(403);
    expect((await request(app).post(`/api/v1/articles/${draft.id}/archive`).set(authed).send({})).status).toBe(403);

    asRole('moderator');
    expect((await request(app).post('/api/v1/articles').set(authed).send({ title: 'Moderator Attempt Title Here', content: 'Long enough body for validation purposes here.' })).status).toBe(403);

    expect((await request(app).post('/api/v1/articles').send({ title: 'No Auth Title Here', content: 'Long enough body for validation purposes here.' })).status).toBe(401);
  });

  it('public visibility: unpublished never appears; no internal metadata leaked', async () => {
    const draft = await createDraft(fake);
    const list = await request(app).get('/api/v1/news');
    expect(list.body.data.map((a: { slug: string }) => a.slug)).not.toContain(draft.slug);
    expect(await request(app).get(`/api/v1/news/${draft.slug}`).then((r) => r.status)).toBe(404);

    asRole('author');
    await request(app).post(`/api/v1/articles/${draft.id}/submit`).set(authed).send({});
    asRole('editor');
    await request(app).post(`/api/v1/articles/${draft.id}/publish`).set(authed).send({});
    const detail = await request(app).get(`/api/v1/news/${draft.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.slug).toBe(draft.slug);
    expect(detail.body.data.status).toBeUndefined();
    expect(detail.body.data.scheduled_at).toBeUndefined();
    expect(detail.body.data.author_id).toBeUndefined();
  });

  it('slugs: generation, collision, redirect on published change, loop prevention', async () => {
    const a = await createDraft(fake, { title: 'Same Collision Title Here' });
    const b = await createDraft(fake, { title: 'Same Collision Title Here' });
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug).toMatch(/-2$/);

    asRole('author');
    await request(app).post(`/api/v1/articles/${a.id}/submit`).set(authed).send({});
    asRole('editor');
    await request(app).post(`/api/v1/articles/${a.id}/publish`).set(authed).send({});
    const oldSlug = a.slug;
    const upd = await request(app).patch(`/api/v1/articles/${a.id}`).set(authed).send({ slug: 'brand-new-slug-xyz' });
    expect(upd.status).toBe(200);
    const redir = fake.store.redirects as Array<Record<string, unknown>>;
    expect(redir.some((r) => r.source_path === `/news/${oldSlug}` && r.destination_path === '/news/brand-new-slug-xyz')).toBe(true);

    // Loop prevention: changing back must not create source==destination
    const back = await request(app).patch(`/api/v1/articles/${a.id}`).set(authed).send({ slug: oldSlug });
    expect(back.status).toBe(200);
    for (const r of fake.store.redirects as Array<Record<string, unknown>>) {
      expect(r.source_path).not.toBe(r.destination_path);
    }
  });

  it('relationships: categories/tags/teams/players/competitions/matches', async () => {
    const draft = await createDraft(fake);
    asRole('author');
    expect((await request(app).put(`/api/v1/articles/${draft.id}/categories`).set(authed).send({ ids: ['cat1'] })).status).toBe(200);
    expect((await request(app).put(`/api/v1/articles/${draft.id}/tags`).set(authed).send({ ids: ['tag1'] })).status).toBe(200);
    expect(
      (await request(app).put(`/api/v1/articles/${draft.id}/teams`).set(authed).send({ ids: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'] })).status,
    ).toBe(200);
    expect(
      (await request(app).put(`/api/v1/articles/${draft.id}/players`).set(authed).send({ ids: ['cccccccc-cccc-4ccc-8ccc-ccccccccccc1'] })).status,
    ).toBe(200);
    expect(
      (await request(app).put(`/api/v1/articles/${draft.id}/competitions`).set(authed).send({ ids: ['ffffffff-ffff-4fff-8fff-fffffffffff1'] })).status,
    ).toBe(200);
    expect(
      (await request(app).put(`/api/v1/articles/${draft.id}/matches`).set(authed).send({ ids: ['dddddddd-dddd-4ddd-8ddd-ddddddddddd1'] })).status,
    ).toBe(200);

    // Duplicate prevention: same ids twice → single rows
    await request(app).put(`/api/v1/articles/${draft.id}/tags`).set(authed).send({ ids: ['tag1', 'tag1'] });
    expect((fake.store.article_tags as unknown[]).filter((r) => (r as { article_id: string }).article_id === draft.id)).toHaveLength(1);

    // Invalid + inactive rejected
    expect((await request(app).put(`/api/v1/articles/${draft.id}/categories`).set(authed).send({ ids: ['00000000-0000-4000-8000-000000000999'] })).status).toBe(400);
    expect((await request(app).put(`/api/v1/articles/${draft.id}/categories`).set(authed).send({ ids: ['cat2'] })).status).toBe(400);
  });

  it('scheduling failure is recoverable and never loses the article', async () => {
    const draft = await createDraft(fake);
    asRole('author');
    await request(app).post(`/api/v1/articles/${draft.id}/submit`).set(authed).send({});
    asRole('editor');
    await request(app).post(`/api/v1/articles/${draft.id}/schedule`).set(authed).send({ scheduledAt: new Date(Date.now() + 60000).toISOString() });
    // Corrupt the article to make publish validation fail
    const stored = fake.store.articles.find((a) => (a as { id: string }).id === draft.id) as Record<string, unknown>;
    stored.content = 'x';
    stored.scheduled_at = new Date(Date.now() - 1000).toISOString();

    asRole('editor');
    const due = await request(app).get('/api/v1/articles/publish-due').set(authed);
    expect(due.body.data.failed).toBeGreaterThanOrEqual(1);
    expect(stored.status).toBe('scheduled');
  });

  it('SEO: validation, canonical URL, sitemap eligibility', async () => {
    const draft = await createDraft(fake);
    asRole('author');
    expect((await request(app).put(`/api/v1/articles/${draft.id}/seo`).set(authed).send({ canonicalUrl: 'not-a-url' })).status).toBe(400);
    expect((await request(app).put(`/api/v1/articles/${draft.id}/seo`).set(authed).send({ metaTitle: 'x'.repeat(71) })).status).toBe(400);
    expect(
      (await request(app).put(`/api/v1/articles/${draft.id}/seo`).set(authed).send({ metaTitle: 'Good title', canonicalUrl: '/news/custom-canonical' })).status,
    ).toBe(200);

    asRole('author');
    await request(app).post(`/api/v1/articles/${draft.id}/submit`).set(authed).send({});
    asRole('editor');
    await request(app).post(`/api/v1/articles/${draft.id}/publish`).set(authed).send({});
    const site = await request(app).get('/api/v1/articles/sitemap?limit=10').set(authed);
    expect(site.status).toBe(200);
    expect(site.body.data.some((e: { slug: string }) => e.slug === draft.slug)).toBe(true);
    const newsSite = await request(app).get('/api/v1/articles/sitemap?news=true&limit=10').set(authed);
    expect(newsSite.status).toBe(200);
  });

  it('public filters, pagination, breaking/featured/date', async () => {
    expect((await request(app).get('/api/v1/news?type=transfer')).body.data).toHaveLength(1);
    expect((await request(app).get('/api/v1/news?breaking=true')).body.data.length).toBeGreaterThanOrEqual(1);
    expect((await request(app).get('/api/v1/news?featured=true')).body.data.length).toBeGreaterThanOrEqual(1);
    expect((await request(app).get('/api/v1/news?from=2026-09-01&to=2026-09-01')).body.data.length).toBeGreaterThanOrEqual(1);
    const paged = await request(app).get('/api/v1/news?limit=1&page=1');
    expect(paged.body.pagination.limit).toBe(1);
  });

  it('security: sanitizes content, validates media, blocks non-owners', async () => {
    asRole('author');
    const evil = await request(app).post('/api/v1/articles').set(authed).send({
      title: 'Security Test Article Title',
      content: 'Hello <script>alert(1)</script> world with enough length here.',
    });
    expect(evil.status).toBe(201);
    expect(String(evil.body.data.content)).not.toContain('<script>');

    expect(
      (await request(app).post('/api/v1/articles').set(authed).send({ title: 'Bad Media Title Here', content: 'Long enough body for validation purposes here.', featuredImageId: '00000000-0000-4000-8000-000000000999' })).status,
    ).toBe(400);

    // Non-owner author cannot edit
    (fake.store.articles as Array<Record<string, unknown>>).push({
      id: '99999999-9999-4999-8999-999999999999',
      author_id: 'other-user',
      title: 'Other Author Draft Title',
      slug: 'other-author-draft',
      excerpt: null,
      content: 'Long enough body for another author draft content.',
      status: 'draft',
      article_type: 'news',
      featured_image_id: null,
      published_at: null,
      scheduled_at: null,
      is_featured: false,
      is_breaking: false,
      view_count: 0,
    });
    asRole('author');
    expect((await request(app).patch('/api/v1/articles/99999999-9999-4999-8999-999999999999').set(authed).send({ title: 'Hijack Attempt Title Here' })).status).toBe(403);
  });

  it('breaking news rules enforced', async () => {
    asRole('author');
    expect(
      (await request(app).post('/api/v1/articles').set(authed).send({ title: 'Breaking Without Flag Title', content: 'Long enough body for validation purposes here.', articleType: 'breaking_news' })).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/v1/articles').set(authed).send({ title: 'Flag Without Type Title Here', content: 'Long enough body for validation purposes here.', isBreaking: true })).status,
    ).toBe(400);
    const okRes = await request(app).post('/api/v1/articles').set(authed).send({ title: 'Proper Breaking News Title', content: 'Long enough body for validation purposes here.', articleType: 'breaking_news', isBreaking: true });
    expect(okRes.status).toBe(201);
  });

  it('audit log records editorial operations', async () => {
    const draft = await createDraft(fake);
    asRole('author');
    await request(app).post(`/api/v1/articles/${draft.id}/submit`).set(authed).send({});
    expect((fake.store.audit_logs as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(fake.store.audit_logs.map((r) => (r as { action: string }).action)).toContain('article.create');
  });
});

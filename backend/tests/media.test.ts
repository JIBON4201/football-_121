import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { app, installTestEnv, setTestRoles, testStorage } from './helpers';
import type { FakeClient } from './fake';

const authed = { Authorization: 'Bearer valid-token' };
const asRole = (...roles: string[]) => setTestRoles(roles);
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const mediaCount = (fake: FakeClient): number => ((fake.store.media ?? []) as unknown[]).length;

// --- Minimal image builders (magic + dimension headers our codec parses) ---

function pngBuffer(width: number, height: number, pad = 0): Uint8Array {
  const out = new Uint8Array(33 + pad);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 0);
  out[16] = (width >>> 24) & 0xff; out[17] = (width >>> 16) & 0xff; out[18] = (width >>> 8) & 0xff; out[19] = width & 0xff;
  out[20] = (height >>> 24) & 0xff; out[21] = (height >>> 16) & 0xff; out[22] = (height >>> 8) & 0xff; out[23] = height & 0xff;
  out.set([8, 2, 0, 0, 0], 24);
  out.set([0xde, 0xad, 0xbe, 0xef], 29);
  return out;
}

function jpegBuffer(width: number, height: number): Uint8Array {
  const out = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff, (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0xff, 0xd9,
  ]);
  return out;
}

function webpBuffer(width: number, height: number): Uint8Array {
  const out = new Uint8Array(30);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  out.set([0x16, 0x00, 0x00, 0x00], 4);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  out.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  out.set([0x0a, 0x00, 0x00, 0x00], 16);
  out[20] = 0x10; out[21] = 0; out[22] = 0; out[23] = 0;
  const w = width - 1; const h = height - 1;
  out[24] = w & 0xff; out[25] = (w >>> 8) & 0xff; out[26] = (w >>> 16) & 0xff;
  out[27] = h & 0xff; out[28] = (h >>> 8) & 0xff; out[29] = (h >>> 16) & 0xff;
  return out;
}

function avifBuffer(): Uint8Array {
  const out = new Uint8Array(12);
  out.set([0x00, 0x00, 0x00, 0x0c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 0);
  return out;
}

async function uploadAs(role: string, fileName: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
  asRole(role);
  return request(app).post('/api/v1/media/upload').set(authed).send({
    fileName,
    mimeType: extra.mimeType ?? undefined,
    contentBase64: b64(bytes),
    ...extra,
  });
}

describe('Step 27 — Media processing & optimization', () => {
  let fake: FakeClient;
  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  it('accepts valid JPEG/PNG/WebP/AVIF uploads with variants', async () => {
    for (const [name, bytes, mime, w, h] of [
      ['photo.png', pngBuffer(800, 600), 'image/png', 800, 600],
      ['photo.jpg', jpegBuffer(100, 50), 'image/jpeg', 100, 50],
      ['photo.webp', webpBuffer(400, 300), 'image/webp', 400, 300],
      ['photo.avif', avifBuffer(), 'image/avif', null, null],
    ] as Array<[string, Uint8Array, string, number | null, number | null]>) {
      const res = await uploadAs('author', name, bytes, { mimeType: mime });
      expect(res.status).toBe(201);
      expect(res.body.data.mime_type).toBe(mime);
      expect(res.body.data.storage_path).toMatch(/^media\/article\/\d{4}\/\d{2}\//);
      expect(res.body.data.public_url).toContain(config.media.bucket);
      if (w !== null) {
        expect(res.body.data.width).toBe(w);
        expect(res.body.data.height).toBe(h);
      }
      const variants = res.body.data.variants as Array<{ variant: string; width: number; height: number; storage_path: string; public_url: string; file_size: number; mime_type: string }>;
      expect(variants.map((v) => v.variant).sort()).toEqual(['large', 'medium', 'small', 'thumbnail']);
      for (const v of variants) {
        expect(v.public_url).toBeTruthy();
        expect(v.storage_path).toContain(`/${v.variant}.`);
        expect(v.mime_type).toBe(mime);
      }
    }
  });

  it('generates variants with preserved aspect ratio and no upscaling', async () => {
    const res = await uploadAs('author', 'wide.png', pngBuffer(800, 600), { mimeType: 'image/png' });
    expect(res.status).toBe(201);
    const byName = Object.fromEntries((res.body.data.variants as Array<{ variant: string; width: number; height: number }>).map((v) => [v.variant, v]));
    expect(byName.large).toMatchObject({ width: 800, height: 600 });
    expect(byName.medium).toMatchObject({ width: 800, height: 600 });
    expect(byName.small).toMatchObject({ width: 400, height: 300 });
    expect(byName.thumbnail).toMatchObject({ width: 200, height: 150 });

    const tiny = await uploadAs('author', 'tiny.jpg', jpegBuffer(100, 50), { mimeType: 'image/jpeg' });
    const tinyBy = Object.fromEntries((tiny.body.data.variants as Array<{ variant: string; width: number; height: number }>).map((v) => [v.variant, v]));
    for (const v of Object.values(tinyBy)) expect(v.width).toBeLessThanOrEqual(100);
    expect(tinyBy.large).toMatchObject({ width: 100, height: 50 });
  });

  it('rejects invalid MIME, executables, SVG and extension mismatches', async () => {
    const png = pngBuffer(10, 10);
    // Dangerous extension blocked at filename validation.
    expect((await uploadAs('author', 'evil.exe', new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), { mimeType: 'image/jpeg' })).status).toBe(400);
    expect((await uploadAs('author', 'pic.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), { mimeType: 'image/svg+xml' })).status).toBe(400);
    expect((await uploadAs('author', 'note.txt', new TextEncoder().encode('hello world'), { mimeType: 'text/plain' })).status).toBe(415);
    // Extension does not match detected bytes.
    expect((await uploadAs('author', 'photo.png', jpegBuffer(10, 10), { mimeType: 'image/jpeg' })).status).toBe(400);
    // Claimed MIME does not match magic.
    expect((await uploadAs('author', 'photo.jpg', pngBuffer(10, 10), { mimeType: 'image/jpeg' })).status).toBe(400);
    // Double extension attack.
    expect((await uploadAs('author', 'photo.jpg.exe', png, { mimeType: 'image/png' })).status).toBe(400);
    void png;
  });

  it('rejects corrupted images without creating records', async () => {
    const before = mediaCount(fake);
    expect((await uploadAs('author', 'cut.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { mimeType: 'image/png' })).status).toBe(422);
    expect((await uploadAs('author', 'cut.jpg', new Uint8Array([0xff, 0xd8, 0xff]), { mimeType: 'image/jpeg' })).status).toBe(422);
    expect(mediaCount(fake)).toBe(before);
    expect(testStorage.objects.size).toBe(0);
  });

  it('enforces maximum file size with 413', async () => {
    config.media.maxUploadBytes = 100;
    const res = await uploadAs('author', 'big.png', pngBuffer(800, 600, 5000), { mimeType: 'image/png' });
    expect(res.status).toBe(413);
    expect(mediaCount(fake)).toBe(0);
  });

  it('enforces maximum dimensions', async () => {
    config.media.maxDimension = 100;
    expect((await uploadAs('author', 'huge.png', pngBuffer(800, 600), { mimeType: 'image/png' })).status).toBe(400);
  });

  it('sanitizes filenames and blocks path traversal', async () => {
    const traversal = await uploadAs('author', '../../etc/passwd.jpg', jpegBuffer(10, 10), { mimeType: 'image/jpeg' });
    expect(traversal.status).toBe(201);
    expect(traversal.body.data.file_name).not.toContain('/');
    expect(traversal.body.data.file_name).not.toContain('..');
    expect(traversal.body.data.storage_path).toMatch(/^media\//);
    expect(traversal.body.data.storage_path).not.toContain('..');

    const spaced = await uploadAs('author', 'My Photo (1).PNG', pngBuffer(10, 10), { mimeType: 'image/png' });
    expect(spaced.status).toBe(201);
    expect(spaced.body.data.file_name).toBe('my-photo-1.png');
  });

  it('cleans up storage and DB rows when a variant upload fails', async () => {
    const before = mediaCount(fake);
    testStorage.failOnUpload = (path) => path.includes('/small.');
    const res = await uploadAs('author', 'photo.png', pngBuffer(800, 600), { mimeType: 'image/png' });
    expect(res.status).toBe(503);
    expect(mediaCount(fake)).toBe(before);
    expect(testStorage.objects.size).toBe(0);
  });

  it('cleans up everything when all uploads fail', async () => {
    testStorage.failAllUploads = true;
    expect((await uploadAs('author', 'photo.png', pngBuffer(10, 10), { mimeType: 'image/png' })).status).toBe(503);
    expect(mediaCount(fake)).toBe(0);
    expect(testStorage.objects.size).toBe(0);
  });

  it('protects referenced media from deletion, allows unreferenced delete', async () => {
    const up = await uploadAs('author', 'hero.png', pngBuffer(400, 300), { mimeType: 'image/png' });
    const id = up.body.data.id as string;
    const paths = testStorage.objects.size;

    // Reference from an article featured image.
    (fake.store.articles as Array<Record<string, unknown>>).push({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
      author_id: 'user-1',
      title: 'Ref Article Title Here',
      slug: 'ref-article',
      excerpt: null,
      content: 'Long enough body for the referencing article content.',
      status: 'draft',
      article_type: 'news',
      featured_image_id: id,
      published_at: null,
      scheduled_at: null,
      is_featured: false,
      is_breaking: false,
      view_count: 0,
    });
    asRole('author');
    expect((await request(app).delete(`/api/v1/media/${id}`).set(authed)).status).toBe(409);
    expect(testStorage.objects.size).toBe(paths);

    // Remove reference → delete succeeds and cleans storage + variants.
    (fake.store.articles as Array<Record<string, unknown>>).forEach((a) => {
      if (a.featured_image_id === id) a.featured_image_id = null;
    });
    asRole('author');
    const del = await request(app).delete(`/api/v1/media/${id}`).set(authed);
    expect(del.status).toBe(200);
    expect(del.body.data.cleanedPaths).toBeGreaterThanOrEqual(5);
    expect(testStorage.objects.size).toBe(0);
    expect((fake.store.media as Array<{ id: string }>).some((m) => m.id === id)).toBe(false);
  });

  it('enforces authorization on all management operations', async () => {
    const png = pngBuffer(10, 10);
    expect((await request(app).post('/api/v1/media/upload').send({ fileName: 'a.png', contentBase64: b64(png) })).status).toBe(401);
    asRole('user');
    expect((await request(app).post('/api/v1/media/upload').set(authed).send({ fileName: 'a.png', contentBase64: b64(png) })).status).toBe(403);
    asRole('moderator');
    expect((await request(app).post('/api/v1/media/upload').set(authed).send({ fileName: 'a.png', contentBase64: b64(png) })).status).toBe(403);

    const up = await uploadAs('author', 'mine.png', png, { mimeType: 'image/png' });
    const id = up.body.data.id as string;
    // Private media hidden from anonymous.
    expect((await request(app).get(`/api/v1/media/${id}`)).status).toBe(401);
    // Owner can read/update.
    asRole('author');
    expect((await request(app).get(`/api/v1/media/${id}`).set(authed)).status).toBe(200);
    expect((await request(app).patch(`/api/v1/media/${id}`).set(authed).send({ altText: 'A player' })).status).toBe(200);
    // Non-owner author blocked (seed an other-owned row).
    (fake.store.media as Array<Record<string, unknown>>).push({
      id: '99999999-9999-4999-8999-999999999991',
      storage_path: 'media/article/2026/10/99999999-9999-4999-8999-999999999991/original.png',
      public_url: 'https://cdn.test/media/original.png',
      file_name: 'other.png',
      mime_type: 'image/png',
      width: 10, height: 10, file_size: 100,
      alt_text: null, caption: null, credit: null,
      uploaded_by: 'other-user',
      idempotency_key: null,
    });
    asRole('author');
    expect((await request(app).patch('/api/v1/media/99999999-9999-4999-8999-999999999991').set(authed).send({ altText: 'x' })).status).toBe(403);
    // Editor can update any.
    asRole('editor');
    expect((await request(app).patch('/api/v1/media/99999999-9999-4999-8999-999999999991').set(authed).send({ altText: 'y' })).status).toBe(200);
    // Orphans require editor.
    asRole('author');
    expect((await request(app).get('/api/v1/media/orphans/list').set(authed)).status).toBe(403);
    asRole('editor');
    expect((await request(app).get('/api/v1/media/orphans/list').set(authed)).status).toBe(200);
  });

  it('exposes published-referenced media publicly', async () => {
    const up = await uploadAs('author', 'public.png', pngBuffer(10, 10), { mimeType: 'image/png' });
    const id = up.body.data.id as string;
    (fake.store.articles as Array<Record<string, unknown>>).push({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
      author_id: 'user-1',
      title: 'Published Ref Title Here',
      slug: 'published-ref',
      excerpt: null,
      content: 'Long enough body for the published referencing article.',
      status: 'published',
      article_type: 'news',
      featured_image_id: id,
      published_at: '2026-09-01T10:00:00.000Z',
      scheduled_at: null,
      is_featured: false,
      is_breaking: false,
      view_count: 0,
    });
    expect((await request(app).get(`/api/v1/media/${id}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/media/${id}/variants`)).status).toBe(200);
  });

  it('rate-limits uploads with Retry-After', async () => {
    config.media.uploadRateLimitPerMin = 2;
    const png = pngBuffer(10, 10);
    asRole('author');
    expect((await request(app).post('/api/v1/media/upload').set(authed).send({ fileName: 'a.png', mimeType: 'image/png', contentBase64: b64(png) })).status).toBe(201);
    expect((await request(app).post('/api/v1/media/upload').set(authed).send({ fileName: 'b.png', mimeType: 'image/png', contentBase64: b64(png) })).status).toBe(201);
    const limited = await request(app).post('/api/v1/media/upload').set(authed).send({ fileName: 'c.png', mimeType: 'image/png', contentBase64: b64(png) });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('is idempotent on idempotencyKey replay', async () => {
    asRole('author');
    const payload = { fileName: 'idem.png', mimeType: 'image/png', contentBase64: b64(pngBuffer(10, 10)), idempotencyKey: 'key-123' };
    const first = await request(app).post('/api/v1/media/upload').set(authed).send(payload);
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/v1/media/upload').set(authed).send(payload);
    expect(second.status).toBe(200);
    expect(second.body.data.deduped).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(mediaCount(fake)).toBe(1);
  });

  it('article featured-image flow still works end to end', async () => {
    const up = await uploadAs('author', 'hero.jpg', jpegBuffer(800, 600), { mimeType: 'image/jpeg' });
    expect(up.status).toBe(201);
    asRole('author');
    const art = await request(app).post('/api/v1/articles').set(authed).send({
      title: 'Article With Real Featured Image Here',
      content: 'Long enough body for the article with featured image content.',
      featuredImageId: up.body.data.id,
    });
    expect(art.status).toBe(201);
  });
});

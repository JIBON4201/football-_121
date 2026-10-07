import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };
const BASE = '/api/v1/admin/media';

const GRANTS = ['media.read', 'media.manage'];

function seedAdmin(fake: FakeClient, keys: string[] = GRANTS) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.map((key) => ({ role_id: 2, permission_id: ids.get(key) }));
  fake.store.audit_logs = [];
  fake.store.media = [];
  fake.store.media_variants = [];
  setTestRoles(['admin']);
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

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
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff, (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xff, 0xd9,
  ]);
}

async function upload(fileName: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
  return request(app).post(BASE).set(AUTHED).send({ fileName, contentBase64: b64(bytes), ...extra });
}

function audits(fake: FakeClient, action: string) {
  return (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === action);
}

describe('step 11: admin media management', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedAdmin(fake);
  });

  it('list + pagination (empty, then after uploads)', async () => {
    const empty = await request(app).get(BASE).set(AUTHED);
    expect(empty.status).toBe(200);
    expect(empty.body.pagination.total).toBe(0);

    await upload('alpha.png', pngBuffer(10, 10), { mimeType: 'image/png' });
    await upload('beta.jpg', jpegBuffer(10, 10), { mimeType: 'image/jpeg' });
    const page = await request(app).get(`${BASE}?limit=1`).set(AUTHED);
    expect(page.body.pagination).toMatchObject({ page: 1, limit: 1, total: 2 });
  });

  it('search/mime/sort filters + invalid mime param shape', async () => {
    await upload('alpha.png', pngBuffer(10, 10), { mimeType: 'image/png' });
    await upload('beta.jpg', jpegBuffer(10, 10), { mimeType: 'image/jpeg' });
    expect((await request(app).get(`${BASE}?q=alpha`).set(AUTHED)).body.pagination.total).toBe(1);
    expect((await request(app).get(`${BASE}?mimeType=image/png`).set(AUTHED)).body.pagination.total).toBe(1);
    expect((await request(app).get(`${BASE}?sort=file_size&order=asc`).set(AUTHED)).status).toBe(200);
  });

  it('single media with variants + 400/404', async () => {
    const created = await upload('one.png', pngBuffer(10, 10), { mimeType: 'image/png' });
    const id = created.body.data.media.id as string;
    const res = await request(app).get(`${BASE}/${id}`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.variants)).toBe(true);
    expect(res.body.data).toHaveProperty('referencedByArticles');
    expect((await request(app).get(`${BASE}/not-a-uuid`).set(AUTHED)).status).toBe(400);
    expect((await request(app).get(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(404);
  });

  it('upload authorization: 401 unauth, 403 without manage', async () => {
    expect((await request(app).post(BASE).send({})).status).toBe(401);
    seedAdmin(fake, ['media.read']);
    expect((await upload('x.png', pngBuffer(10, 10))).status).toBe(403);
  });

  it('invalid file type -> 415, nothing stored', async () => {
    const before = (fake.store.media as unknown[]).length;
    const res = await upload('notes.txt', new TextEncoder().encode('just some text, not an image'));
    expect(res.status).toBe(415);
    expect((fake.store.media as unknown[]).length).toBe(before);
  });

  it('oversized file -> 413', async () => {
    config.media.maxUploadBytes = 10;
    const res = await upload('big.png', pngBuffer(100, 100), { mimeType: 'image/png' });
    expect(res.status).toBe(413);
  });

  it('metadata update + audit', async () => {
    const created = await upload('edit.png', pngBuffer(10, 10), { mimeType: 'image/png' });
    const id = created.body.data.media.id as string;
    const res = await request(app).patch(`${BASE}/${id}`).set(AUTHED).send({ altText: 'A player portrait', caption: null });
    expect(res.status).toBe(200);
    expect(audits(fake, 'media.update.admin')).toBe(true);
    expect((await request(app).patch(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED).send({ altText: 'x' })).status).toBe(404);
  });

  it('referenced media cannot be deleted (409); bare media deletes with storage cleanup', async () => {
    const created = await upload('ref.png', pngBuffer(10, 10), { mimeType: 'image/png' });
    const id = created.body.data.media.id as string;
    (fake.store.articles as Array<Record<string, unknown>>)[0].featured_image_id = id;
    expect((await request(app).delete(`${BASE}/${id}`).set(AUTHED)).status).toBe(409);

    (fake.store.articles as Array<Record<string, unknown>>)[0].featured_image_id = null;
    const del = await request(app).delete(`${BASE}/${id}`).set(AUTHED);
    expect(del.status).toBe(200);
    expect((fake.store.media as Array<Record<string, unknown>>).some((m) => m.id === id)).toBe(false);
    expect(audits(fake, 'media.delete.admin')).toBe(true);
    expect((await request(app).delete(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(404);
  });

  it('permission enforcement per operation', async () => {
    seedAdmin(fake, ['media.read']);
    expect((await upload('x.png', pngBuffer(10, 10))).status).toBe(403);
    const created = await upload('y.png', pngBuffer(10, 10));
    expect(created.status).toBe(403);
    expect((await request(app).get(BASE).set(AUTHED)).status).toBe(200);
  });

  it('audit trail has no secrets', async () => {
    const created = await upload('audit.png', pngBuffer(10, 10), { mimeType: 'image/png' });
    const id = created.body.data.media.id as string;
    await request(app).patch(`${BASE}/${id}`).set(AUTHED).send({ altText: 'alt' });
    expect(audits(fake, 'media.upload.admin')).toBe(true);
    const dump = JSON.stringify(fake.store.audit_logs);
    expect(dump).not.toMatch(/service_role|sb_secret|BEGIN PRIVATE/i);
  });
});

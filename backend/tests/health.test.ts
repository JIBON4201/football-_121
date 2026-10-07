import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';

describe('health', () => {
  let ctx: ReturnType<typeof installTestEnv>;

  beforeEach(() => {
    ctx = installTestEnv();
  });

  it('GET /api/v1/health returns ok envelope with request id', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.version).toBe('1.0.0');
    expect(res.body.requestId).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('GET /api/v1/health/database returns ok when reachable', async () => {
    const res = await request(app).get('/api/v1/health/database');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('GET /api/v1/health/database degrades without leaking internals', async () => {
    ctx.fake.failTables.add('countries');
    const res = await request(app).get('/api/v1/health/database');
    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('degraded');
    expect(JSON.stringify(res.body)).not.toContain('fake');
  });

  it('GET /api/v1/docs.json serves the OpenAPI document', async () => {
    const res = await request(app).get('/api/v1/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.data.openapi).toBe('3.0.3');
    expect(res.body.data.paths['/news']).toBeDefined();
  });

  it('unknown routes return 404 with stable envelope', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.requestId).toBeDefined();
  });
});

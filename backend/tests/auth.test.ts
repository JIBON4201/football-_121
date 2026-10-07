import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { requireAdmin, requireEditor, requireStaff } from '../src/middleware/requireRole';
import { app, installTestEnv, setTestRoles } from './helpers';

function runMiddleware(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  user?: { id: string },
): Promise<unknown> {
  return new Promise((resolve) => {
    const req = { user } as Request;
    const res = {} as Response;
    middleware(req, res, (err?: unknown) => resolve(err));
  });
}

describe('authentication and RBAC', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('GET /me requires a token', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /me rejects invalid tokens', async () => {
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer bogus');
    expect(res.status).toBe(401);
  });

  it('GET /me returns identity and roles without caching', async () => {
    setTestRoles(['author']);
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'user-1', roles: ['author'] });
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('requireStaff allows staff, blocks plain users and anonymous', async () => {
    setTestRoles(['author']);
    expect(await runMiddleware(requireStaff(), { id: 'u' })).toBeUndefined();
    setTestRoles(['user']);
    const err = await runMiddleware(requireStaff(), { id: 'u' });
    expect((err as Error & { status?: number }).status).toBe(403);
    const anon = await runMiddleware(requireStaff());
    expect((anon as Error & { status?: number }).status).toBe(401);
  });

  it('requireEditor and requireAdmin enforce tiers', async () => {
    setTestRoles(['author']);
    expect(((await runMiddleware(requireEditor(), { id: 'u' })) as Error & { status?: number }).status).toBe(403);

    setTestRoles(['editor']);
    expect(await runMiddleware(requireEditor(), { id: 'u' })).toBeUndefined();
    expect(((await runMiddleware(requireAdmin(), { id: 'u' })) as Error & { status?: number }).status).toBe(403);

    setTestRoles(['super_admin']);
    expect(await runMiddleware(requireAdmin(), { id: 'u' })).toBeUndefined();
  });
});

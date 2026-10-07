import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { errorHandler } from '../src/middleware/errorHandler';
import { app, installTestEnv } from './helpers';

describe('API security', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('blocks non-allowlisted origins via CORS', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows configured origins and skips server-to-server calls', async () => {
    config.corsOrigins = ['https://app.example.com'];
    const allowed = await request(app).get('/api/v1/health').set('Origin', 'https://app.example.com');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');

    const noOrigin = await request(app).get('/api/v1/health');
    expect(noOrigin.status).toBe(200);
  });

  it('rate-limits abusive clients with Retry-After', async () => {
    config.rateLimit.publicMax = 2;
    await request(app).get('/api/v1/health');
    await request(app).get('/api/v1/health');
    const limited = await request(app).get('/api/v1/health');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('never leaks internals on unexpected errors', async () => {
    const res = { locals: {}, statusCode: 0 } as unknown as Response & {
      status(code: number): Response;
      json(body: unknown): void;
      captured?: unknown;
    };
    res.status = (code: number) => {
      res.statusCode = code;
      return res as unknown as Response;
    };
    res.json = (body: unknown) => {
      res.captured = body;
    };
    await Promise.resolve(
      errorHandler(
        new Error('db password=hunter2 at 10.0.0.5:5432'),
        {} as Request,
        res as unknown as Response,
        (() => undefined) as NextFunction,
      ),
    );
    expect(res.statusCode).toBe(500);
    const body = res.captured as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
  });
});

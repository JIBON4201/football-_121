/**
 * Production domain build guard.
 *
 * The canonical tags, robots.txt Host/Sitemap directives and every sitemap
 * `<loc>` derive from one configured origin. This guard is the only thing
 * standing between a misconfigured origin and a production site that tells
 * Google its identity is a host it does not serve.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type NextConfigFactory = (phase: string) => unknown;

const BUILD = 'phase-production-build';
const START = 'phase-production-server';

/** Import next.config.mjs fresh so it re-reads the stubbed environment. */
async function run(phase: string): Promise<void> {
  vi.resetModules();
  const mod = (await import('../next.config.mjs')) as unknown as { default: NextConfigFactory };
  mod.default(phase);
}

describe('next.config production domain guard', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('builds cleanly when the configured origin is the production domain', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://omincalc.xyz');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'omincalc.xyz');
    await expect(run(BUILD)).resolves.toBeUndefined();
    await expect(run(START)).resolves.toBeUndefined();
  });

  it('fails the build when the origin is pinned to a different host than production', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://football-121.vercel.app');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'omincalc.xyz');

    // Unlike the shape checks, this one fails the build too: it is a well-formed
    // https origin, so nothing else catches it, and shipping it hands Google the
    // wrong canonical host for the entire site.
    await expect(run(BUILD)).rejects.toThrow(/not the production domain/);
    await expect(run(START)).rejects.toThrow(/not the production domain/);
  });

  it('names the offending host and the expected one so the fix is obvious', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://football-121.vercel.app');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'omincalc.xyz');

    await expect(run(BUILD)).rejects.toThrow(/football-121\.vercel\.app/);
    await expect(run(BUILD)).rejects.toThrow(/omincalc\.xyz/);
  });

  it('ignores scheme and trailing-slash differences when comparing hosts', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://omincalc.xyz');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'omincalc.xyz');
    await expect(run(BUILD)).resolves.toBeUndefined();
  });

  it('stays silent when the platform reports no production host', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://football-121.vercel.app');
    await expect(run(BUILD)).resolves.toBeUndefined();
  });

  it('still refuses to boot a missing or non-https production origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    // A missing origin only warns at build, but must never reach a running server.
    await expect(run(BUILD)).resolves.toBeUndefined();
    await expect(run(START)).rejects.toThrow(/NEXT_PUBLIC_SITE_URL is required/);

    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://omincalc.xyz');
    await expect(run(START)).rejects.toThrow(/must use https:\/\//);

    // Shape checks are ordered: an http localhost is reported as the https
    // problem, so use https to reach the local-address branch specifically.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://localhost:3000');
    await expect(run(START)).rejects.toThrow(/local address/);
  });

  it('never checks the origin outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'omincalc.xyz');
    await expect(run(BUILD)).resolves.toBeUndefined();
  });
});
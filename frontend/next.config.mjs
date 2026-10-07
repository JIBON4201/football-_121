/** @type {import('next').NextConfig} */
/* global process, console */
const isProd = process.env.NODE_ENV === 'production';

/**
 * Step 42 — production domain guard.
 *
 * The canonical URLs, robots.txt host directive and every sitemap URL all derive
 * from `NEXT_PUBLIC_SITE_URL`. If that is missing or plain HTTP in production,
 * Google is handed `http://localhost:3000/...` as the canonical identity of the
 * site — a defect that is invisible until after indexing.
 *
 * `next build` only warns (so a local build still works); `next start` refuses
 * to boot. This mirrors the backend's `assertEnvIsSane()`.
 */
function assertProductionDomain(phase) {
  if (!isProd) return;

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim();
  const problems = [];

  if (!siteUrl) {
    problems.push('NEXT_PUBLIC_SITE_URL is required in production');
  } else if (!siteUrl.startsWith('https://')) {
    problems.push(`NEXT_PUBLIC_SITE_URL must use https:// in production (got "${siteUrl}")`);
  } else if (/\/$/.test(siteUrl)) {
    problems.push('NEXT_PUBLIC_SITE_URL must not have a trailing slash');
  } else if (/localhost|127\.0\.0\.1|\.local\b/i.test(siteUrl)) {
    problems.push(`NEXT_PUBLIC_SITE_URL must not be a local address in production (got "${siteUrl}")`);
  }

  if (problems.length === 0) return;

  const detail = problems.map((problem) => `  - ${problem}`).join('\n');
  if (phase === 'phase-production-server') {
    throw new Error(`Refusing to start with an unsafe production domain configuration:\n${detail}`);
  }
  console.warn(`[next.config] WARNING: production domain is not configured correctly:\n${detail}`);
}

/**
 * Step 41 — production security headers.
 *
 * HSTS is emitted only in production: sending it over plain HTTP in local
 * development would pin developers' browsers to https://localhost and break
 * the dev loop. The host must genuinely be HTTPS-only for this to be safe.
 */

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  ...(isProd
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
  // Content-Security-Policy is emitted by `src/middleware.ts` with a per-request
  // nonce. A static `script-src 'self'` blocks Next's inline flight-payload and
  // hydration scripts, which permanently freezes the app on its loading
  // skeleton in the browser.
];

export default function nextConfig(phase) {
  assertProductionDomain(phase);

  return {
    reactStrictMode: true,
    poweredByHeader: false,
    trailingSlash: false,
    experimental: {
      // The API route bridges to the Express app living one directory up
      // (../backend/src). Next only transpiles files inside the project root
      // unless this is set; without it the import below fails to resolve.
      externalDir: true,
    },
    async headers() {
      return [
        {
          source: '/:path*',
          headers: securityHeaders,
        },
        {
          // Fingerprinted build output is immutable: cache it hard so returning
          // visitors never refetch assets.
          source: '/_next/static/:path*',
          headers: [
            { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          ],
        },
      ];
    },
  };
}

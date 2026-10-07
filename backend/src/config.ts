function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function csv(name: string, fallback: string): string[] {
  const raw = process.env[name] ?? fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function bool(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export const config = {
  port: num('PORT', 4000),
  isProd: process.env.NODE_ENV === 'production',
  apiVersion: 'v1',
  serviceName: 'football-api',
  trustProxyHops: num('TRUST_PROXY_HOPS', 0),

  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  // Service-role key is server-side only. Never send it to clients.
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',

  corsOrigins: csv('CORS_ORIGINS', 'http://localhost:3000'),

  // DEV ONLY. Grants an unauthenticated super_admin identity to every
  // /api/v1/admin/* request so the Admin UI can be reviewed without seeded
  // credentials. `isProd` is re-checked at the point of use and the boot guard
  // rejects it in production - see admin/bypass.ts and lib/envRules.ts.
  adminBypassAuth: bool('ADMIN_BYPASS_AUTH', false),

  pagination: {
    defaultLimit: num('PAGINATION_DEFAULT_LIMIT', 20),
    maxLimit: num('PAGINATION_MAX_LIMIT', 100),
  },

  rateLimit: {
    windowMs: 60_000,
    publicMax: num('RATE_LIMIT_PUBLIC_MAX', 120),
    authedMax: num('RATE_LIMIT_AUTHED_MAX', 600),
  },

  cache: {
    staticTtl: num('CACHE_TTL_STATIC', 300),
    newsTtl: num('CACHE_TTL_NEWS', 60),
    matchesTtl: num('CACHE_TTL_MATCHES', 30),
  },

  media: {
    bucket: process.env.MEDIA_BUCKET ?? 'media',
    cdnBaseUrl: process.env.MEDIA_CDN_BASE_URL ?? '',
    maxUploadBytes: num('MEDIA_MAX_UPLOAD_BYTES', 5_000_000),
    allowedMimeTypes: csv('MEDIA_ALLOWED_MIME', 'image/jpeg,image/png,image/webp,image/avif'),
    allowAvif: bool('MEDIA_ALLOW_AVIF', true),
    maxDimension: num('MEDIA_MAX_DIMENSION', 8000),
    quality: num('MEDIA_IMAGE_QUALITY', 80),
    processingTimeoutMs: num('MEDIA_PROCESSING_TIMEOUT_MS', 30_000),
    uploadRateLimitPerMin: num('MEDIA_UPLOAD_RATE_LIMIT', 30),
    cacheMaxAge: num('MEDIA_CACHE_MAX_AGE', 31_536_000),
    variants: [
      { name: 'original', maxWidth: 0 },
      { name: 'large', maxWidth: 1600 },
      { name: 'medium', maxWidth: 800 },
      { name: 'small', maxWidth: 400 },
      { name: 'thumbnail', maxWidth: 200 },
    ],
  },

  site: {
    baseUrl: (process.env.SITE_BASE_URL ?? 'https://football.example.com').replace(/\/$/, ''),
    name: process.env.SITE_NAME ?? 'Football',
    defaultDescription: process.env.SEO_DEFAULT_DESCRIPTION ?? 'Football news, fixtures, results, teams, players and competitions.',
    defaultImage: process.env.SEO_DEFAULT_IMAGE ?? '/og-default.png',
    language: process.env.SITE_LANGUAGE ?? 'en',
    twitterSite: process.env.SEO_TWITTER_SITE ?? '',
  },

  seo: {
    sitemapMaxUrls: num('SEO_SITEMAP_MAX_URLS', 5000),
    newsWindowHours: num('SEO_NEWS_WINDOW_HOURS', 48),
    cacheTtl: num('SEO_CACHE_TTL', 3600),
  },
};

export type AppConfig = typeof config;

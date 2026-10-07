import { proxyBackendSitemap } from '@/lib/sitemap-proxy';

/**
 * `/sitemap.xml` — the sitemap index on the public origin.
 *
 * Re-exposes the backend's generated index so the sitemap files sit on the same
 * host as the canonical URLs they list.
 */
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  return proxyBackendSitemap('/sitemap.xml');
}
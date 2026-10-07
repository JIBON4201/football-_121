import { config } from '../config';

/** Paths crawlers must never index: private, editorial, internal APIs. */
const DISALLOWED_PATHS = [
  '/api/v1/me',
  '/api/v1/articles',
  '/api/v1/media/upload',
  '/api/v1/media/orphans',
  '/api/v1/search',
];

export function robotsTxt(): string {
  const lines = ['User-agent: *'];
  for (const path of DISALLOWED_PATHS) lines.push(`Disallow: ${path}`);
  lines.push('');
  // Advertise the public-origin sitemap index. Crawlers fetch
  // `<site>/robots.txt`, so the referenced sitemap must resolve on the site
  // being indexed rather than on the API origin.
  lines.push(`Sitemap: ${config.site.baseUrl}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

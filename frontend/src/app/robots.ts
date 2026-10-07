import type { MetadataRoute } from 'next';
import { siteConfig } from '@/config/site';

/**
 * `/robots.txt` for the public site.
 *
 * Deliberately permissive: every football surface (news, articles, matches,
 * competitions, teams, players, transfers) must be crawlable.
 *
 * `/search` is intentionally NOT disallowed here. It is already served with a
 * `noindex,follow` directive, and blocking it in robots.txt would stop Google
 * from ever seeing that directive — turning an ignored URL into a permanently
 * blocked one.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Authenticated-only + internal surfaces. Never block CSS/JS/images:
        // Googlebot needs them to render public pages.
        disallow: ['/control-center', '/api/'],
      },
    ],
    sitemap: `${siteConfig.siteUrl}/sitemap.xml`,
    host: siteConfig.siteUrl,
  };
}
/**
 * Centralized public site configuration.
 * Only NEXT_PUBLIC_* / non-secret values may live here — nothing in this
 * module is allowed to contain server-only secrets (enforced by tests).
 */

function publicEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export const siteConfig = {
  name: publicEnv('NEXT_PUBLIC_SITE_NAME', 'Football'),
  /** Canonical public origin, no trailing slash. */
  siteUrl: publicEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  description: 'Football news, fixtures, results, teams, players and competitions.',
  defaultImage: '/og-default.png',
  locale: 'en',
  /** Server-side API base (falls back to the public one for the browser). */
  apiUrl: (process.env.API_URL ?? publicEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000')).replace(/\/$/, ''),
  apiVersion: 'v1',
} as const;

export type SiteConfig = typeof siteConfig;

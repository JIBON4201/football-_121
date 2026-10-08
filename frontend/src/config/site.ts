/**
 * Centralized public site configuration.
 * Only NEXT_PUBLIC_* / non-secret values may live here — nothing in this
 * module is allowed to contain server-only secrets (enforced by tests).
 */

function publicEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

const siteUrl = publicEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000').replace(/\/$/, '');

/**
 * API base for server-side calls (server components, route handlers, server
 * actions). The API is served by this same deployment, so in production the
 * public site origin is the correct default when no explicit base is set -
 * only local development falls back to the standalone backend on :4000.
 */
function apiBase(): string {
  // `||` (not `??`): an empty Vercel variable must fall through, not resolve to ''.
  const configured = (process.env.API_URL || publicEnv('NEXT_PUBLIC_API_URL', '')).replace(/\/$/, '');
  if (configured) return configured;
  return process.env.NODE_ENV === 'production' ? siteUrl : 'http://localhost:4000';
}

export const siteConfig = {
  name: publicEnv('NEXT_PUBLIC_SITE_NAME', 'omincalc'),
  /** Canonical public origin, no trailing slash. */
  siteUrl,
  description: 'Football news, fixtures, results, teams, players and competitions.',
  defaultImage: '/og-default.png',
  locale: 'en',
  /** Server-side API base (same origin as the site in production). */
  apiUrl: apiBase(),
  apiVersion: 'v1',
} as const;

export type SiteConfig = typeof siteConfig;

import type { AdminIconName } from '@/components/admin/ui/AdminIcon';

/**
 * Admin Panel navigation table.
 *
 * Display-only: every entry names the backend permission that unlocks it, but
 * hiding an item is never authorization — the Admin API re-checks each request
 * server-side. Kept separate from the public route table on purpose.
 *
 * `href` values are the ONLY routes the panel has. Groups below are purely a
 * presentational grouping of those existing routes — no entry invents a path
 * that is not implemented.
 */

export interface AdminNavItem {
  /** Stable key for tests and active-state matching. */
  key: string;
  label: string;
  /** Control-center-relative path. */
  href: string;
  /** Backend permission required to see (and use) this section. */
  permission: string;
  icon: AdminIconName;
  /** Which sidebar section this item sits under. */
  group: AdminNavGroup;
}

export type AdminNavGroup = 'overview' | 'content' | 'football' | 'system';

export const ADMIN_NAV_GROUP_LABELS: Record<AdminNavGroup, string> = {
  overview: 'Overview',
  content: 'Content',
  football: 'Football data',
  system: 'System',
};

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = ['overview', 'content', 'football', 'system'];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/control-center/dashboard', permission: 'dashboard.read', icon: 'dashboard', group: 'overview' },
  { key: 'articles', label: 'News', href: '/control-center/articles', permission: 'articles.read', icon: 'news', group: 'content' },
  { key: 'media', label: 'Media', href: '/control-center/media', permission: 'media.read', icon: 'media', group: 'content' },
  { key: 'matches', label: 'Matches', href: '/control-center/matches', permission: 'matches.read', icon: 'matches', group: 'football' },
  { key: 'teams', label: 'Teams', href: '/control-center/teams', permission: 'teams.read', icon: 'teams', group: 'football' },
  { key: 'players', label: 'Players', href: '/control-center/players', permission: 'players.read', icon: 'players', group: 'football' },
  { key: 'competitions', label: 'Competitions', href: '/control-center/competitions', permission: 'competitions.read', icon: 'competitions', group: 'football' },
  { key: 'seasons', label: 'Seasons', href: '/control-center/seasons', permission: 'seasons.read', icon: 'competitions', group: 'football' },
  { key: 'venues', label: 'Venues', href: '/control-center/venues', permission: 'venues.read', icon: 'teams', group: 'football' },
  { key: 'transfers', label: 'Transfers', href: '/control-center/transfers', permission: 'transfers.read', icon: 'transfers', group: 'football' },
  { key: 'settings', label: 'Settings', href: '/control-center/settings', permission: 'settings.read', icon: 'settings', group: 'system' },
  { key: 'users', label: 'Users', href: '/control-center/users', permission: 'users.read', icon: 'users', group: 'system' },
  { key: 'roles', label: 'Roles', href: '/control-center/roles', permission: 'roles.read', icon: 'roles', group: 'system' },
  { key: 'audit-logs', label: 'Audit log', href: '/control-center/audit-logs', permission: 'audit_logs.read', icon: 'audit', group: 'system' },
];

/** Visible items for a permission set (order preserved). */
export function filterNavItems(items: AdminNavItem[], permissions: string[]): AdminNavItem[] {
  const granted = new Set(permissions);
  return items.filter((item) => granted.has(item.permission));
}

/**
 * Granted items bucketed by group, in the fixed order of ADMIN_NAV_GROUPS, with
 * empty groups dropped so the sidebar never shows a heading with nothing under
 * it.
 */
export function groupNavItems(items: AdminNavItem[]): Array<{ group: AdminNavGroup; label: string; items: AdminNavItem[] }> {
  return ADMIN_NAV_GROUPS.map((group) => ({
    group,
    label: ADMIN_NAV_GROUP_LABELS[group],
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);
}

/** True for any path inside the Admin Panel (login included). */
export function isControlCenterPath(pathname: string): boolean {
  return pathname === '/control-center' || pathname.startsWith('/control-center/');
}

/** Login form validation (client + server share these rules). */
export function validateLoginInput(email: string, password: string): { email?: string; password?: string } {
  const errors: { email?: string; password?: string } = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 255) {
    errors.email = 'Enter a valid email address';
  }
  if (password.length < 1) {
    errors.password = 'Enter your password';
  }
  return errors;
}

/**
 * Human label for the current pathname, used by the header context and
 * breadcrumbs. Derived from the nav table so the two can never disagree.
 */
export function navLabelForPath(pathname: string): string | null {
  const match = ADMIN_NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? null;
}
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV_ITEMS,
  filterNavItems,
  isControlCenterPath,
  validateLoginInput,
} from '@/lib/admin-navigation';
import { controlCenterRedirect, normalizePathname } from '@/middleware';
import { AdminNavLinks } from '@/components/admin/AdminNavLinks';
import { AdminSection } from '@/components/admin/AdminSection';
import { AccessDenied } from '@/components/admin/AccessDenied';
import robots from '@/app/robots';
import { metadata as controlCenterMetadata } from '@/app/control-center/layout';

const PUBLIC_CHROME = ['site-header', 'site-footer', 'bottom-nav', 'mobile-bottom-nav'];

describe('admin navigation table', () => {
  it('keeps every section inside /control-center and names a backend permission', () => {
    expect(ADMIN_NAV_ITEMS.length).toBeGreaterThanOrEqual(12);
    for (const item of ADMIN_NAV_ITEMS) {
      expect(item.href.startsWith('/control-center/')).toBe(true);
      expect(item.permission).toMatch(/^[a-z_]+\.read$/);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate hrefs', () => {
    const hrefs = ADMIN_NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('shows only granted sections, preserving order', () => {
    const visible = filterNavItems(ADMIN_NAV_ITEMS, ['settings.read', 'dashboard.read']);
    expect(visible.map((item) => item.key)).toEqual(['dashboard', 'settings']);
  });

  it('hides everything for a user with no grants', () => {
    expect(filterNavItems(ADMIN_NAV_ITEMS, [])).toEqual([]);
  });
});

describe('control center path helpers', () => {
  it('recognises panel paths', () => {
    expect(isControlCenterPath('/control-center')).toBe(true);
    expect(isControlCenterPath('/control-center/audit-logs')).toBe(true);
    expect(isControlCenterPath('/news')).toBe(false);
    expect(isControlCenterPath('/control-center-archive')).toBe(false);
  });

  it('sends anonymous panel visitors to login but leaves login and public routes alone', () => {
    expect(controlCenterRedirect('/control-center/dashboard', false)).toBe('/control-center/login');
    expect(controlCenterRedirect('/control-center', false)).toBe('/control-center/login');
    expect(controlCenterRedirect('/control-center/login', false)).toBeNull();
    expect(controlCenterRedirect('/control-center/dashboard', true)).toBeNull();
    expect(controlCenterRedirect('/news', false)).toBeNull();
    expect(controlCenterRedirect('/', false)).toBeNull();
  });

  it('still normalises trailing slashes for panel routes', () => {
    expect(normalizePathname('/control-center/dashboard/')).toBe('/control-center/dashboard');
    expect(normalizePathname('/control-center/dashboard')).toBeNull();
  });
});

describe('login input validation', () => {
  it('rejects malformed email and empty password without echoing the value', () => {
    expect(validateLoginInput('nope', '')).toEqual({
      email: 'Enter a valid email address',
      password: 'Enter your password',
    });
  });

  it('accepts a normal credential pair', () => {
    expect(validateLoginInput(' admin@example.com ', 'hunter2')).toEqual({});
  });

  it('rejects an over-long email', () => {
    expect(validateLoginInput(`${'a'.repeat(250)}@example.com`, 'x').email).toBeDefined();
  });
});

describe('admin components', () => {
  it('marks the active nav item and links only granted sections', () => {
    const html = renderToString(
      createElement(AdminNavLinks, {
        items: filterNavItems(ADMIN_NAV_ITEMS, ['dashboard.read', 'articles.read']),
        pathname: '/control-center/articles',
      }),
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('/control-center/articles');
    expect(html).toContain('/control-center/dashboard');
    expect(html).not.toContain('/control-center/settings');
    expect(html).not.toContain('/control-center/users');
  });

  it('renders exactly one heading per section page', () => {
    const html = renderToString(createElement(AdminSection, { title: 'Matches', description: 'Fixtures.' }));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Matches');
  });

  it('distinguishes access denied from signed out', () => {
    const html = renderToString(createElement(AccessDenied, {}));
    expect(html).toContain('Access denied');
    expect(html).toContain('Sign out');
    expect(html).not.toContain('Sign in');
  });

  it('mounts no public site chrome anywhere in the panel markup', () => {
    const shell = renderToString(
      createElement(AdminNavLinks, { items: ADMIN_NAV_ITEMS, pathname: '/control-center/dashboard' }),
    );
    const login = renderToString(createElement(AdminSection, { title: 'Login', description: 'Sign in.' }));
    for (const markup of [shell, login, renderToString(createElement(AccessDenied, {}))]) {
      for (const marker of PUBLIC_CHROME) {
        expect(markup.toLowerCase()).not.toContain(marker);
      }
    }
  });
});

describe('indexing', () => {
  it('disallows the panel in robots.txt', () => {
    const result = robots();
    expect(result.rules).toEqual([
      { userAgent: '*', allow: '/', disallow: ['/control-center', '/api/'] },
    ]);
  });

  it('marks every panel route noindex, nofollow', () => {
    expect(controlCenterMetadata.robots).toMatchObject({ index: false, follow: false });
  });
});
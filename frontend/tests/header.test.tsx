import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteFooter } from '@/components/touchline/site-footer';
import { PageLayout } from '@/components/touchline/page-components';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';

const NAV_HREFS = ['/live', '/matches', '/news', '/transfers', '/competitions', '/teams', '/players'];

function hrefs(html: string): string[] {
  return Array.from(html.matchAll(/href="([^"]*)"/g), (match) => match[1]);
}

/** The touchline header reads the pathname from the client router. */
function withPathname(pathname: string) {
  vi.doMock('next/navigation', () => ({ usePathname: () => pathname }));
  vi.resetModules();
  return import('@/components/touchline/site-header');
}

afterEach(() => {
  vi.doUnmock('next/navigation');
  vi.resetModules();
});

describe('global header + navigation', () => {
  it('renders landmark header with skip link, brand, primary nav and actions', async () => {
    const { SiteHeader: Header } = await withPathname('/');
    const html = renderToString(createElement(Header));
    expect(html).toContain('<header');
    expect(html).toContain('class="skip-link" href="#main-content"');
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('href="/"');
    for (const href of NAV_HREFS) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('highlights the active section for nested paths only', async () => {
    for (const [path, expected] of [['/news', '/news'], ['/news/deep-link', '/news'], ['/teams/x', '/teams']] as const) {
      const { SiteHeader: Header } = await withPathname(path);
      const html = renderToString(createElement(Header));
      const current = Array.from(html.matchAll(/<[^>]*aria-current="page"[^>]*>/g));
      expect(current.length, path).toBe(1);
      expect(html).toContain(`href="${expected}"`);
      expect(html).toContain('nav-link--active');
    }
  });

  it('marks nothing current outside a navigation section', async () => {
    const { SiteHeader: Header } = await withPathname('/search');
    const html = renderToString(createElement(Header));
    expect(html).not.toContain('aria-current');
    expect(html).not.toContain('nav-link--active');
  });

  it('introduces no duplicate hrefs across header navigation', async () => {
    const { SiteHeader: Header } = await withPathname('/');
    const links = hrefs(renderToString(createElement(Header)));
    expect(new Set(links).size).toBe(links.length);
  });

  it('advertises the live entry point with a decorative dot', async () => {
    const { SiteHeader: Header } = await withPathname('/');
    const html = renderToString(createElement(Header));
    expect(html).toContain('href="/live"');
    expect(html).toContain('nav-link--live');
    // The pulsing dot is decorative; the link text already names the section.
    expect(html).toContain('<span class="live-dot" aria-hidden="true">');
  });

  it('keeps search and the mobile drawer collapsed until asked', async () => {
    const { SiteHeader: Header } = await withPathname('/');
    const html = renderToString(createElement(Header));
    expect(html).toContain('aria-controls="site-search"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Open search');
    expect(html).not.toContain('id="site-search"');
    expect(html).toContain('aria-controls="mobile-navigation"');
    expect(html).toContain('Open navigation menu');
    expect(html).not.toContain('id="mobile-navigation"');
  });
});

describe('global footer', () => {
  it('renders grouped, labelled navigation for every public section', () => {
    const html = renderToString(createElement(SiteFooter));
    expect(html).toContain('<footer');
    expect(html).toContain('class="site-footer__brand-column"');
    for (const group of ['Match centre', 'Newsroom', 'Directory']) {
      expect(html).toContain(`aria-label="${group}"`);
    }
    for (const href of [...NAV_HREFS, '/search']) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('advertises social profiles with accessible names', () => {
    const html = renderToString(createElement(SiteFooter));
    expect(html).toContain('aria-label="Instagram"');
    expect(html).toContain('aria-label="X"');
  });

  it('introduces no duplicate hrefs across footer navigation', () => {
    const links = hrefs(renderToString(createElement(SiteFooter)));
    expect(new Set(links).size).toBe(links.length);
  });
});

describe('page shell', () => {
  it('renders no site chrome of its own, so the root layout stays the only owner', () => {
    const html = renderToString(createElement(PageLayout, { children: 'page body' }));
    expect(html).toContain('page body');
    // PageLayout used to emit a second header, footer and <main id="main-content">,
    // which nested a duplicate header/footer inside the layout's own <main>.
    expect(html).not.toContain('<header');
    expect(html).not.toContain('<footer');
    expect(html).not.toContain('main-content');
    expect(html).not.toContain('site-header');
    expect(html).not.toContain('site-footer');
  });

  it('keeps the page-shell styling hook on a single wrapper', () => {
    const html = renderToString(createElement(PageLayout, { children: 'body' }));
    expect(html).toBe('<div class="site-page">body</div>');
  });

  it('still accepts the isDemo prop so existing call sites keep compiling', () => {
    expect(() => renderToString(createElement(PageLayout, { isDemo: false, children: 'body' }))).not.toThrow();
  });
});

describe('mobile bottom nav', () => {
  it('is configurable and highlights the section', () => {
    const html = renderToString(createElement(MobileBottomNav, { currentPath: '/matches/a' }));
    expect(html).toContain('aria-label="Quick"');
    for (const href of ['/', '/live', '/matches', '/news', '/search']) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain('aria-current="page"');
    expect(renderToString(createElement(MobileBottomNav, { disabled: true }))).toBe('');
  });
});
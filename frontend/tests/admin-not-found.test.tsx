import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NotFound from '@/app/not-found';
import { GET as adminUnmatchedRoute } from '@/app/control-center/[...unmatched]/route';

const PUBLIC_CHROME = ['site-header', 'site-footer', 'bottom-nav'];

describe('404 surfaces', () => {
  it('keeps public chrome on the global 404, as unknown public URLs always had', () => {
    const html = renderToString(createElement(NotFound, {}));
    for (const marker of PUBLIC_CHROME) {
      expect(html).toContain(marker);
    }
    expect(html).toContain('Page not found');
  });

  it('answers unknown Admin URLs with a real 404 and no public chrome', async () => {
    const response = adminUnmatchedRoute(new Request('http://localhost:3000/control-center/nope'));
    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const html = await response.text();
    for (const marker of PUBLIC_CHROME) {
      expect(html).not.toContain(marker);
    }
    expect(html).toContain('cc-root');
    expect(html).toContain('/control-center/dashboard');
  });

  it('escapes the requested path instead of reflecting it raw', async () => {
    const response = adminUnmatchedRoute(
      new Request('http://localhost:3000/control-center/%3Cscript%3Ealert(1)%3C/script%3E'),
    );
    const html = await response.text();
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });
});
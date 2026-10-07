/**
 * Step 42 — frontend SEO regression tests.
 *
 * Covers the crawl surface the Next app owns (robots.txt), the sitemap proxy
 * contract, and the backend→Next metadata bridge.
 */
import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import { isValidPartitionFile } from '@/lib/sitemap-proxy';
import { toNextMetadata } from '@/lib/data-fetch';
import { siteConfig } from '@/config/site';

describe('step 42: frontend robots.txt', () => {
  const result = robots();
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules];

  it('allows crawling of every public football surface', () => {
    const rule = rules[0];
    expect(rule.userAgent).toBe('*');
    expect(rule.allow).toBe('/');
    // No public content surface may be disallowed.
    const disallowed = [rule.disallow ?? '/'].flat().join(' ');
    for (const path of ['/news', '/matches', '/competitions', '/teams', '/players', '/transfers']) {
      expect(disallowed).not.toContain(path);
    }
  });

  it('does not block CSS, JavaScript, images or assets', () => {
    const disallowed = rules.flatMap((rule) => [rule.disallow ?? ''].flat().join(' '));
    for (const asset of ['/_next', '/static', '/assets', '/images']) {
      expect(disallowed).not.toContain(asset);
    }
  });

  it('does not disallow /search, which is already noindex via meta robots', () => {
    // Blocking it here would stop Google from ever seeing the `noindex`
    // directive, converting an ignored URL into a permanently blocked one.
    const disallowed = rules.flatMap((rule) => [rule.disallow ?? ''].flat().join(' '));
    expect(disallowed).not.toContain('/search');
  });

  it('advertises the sitemap on the configured public origin', () => {
    expect(result.sitemap).toBe(`${siteConfig.siteUrl}/sitemap.xml`);
    expect(result.host).toBe(siteConfig.siteUrl);
  });

  it('has no trailing slash on the advertised origin', () => {
    expect(siteConfig.siteUrl.endsWith('/')).toBe(false);
  });
});

describe('step 42: sitemap partition proxy contract', () => {
  it('accepts only lowercase partition filenames', () => {
    for (const file of ['news.xml', 'articles.xml', 'matches.xml', 'teams.xml', 'players.xml', 'competitions.xml']) {
      expect(isValidPartitionFile(file), file).toBe(true);
    }
  });

  it('rejects path traversal and unexpected extensions', () => {
    for (const file of [
      '../etc/passwd',
      'news.txt',
      'news.xml.evil',
      'News.xml',
      'news',
      'news.xml/../../secret',
      '',
    ]) {
      expect(isValidPartitionFile(file), file).toBe(false);
    }
  });
});

describe('step 42: metadata bridge', () => {
  it('maps backend SEO metadata onto Next metadata without inventing values', () => {
    const meta = {
      title: 'Big win | Football',
      description: 'A real description.',
      canonical: `${siteConfig.siteUrl}/news/big-win`,
      robots: 'index,follow',
      ogTitle: 'Big win',
      ogDescription: 'A real description.',
      ogImage: `${siteConfig.siteUrl}/img.jpg`,
      twitterTitle: 'Big win',
      twitterDescription: 'A real description.',
      twitterImage: `${siteConfig.siteUrl}/img.jpg`,
    };
    const next = toNextMetadata(meta, 'Fallback');
    expect(next.title).toBe(meta.title);
    expect(next.description).toBe(meta.description);
    expect(next.alternates?.canonical).toBe(meta.canonical);
    expect(next.robots).toBe('index,follow');
    expect(next.openGraph.title).toBe(meta.ogTitle);
    expect(next.openGraph.url).toBe(meta.canonical);
    expect(next.openGraph.images?.[0]?.url).toBe(meta.ogImage);
    expect(next.twitter.card).toBe('summary_large_image');
  });

  it('falls back safely when the backend SEO service is unavailable', () => {
    const next = toNextMetadata(null, 'Fallback');
    expect(next.title).toBe(`Fallback | ${siteConfig.name}`);
    expect(next.description).toBeTruthy();
    // Never fabricate a canonical URL when the service did not supply one.
    expect(next.alternates?.canonical).toBeUndefined();
    expect(next.openGraph.images).toBeUndefined();
  });

  it('does not fabricate Open Graph or Twitter values the backend omitted', () => {
    const meta = {
      title: 'T',
      description: 'D',
      canonical: `${siteConfig.siteUrl}/news/x`,
      robots: 'index,follow',
    };
    const next = toNextMetadata(meta as never, 'Fallback');
    expect(next.openGraph.title).toBe('T');
    expect(next.openGraph.images).toBeUndefined();
    expect(next.twitter.images).toBeUndefined();
  });
});
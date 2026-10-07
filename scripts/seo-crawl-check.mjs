#!/usr/bin/env node
/**
 * SEO crawl validation for the football website.
 *
 * Crawls a representative sample of every public route type and checks:
 *   - HTTP status (200 for real pages, 404 for unknown slugs/ids)
 *   - <title>, meta description, canonical link presence
 *   - meta robots (indexable pages must not be noindex)
 *   - robots.txt does not block public pages, does block /control-center
 *   - every crawled indexable URL is listed in the sitemap
 *   - no duplicate sitemap URLs, no duplicate canonicals
 *   - non-empty content (an <h1> and a minimum of visible text)
 *   - valid JSON-LD (parseable, with @context/@type; NewsArticle needs
 *     headline + datePublished)
 *   - orphan detection: sitemap URLs never linked from any crawled page
 *   - trailing-slash normalization (/news/ -> 308 -> /news)
 *
 * Usage:
 *   node scripts/seo-crawl-check.mjs [--site http://localhost:3000]
 *                                     [--sample 5] [--out report.json] [--quiet]
 *
 * Exit code 0 when no ERROR findings, 1 otherwise. Warnings never fail.
 */
/* global process, console, fetch, URL */

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const SITE = (opt('--site', process.env.SEO_CHECK_SITE ?? 'http://localhost:3000')).replace(/\/$/, '');
const SAMPLE = Math.max(1, Number(opt('--sample', '5')) || 5);
const OUT = opt('--out', null);
const QUIET = args.includes('--quiet');

const findings = [];
function error(check, url, detail) {
  findings.push({ severity: 'ERROR', check, url, detail });
}
function warn(check, url, detail) {
  findings.push({ severity: 'WARN', check, url, detail });
}
function log(...parts) {
  if (!QUIET) console.log(...parts);
}

async function get(url, { redirect = 'manual' } = {}) {
  const res = await fetch(url, { redirect });
  const text = await res.text().catch(() => '');
  return { status: res.status, headers: res.headers, text, finalUrl: res.url };
}

function sameOrigin(href) {
  try {
    return new URL(href, SITE).origin === new URL(SITE).origin;
  } catch {
    return false;
  }
}

function normalizePath(href) {
  try {
    const u = new URL(href, SITE);
    return u.pathname.replace(/\/$/, '') || '/';
  } catch {
    return null;
  }
}

function extractMeta(html) {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0] ?? '';
  const description = desc.match(/content=["']([^"']*)["']/i)?.[1]?.trim() ?? '';
  const canonTag = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] ?? '';
  const canonical = canonTag.match(/href=["']([^"']+)["']/i)?.[1]?.trim() ?? '';
  const robotsTag = html.match(/<meta[^>]+name=["']robots["'][^>]*>/i)?.[0] ?? '';
  const robots = (robotsTag.match(/content=["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)]
    .map((m) => m[1])
    .filter((h) => sameOrigin(h) && !h.startsWith('mailto:') && !h.startsWith('tel:'));
  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1],
  );
  return { title, description, canonical, robots, h1, text, links, jsonLdBlocks };
}

async function main() {
  const stats = { crawled: 0, indexable: 0, noindex: 0, sitemapUrls: 0 };

  // ---- robots.txt ---------------------------------------------------------
  const robots = await get(`${SITE}/robots.txt`);
  if (robots.status !== 200) {
    error('robots-fetch', `${SITE}/robots.txt`, `HTTP ${robots.status}`);
  } else {
    const body = robots.text;
    if (!/User-agent:\s*\*/i.test(body)) error('robots-syntax', `${SITE}/robots.txt`, 'missing User-agent rule');
    if (!body.includes('/control-center')) error('robots-admin', `${SITE}/robots.txt`, 'must disallow /control-center');
    const blocks = [];
    for (const line of body.split('\n')) {
      const m = line.match(/^\s*Disallow:\s*(\S+)/i);
      if (m) blocks.push(m[1]);
    }
    const mustStayOpen = ['/news', '/matches', '/teams', '/players', '/competitions', '/transfers', '/live'];
    for (const path of mustStayOpen) {
      if (blocks.some((b) => b !== '/' && path.startsWith(b))) {
        error('robots-blocks-public', `${SITE}/robots.txt`, `${path} is disallowed`);
      }
    }
    const sitemapLine = body.split('\n').find((l) => /^sitemap:/i.test(l));
    if (!sitemapLine) warn('robots-sitemap', `${SITE}/robots.txt`, 'no Sitemap directive');
    log(`robots.txt: HTTP ${robots.status}, ${blocks.length} disallow rules`);
  }

  // ---- sitemap index + partitions -----------------------------------------
  const index = await get(`${SITE}/sitemap.xml`);
  if (index.status !== 200) {
    error('sitemap-index', `${SITE}/sitemap.xml`, `HTTP ${index.status}`);
    return finish(stats);
  }
  const partitionLocs = [...index.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (partitionLocs.length === 0) error('sitemap-index', `${SITE}/sitemap.xml`, 'index lists no partitions');
  const sitemapUrls = new Set();
  const sitemapDupes = new Set();
  const urlSources = new Map();
  for (const loc of partitionLocs) {
    const url = loc.startsWith('http') ? loc : `${SITE}${loc}`;
    const page = await get(url);
    if (page.status !== 200) {
      error('sitemap-partition', url, `HTTP ${page.status}`);
      continue;
    }
    if (!page.text.includes('<urlset') && !page.text.includes('<sitemapindex')) {
      error('sitemap-format', url, 'not a urlset/sitemapindex document');
    }
    for (const m of page.text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)) {
      const u = m[1].trim();
      if (sitemapUrls.has(u)) sitemapDupes.add(u);
      sitemapUrls.add(u);
      if (!urlSources.has(u)) urlSources.set(u, new Set());
      urlSources.get(u).add(url);
    }
  }
  stats.sitemapUrls = sitemapUrls.size;
  for (const d of sitemapDupes) {
    // Google News sitemap (news.xml) intentionally overlaps the evergreen
    // articles partition for recent stories — same URL, different schema
    // (news:news vs urlset). Allowed by Google, downgraded to a warning.
    const sources = [...(urlSources.get(d) ?? [])].join(' ');
    const isNewsOverlap = /\/news[^/]*\.xml/i.test(sources) && /\/articles\.xml/i.test(sources);
    if (isNewsOverlap) warn('sitemap-duplicate-url', d, 'in both news and articles sitemaps (Google News overlap, allowed)');
    else error('sitemap-duplicate-url', d, 'listed more than once');
  }
  log(`sitemap: ${partitionLocs.length} partitions, ${sitemapUrls.size} URLs`);

  const forbiddenInSitemap = [...sitemapUrls].filter((u) => {
    const p = normalizePath(u) ?? '';
    return (
      p.startsWith('/control-center') ||
      p.startsWith('/api/') ||
      p === '/search' ||
      p.startsWith('/login')
    );
  });
  for (const u of forbiddenInSitemap) error('sitemap-forbidden-url', u, 'noindex/private URL must not be listed');

  // ---- page sample ---------------------------------------------------------
  const byType = new Map();
  for (const u of sitemapUrls) {
    const p = normalizePath(u);
    if (!p) continue;
    const type = p === '/'
      ? 'home'
      : /^\/news\/[^/]+$/.test(p) ? 'article'
      : /^\/news\/category\/[^/]+$/.test(p) ? 'category'
      : /^\/news\/tag\/[^/]+$/.test(p) ? 'tag'
      : /^\/matches\/[^/]+$/.test(p) ? 'match'
      : /^\/teams\/[^/]+$/.test(p) ? 'team'
      : /^\/players\/[^/]+$/.test(p) ? 'player'
      : /^\/competitions\/[^/]+$/.test(p) ? 'competition'
      : /^\/transfers\/[^/]+$/.test(p) ? 'transfer'
      : 'listing';
    if (!byType.has(type)) byType.set(type, []);
    if (byType.get(type).length < SAMPLE) byType.get(type).push(u);
  }
  const STATIC = ['/', '/news', '/transfers', '/matches', '/live', '/competitions', '/teams', '/players', '/breaking-news'];
  const sample = new Set(STATIC.map((p) => (p === '/' ? `${SITE}/` : `${SITE}${p}`)));
  for (const urls of byType.values()) for (const u of urls) sample.add(u);

  const canonicals = new Map();
  const linkedPaths = new Set();
  for (const url of sample) {
    let page;
    try {
      page = await get(url, { redirect: 'follow' });
    } catch (e) {
      error('http-error', url, String(e?.message ?? e));
      continue;
    }
    stats.crawled += 1;
    if (page.status !== 200) {
      error('http-error', url, `HTTP ${page.status}`);
      continue;
    }
    const meta = extractMeta(page.text);
    const noindex = meta.robots.includes('noindex');
    if (noindex) stats.noindex += 1;
    else stats.indexable += 1;

    if (!meta.title) error('missing-title', url, 'no <title>');
    else if (meta.title.length < 10 || meta.title.length > 120) {
      warn('title-length', url, `title is ${meta.title.length} chars`);
    }
    if (!meta.description) error('missing-description', url, 'no meta description');
    else if (meta.description.length < 30 || meta.description.length > 320) {
      warn('description-length', url, `description is ${meta.description.length} chars`);
    }
    if (!meta.canonical) {
      error('missing-canonical', url, 'no canonical link');
    } else {
      if (canonicals.has(meta.canonical)) canonicals.get(meta.canonical).push(url);
      else canonicals.set(meta.canonical, [url]);
      // Canonical must resolve to the page itself (ignoring query strings).
      const canonPath = normalizePath(meta.canonical);
      const pagePath = normalizePath(page.finalUrl);
      if (canonPath && pagePath && canonPath !== pagePath) {
        error('canonical-mismatch', url, `canonical ${meta.canonical} != fetched ${page.finalUrl}`);
      }
    }
    if (!meta.h1) error('empty-content', url, 'no <h1>');
    if (meta.text.length < 300) warn('thin-content', url, `only ${meta.text.length} chars of text`);
    for (const block of meta.jsonLdBlocks) {
      let data;
      try {
        data = JSON.parse(block);
      } catch {
        error('invalid-structured-data', url, 'JSON-LD does not parse');
        continue;
      }
      for (const node of Array.isArray(data) ? data : [data]) {
        if (!node?.['@context'] || !node?.['@type']) {
          error('invalid-structured-data', url, 'JSON-LD node missing @context/@type');
        }
        if (node?.['@type'] === 'NewsArticle') {
          if (!node.headline) error('invalid-structured-data', url, 'NewsArticle missing headline');
          if (!node.datePublished) error('invalid-structured-data', url, 'NewsArticle missing datePublished');
          if (!node.publisher?.logo && !node.publisher?.name) {
            warn('structured-data-publisher', url, 'NewsArticle publisher has no logo/name');
          }
        }
      }
    }
    for (const href of meta.links) {
      const p = normalizePath(href);
      if (p) linkedPaths.add(p);
    }
  }

  // ---- duplicates ----------------------------------------------------------
  for (const [canon, urls] of canonicals) {
    if (urls.length > 1) error('duplicate-canonical', canon, `shared by ${urls.join(', ')}`);
  }

  // ---- sitemap coverage ----------------------------------------------------
  for (const url of sample) {
    const isStatic = STATIC.some((p) => `${SITE}${p === '/' ? '' : p}` === url || (p === '/' && url === `${SITE}/`));
    if (!isStatic && !sitemapUrls.has(url)) {
      warn('missing-sitemap-entry', url, 'crawled indexable URL not listed in any sitemap');
    }
  }

  // ---- orphans --------------------------------------------------------------
  const orphans = [...sitemapUrls].filter((u) => {
    const p = normalizePath(u);
    return p && !linkedPaths.has(p) && p !== '/';
  });
  if (orphans.length > 0) {
    warn('orphan-pages', `${orphans.length} sitemap URLs never linked`, orphans.slice(0, 20).join(', '));
  }

  // ---- trailing slash + case -----------------------------------------------
  const slash = await get(`${SITE}/news/`);
  if (![301, 302, 307, 308].includes(slash.status)) {
    warn('trailing-slash', `${SITE}/news/`, `HTTP ${slash.status}, expected redirect`);
  } else {
    const to = slash.headers.get('location') ?? '';
    if (!to.endsWith('/news')) warn('trailing-slash', `${SITE}/news/`, `redirects to ${to}`);
  }
  const upper = await get(`${SITE}/NEWS`);
  if (![301, 302, 307, 308].includes(upper.status)) {
    if (upper.status === 200) warn('uppercase-url', `${SITE}/NEWS`, 'uppercase variant returns 200 (duplicate content risk)');
  } else {
    const to = (upper.headers.get('location') ?? '').toLowerCase();
    if (!to.endsWith('/news')) warn('uppercase-url', `${SITE}/NEWS`, `redirects to ${to}`);
    else log('uppercase-url: /NEWS 308s to lowercase (good)');
  }
  const upperEntity = await get(`${SITE}/Teams/Arsenal`);
  if (upperEntity.status === 200) warn('uppercase-url', `${SITE}/Teams/Arsenal`, 'mixed-case entity URL returns 200 (duplicate content risk)');

  // ---- pagination canonical --------------------------------------------------
  for (const paged of [`${SITE}/teams?page=2`, `${SITE}/players?page=2`, `${SITE}/competitions?page=2`]) {
    const res = await get(paged, { redirect: 'follow' });
    if (res.status !== 200) {
      warn('pagination-page', paged, `HTTP ${res.status} (empty catalogue or outage)`);
      continue;
    }
    const meta = extractMeta(res.text);
    if (!meta.canonical.includes('page=2')) warn('pagination-canonical', paged, `canonical ${meta.canonical || '(missing)'} should include ?page=2`);
    if (!/page 2/i.test(meta.title)) warn('pagination-title', paged, 'title should mention Page 2');
    if (meta.robots.includes('noindex')) warn('pagination-noindex', paged, 'paginated listing should stay indexable');
  }

  // ---- 404 behaviour --------------------------------------------------------
  // In dev, streamed notFound() can surface as 200 + noindex not-found content;
  // production (`next start`) must send a real 404. A 200 that is indexable or
  // lacks not-found markers is always an error (soft-404 that could index).
  for (const bad of [`${SITE}/news/no-such-article-xyz`, `${SITE}/teams/no-such-team-xyz`]) {
    const res = await get(bad);
    if (res.status === 404) continue;
    const meta = extractMeta(res.text);
    const looksNotFound = meta.robots.includes('noindex') && (/not[ -]?found/i.test(meta.title) || /NEXT_NOT_FOUND|Page not found/i.test(res.text));
    if (res.status === 200 && looksNotFound) {
      warn('soft-404-dev', bad, `HTTP 200 with noindex not-found content (verify real 404 in production build)`);
    } else {
      error('not-404', bad, `HTTP ${res.status}, expected 404`);
    }
  }
  const search = await get(`${SITE}/search?q=test`);
  if (search.status === 200 && !extractMeta(search.text).robots.includes('noindex')) {
    error('search-indexable', `${SITE}/search?q=test`, 'search results must be noindex');
  }

  return finish(stats);
}

async function finish(stats) {
  const errors = findings.filter((f) => f.severity === 'ERROR');
  const warns = findings.filter((f) => f.severity === 'WARN');
  log(`\nchecked ${stats.crawled} pages (${stats.indexable} indexable, ${stats.noindex} noindex), ${stats.sitemapUrls} sitemap URLs`);
  log(`${errors.length} errors, ${warns.length} warnings`);
  for (const f of findings) log(`[${f.severity}] ${f.check} ${f.url} — ${f.detail}`);
  if (OUT) {
    const fs = await import('node:fs');
    fs.writeFileSync(OUT, JSON.stringify({ stats, findings }, null, 2));
    log(`wrote ${OUT}`);
  }
  if (errors.length > 0) process.exitCode = 1;
}

await main();

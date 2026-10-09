import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { toServiceError, upstream } from '../lib/errors';
import { log } from '../lib/logger';
import { serviceClient, type DbClient } from '../lib/supabase';
import { absoluteCanonicalUrl, type CanonicalEntityType } from '../seo/canonical';
import { escapeMeta } from '../seo/metadata';

export const SITEMAP_PARTITIONS = ['news', 'articles', 'matches', 'teams', 'players', 'competitions', 'transfers', 'categories', 'tags', 'pages'] as const;
export type SitemapPartition = (typeof SITEMAP_PARTITIONS)[number];

export interface SitemapEntry {
  loc: string;
  lastmod?: string | null;
}

export interface NewsSitemapEntry extends SitemapEntry {
  title: string;
  publicationDate: string;
}

const SITEMAP_NS = 'sitemap';
const SITEMAP_TTL = config.seo.cacheTtl;

function isoDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function escapeXml(value: string): string {
  return escapeMeta(value).replace(/'/g, '&apos;');
}

export function urlsetXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => `  <url>\n    <loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `\n    <lastmod>${escapeXml(e.lastmod)}</lastmod>` : ''}\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

export function newsSitemapXml(entries: NewsSitemapEntry[]): string {
  const urls = entries
    .map(
      (e) =>
        `  <url>\n    <loc>${escapeXml(e.loc)}</loc>\n    <news:news>\n      <news:publication>\n        <news:name>${escapeXml(config.site.name)}</news:name>\n        <news:language>${escapeXml(config.site.language)}</news:language>\n      </news:publication>\n      <news:publication_date>${escapeXml(e.publicationDate)}</news:publication_date>\n      <news:title>${escapeXml(e.title)}</news:title>\n    </news:news>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${urls}\n</urlset>`;
}

export function sitemapIndexXml(refs: SitemapEntry[]): string {
  const items = refs
    .map((r) => `  <sitemap>\n    <loc>${escapeXml(r.loc)}</loc>${r.lastmod ? `\n    <lastmod>${escapeXml(r.lastmod)}</lastmod>` : ''}\n  </sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>`;
}

/**
 * Public URL for a sitemap partition.
 *
 * Sitemap *files* must live on the same host as the URLs they list, which is
 * the public site origin (`site.baseUrl`) — not the API origin. The API still
 * serves these documents at `/api/v1/sitemaps/:name.xml`, and the frontend
 * re-exposes them at `/sitemaps/:name.xml` on the public origin, so crawlers see
 * one consistent host. Advertising the API path under the site origin produced
 * URLs that 404 for Google.
 */
function partitionUrl(name: SitemapPartition, page: number): string {
  const base = `${config.site.baseUrl}/sitemaps/${name}.xml`;
  return page > 1 ? `${base}?page=${page}` : base;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function countRows(
  client: DbClient,
  table: string,
  apply: (q: any) => any,
): Promise<number> {
  // Count via a bounded probe that works on both PostgREST and the test fake:
  // range keeps memory bounded while count reflects the full filtered set.
  const { count, error } = await (apply(client.from(table).select('id', { count: 'exact' } as never)) as any).range(0, 0);
  if (error) throw upstream('Sitemap count failed');
  return (count as number | null) ?? 0;
}

/**
 * Instant separating the `news` partition from the `articles` partition.
 *
 * A freshly published article is eligible for the news sitemap; once it falls
 * out of the news window it becomes eligible for the plain articles partition.
 * Both partitions read the same table, so this single boundary is what keeps a
 * URL from being listed twice across the sitemap collection: `news` owns
 * `published_at >= cutoff`, `articles` owns everything strictly older. The two
 * sets are disjoint and together cover every published article, with no gap.
 */
function newsCutoffIso(): string {
  return new Date(Date.now() - config.seo.newsWindowHours * 3600 * 1000).toISOString();
}

/** Which side of the news window an article partition covers. */
export type ArticleWindow = 'news' | 'archive';

async function publishedArticlePage(
  client: DbClient,
  limit: number,
  offset: number,
  window: ArticleWindow,
): Promise<Array<Record<string, unknown>>> {
  const nowIso = new Date().toISOString();
  const cutoff = newsCutoffIso();
  let query = client
    .from('articles')
    .select('slug,title,published_at,updated_at')
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .lte('published_at', nowIso);
  if (window === 'news') {
    query = query.gte('published_at', cutoff).order('published_at', { ascending: false });
  } else {
    query = query.lt('published_at', cutoff).order('slug', { ascending: true });
  }
  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) throw upstream('Sitemap query failed');
  return ((data as Array<Record<string, unknown>> | null) ?? []);
}

async function entityPage(
  client: DbClient,
  table: string,
  columns: string,
  limit: number,
  offset: number,
  extra?: (q: any) => any,
): Promise<Array<Record<string, unknown>>> {
  let query: any = client.from(table).select(columns);
  if (extra) query = extra(query);
  const { data, error } = await query.order('slug', { ascending: true }).range(offset, offset + limit - 1);
  if (error) throw upstream('Sitemap query failed');
  return (((data as unknown) as Array<Record<string, unknown>> | null) ?? []);
}

function lastmodOf(row: Record<string, unknown>, candidates: string[]): string | null {
  for (const key of candidates) {
    const v = row[key] as string | null | undefined;
    if (v && !Number.isNaN(Date.parse(String(v)))) return new Date(String(v)).toISOString();
  }
  return null;
}

async function guarded<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw toServiceError(error, 'Sitemap unavailable');
  }
}

/** Static, always-indexable public pages (never noindex, never filtered). */
const STATIC_INDEXABLE_PATHS = [
  '/',
  '/news',
  '/breaking-news',
  '/transfers',
  '/matches',
  '/live',
  '/competitions',
  '/teams',
  '/players',
] as const;

async function transferPage(client: DbClient, limit: number, offset: number): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await client
    .from('transfers')
    .select('id,announcement_date,effective_date,updated_at')
    .in('status', ['announced', 'completed'])
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw upstream('Sitemap query failed');
  return (data as Array<Record<string, unknown>> | null) ?? [];
}

/**
 * Indexable match statuses only. The frontend drops postponed / cancelled /
 * abandoned cards (toMatchStatus returns null), so listing them in the sitemap
 * would advertise URLs that render empty shells. Live covers half_time,
 * extra_time, penalty_shootout and suspended as well.
 */
export const INDEXABLE_MATCH_STATUSES = [
  'scheduled',
  'pre_match',
  'live',
  'half_time',
  'extra_time',
  'penalty_shootout',
  'suspended',
  'finished',
] as const;

async function taxonomyPage(client: DbClient, table: string, limit: number, offset: number, filterActive: boolean): Promise<Array<Record<string, unknown>>> {
  let query: any = client.from(table).select(filterActive ? 'slug,is_active' : 'slug');
  if (filterActive) query = query.eq('is_active', true);
  const { data, error } = await query
    .order('slug', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw upstream('Sitemap query failed');
  return (data as Array<Record<string, unknown>> | null) ?? [];
}

export const sitemapService = {
  maxPerSitemap(): number {
    return Math.min(Math.max(config.seo.sitemapMaxUrls, 1), 50000);
  },

  async partitionCounts(client: DbClient = serviceClient()): Promise<Record<SitemapPartition, number>> {
    const nowIso = new Date().toISOString();
    const cutoff = newsCutoffIso();
    const [news, articles, matches, teams, players, competitions, transfers, categories, tags, pages] = await Promise.all([
      // News owns the recent window, articles owns everything older it, so no
      // URL is counted by both partitions. See newsCutoffIso().
      countRows(client, 'articles', (q) =>
        q.eq('status', 'published').not('published_at', 'is', null).lte('published_at', nowIso).gte('published_at', cutoff),
      ),
      countRows(client, 'articles', (q) =>
        q.eq('status', 'published').not('published_at', 'is', null).lte('published_at', nowIso).lt('published_at', cutoff),
      ),
      countRows(client, 'matches', (q) => q.in('status', [...INDEXABLE_MATCH_STATUSES])),
      // A deactivated team/competition is served `noindex` by robotsFor(), so it
      // must not be advertised as indexable. `players` has no is_active column.
      countRows(client, 'teams', (q) => q.eq('is_active', true)),
      countRows(client, 'players', (q) => q),
      countRows(client, 'competitions', (q) => q.eq('is_active', true)),
      countRows(client, 'transfers', (q) => q.in('status', ['announced', 'completed'])),
      countRows(client, 'categories', (q) => q.eq('is_active', true)),
      countRows(client, 'tags', (q) => q),
      Promise.resolve(STATIC_INDEXABLE_PATHS.length),
    ]);
    return { news, articles, matches, teams, players, competitions, transfers, categories, tags, pages };
  },

  async getIndex(): Promise<string> {
    return guarded(() =>
      cached(SITEMAP_NS, { kind: 'index' }, SITEMAP_TTL, async () => {
        const client = serviceClient();
        // A count failure must not degrade into an index of empty partitions:
        // a crawler reading ten empty sitemaps concludes "this site has no
        // URLs" and can drop pages it had already discovered. Propagating the
        // error yields 503, which a crawler retries instead of acting on.
        const counts = await this.partitionCounts(client);
        const per = this.maxPerSitemap();
        const refs: SitemapEntry[] = [];
        for (const name of SITEMAP_PARTITIONS) {
          const pages = Math.max(1, Math.ceil((counts[name] || 0) / per));
          for (let page = 1; page <= Math.min(pages, 1000); page += 1) {
            refs.push({ loc: partitionUrl(name, page) });
          }
        }
        log({ msg: 'sitemap_index_generated', partitions: refs.length });
        return sitemapIndexXml(refs);
      }),
    );
  },

  async getNewsXml(page = 1, perPage?: number): Promise<string> {
    const per = Math.min(perPage ?? this.maxPerSitemap(), this.maxPerSitemap());
    return guarded(() =>
      cached(SITEMAP_NS, { kind: 'news', page, per }, SITEMAP_TTL, async () => {
        const client = serviceClient();
        const rows = await publishedArticlePage(client, per, (page - 1) * per, 'news');
        const entries: NewsSitemapEntry[] = [];
        for (const row of rows) {
          const slug = String(row.slug ?? '');
          const title = String(row.title ?? '');
          const pub = isoDateOnly(String(row.published_at ?? ''));
          if (!slug || !title || !pub) continue;
          entries.push({
            loc: absoluteCanonicalUrl('news' as CanonicalEntityType, slug),
            title,
            publicationDate: pub,
          });
        }
        log({ msg: 'sitemap_generated', partition: 'news', page, entries: entries.length });
        return newsSitemapXml(entries);
      }),
    );
  },

  async getPartitionXml(partition: SitemapPartition, page = 1, perPage?: number): Promise<string> {
    if (partition === 'news') return this.getNewsXml(page, perPage);
    const per = Math.min(perPage ?? this.maxPerSitemap(), this.maxPerSitemap());
    return guarded(() =>
      cached(SITEMAP_NS, { kind: 'partition', partition, page, per }, SITEMAP_TTL, async () => {
        const client = serviceClient();
        const offset = (page - 1) * per;
        let entries: SitemapEntry[] = [];
        if (partition === 'articles') {
          const rows = await publishedArticlePage(client, per, offset, 'archive');
          entries = rows
            .filter((r) => r.slug)
            .map((r) => ({
              loc: absoluteCanonicalUrl('news' as CanonicalEntityType, String(r.slug)),
              lastmod: lastmodOf(r, ['updated_at', 'published_at']),
            }));
        } else if (partition === 'matches') {
          const rows = await entityPage(client, 'matches', 'slug,scheduled_at,updated_at', per, offset, (q) =>
            q.in('status', [...INDEXABLE_MATCH_STATUSES]),
          );
          entries = rows
            .filter((r) => r.slug)
            .map((r) => ({
              loc: absoluteCanonicalUrl('match' as CanonicalEntityType, String(r.slug)),
              lastmod: lastmodOf(r, ['updated_at', 'scheduled_at']),
            }));
        } else if (partition === 'teams' || partition === 'players' || partition === 'competitions') {
          const table = partition;
          // Sitemap partitions are plural; canonical entities are singular.
          const entityType = (partition === 'teams' ? 'team' : partition === 'players' ? 'player' : 'competition') as CanonicalEntityType;
          // `teams` and `competitions` carry is_active, and robotsFor() serves a
          // deactivated entity as noindex — advertising it here would put a
          // noindex URL in a sitemap. `players` has no such column.
          const filterActive = partition !== 'players';
          const rows = await entityPage(client, table, 'slug,updated_at', per, offset, (q) =>
            filterActive ? q.eq('is_active', true) : q,
          );
          entries = rows
            .filter((r) => r.slug)
            .map((r) => ({
              loc: absoluteCanonicalUrl(entityType, String(r.slug)),
              lastmod: lastmodOf(r, ['updated_at']),
            }));
        } else if (partition === 'transfers') {
          const rows = await transferPage(client, per, offset);
          entries = rows
            .filter((r) => r.id)
            .map((r) => ({
              loc: `${config.site.baseUrl}/transfers/${String(r.id)}`,
              lastmod: lastmodOf(r, ['updated_at', 'announcement_date', 'effective_date']),
            }));
        } else if (partition === 'categories' || partition === 'tags') {
          const rows = await taxonomyPage(client, partition, per, offset, partition === 'categories');
          const prefix = partition === 'categories' ? '/news/category' : '/news/tag';
          entries = rows
            .filter((r) => r.slug)
            .map((r) => ({ loc: `${config.site.baseUrl}${prefix}/${String(r.slug)}` }));
        } else if (partition === 'pages') {
          const slice = STATIC_INDEXABLE_PATHS.slice(offset, offset + per);
          entries = slice.map((p) => ({ loc: `${config.site.baseUrl}${p === '/' ? '' : p}` }));
          if (offset === 0) entries[0] = { loc: `${config.site.baseUrl}/` };
        }
        log({ msg: 'sitemap_generated', partition, page, entries: entries.length });
        return urlsetXml(entries);
      }),
    );
  },

  async invalidateSitemapCaches(): Promise<void> {
    const { invalidateNamespace } = await import('../lib/cache');
    await invalidateNamespace('sitemap').catch(() => undefined);
    log({ msg: 'sitemap_cache_invalidated' });
  },
};

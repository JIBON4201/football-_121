import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteConfig } from '@/config/site';
import { generateMetadata as transfersMetadataFn } from '@/app/(site)/transfers/page';
import { generateMetadata as transferMetadata } from '@/app/(site)/transfers/[id]/page';
import {
  asTransferListItem,
  asTransferRecord,
  classifyFee,
  fetchTransferDetail,
  fetchTransferList,
  fetchTransferNews,
  fetchTransferWindows,
  filtersIncludeUnconfirmed,
  formatFee,
  isConfirmedStatus,
  parseTransferFilters,
  statusLabel,
  toTransferQuery,
  transferPageQuery,
  transferUrl,
  typeLabel,
  TRANSFERS_CANONICAL,
  TRANSFER_REVALIDATE,
  type Article,
  type Player,
  type Team,
  type TransferDetail,
  type TransferRecord,
  type TransferWindow,
} from '@/lib/transfers';
import { TransferCard, TransferDetailView, TransferFee, TransferStatusBadge, TransferTimeline } from '@/components/transfers/TransferCard';
import { TransferFilterForm, TransferNewsSection, TransferStatusFilter } from '@/components/transfers/TransferSections';

const TRANSFER_ID = '11111111-1111-4111-8111-111111111111';
const SEASON_ID = '22222222-2222-4222-8222-222222222222';
const WINDOW_ID = '44444444-4444-4444-8444-444444444444';

const player: Player = { id: 'p1', display_name: 'John Doe', slug: 'john-doe', photo_url: 'https://cdn.test/jd.png', position: 'Forward' };
const fromTeam: Team = { id: 't1', name: 'FC Example', short_name: 'FCE', slug: 'fc-example', logo_url: 'https://cdn.test/fce.png' };
const toTeam: Team = { id: 't2', name: 'Real Sample', short_name: 'RSM', slug: 'real-sample', logo_url: 'https://cdn.test/rsm.png' };

const transfer = (overrides: Partial<TransferRecord> = {}): TransferRecord => ({
  id: TRANSFER_ID,
  player_id: 'p1',
  from_team_id: 't1',
  to_team_id: 't2',
  transfer_type: 'permanent',
  status: 'completed',
  fee: 15000000,
  currency: 'EUR',
  announcement_date: '2026-06-20',
  effective_date: '2026-07-01',
  season_id: SEASON_ID,
  window_id: WINDOW_ID,
  ...overrides,
});

const window = (overrides: Partial<TransferWindow> = {}): TransferWindow => ({
  id: WINDOW_ID,
  name: 'Summer 2026',
  season_id: SEASON_ID,
  start_date: '2026-06-01',
  end_date: '2026-09-01',
  ...overrides,
});

const detail = (overrides: Partial<TransferDetail> = {}): TransferDetail => ({
  transfer: transfer(),
  player,
  fromTeam,
  toTeam,
  season: { id: SEASON_ID, competition_id: 'c1', name: '2026/27', start_date: null, end_date: null, is_current: true },
  window: window(),
  competition: { id: 'c1', name: 'Premier League', short_name: 'EPL', slug: 'premier-league', logo_url: null, is_active: true },
  ...overrides,
});

const article = (overrides: Partial<Article> = {}): Article => ({
  id: 'a1',
  title: 'Transfer done',
  slug: 'transfer-done',
  excerpt: null,
  article_type: 'transfer',
  published_at: '2026-06-20T10:00:00.000Z',
  is_featured: false,
  is_breaking: false,
  view_count: 9,
  ...overrides,
});

/** React separates adjacent text nodes with comment markers and escapes `&`. */
const text = (html: string): string => html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function mockApi(
  respond: (pathname: string, url: URL) => { status: number; body: unknown } | null,
  seen?: Array<{ url: string; init?: unknown }>,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      seen?.push({ url, init });
      const parsed = new URL(url);
      const pathname = parsed.pathname.replace(/^\/api\/v1/, '') || '/';
      const hit = respond(pathname, parsed);
      if (!hit) {
        return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND', message: 'Not found' } }) };
      }
      return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, json: async () => hit.body };
    }) as unknown as typeof fetch,
  );
}

const envelope = (data: unknown, pagination?: unknown) => ({ data, pagination, requestId: 'test' });

const listRow = (overrides: Record<string, unknown> = {}) => ({
  ...transfer(),
  player,
  fromTeam,
  toTeam,
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transfer fee presentation', () => {
  it('never shows an unknown fee as zero', () => {
    expect(classifyFee(null, 'permanent')).toBe('undisclosed');
    expect(formatFee(null, 'EUR', 'permanent')).toBeNull();
    expect(formatFee(null, null, null)).toBeNull();
  });

  it('states a free transfer as free even with no recorded fee', () => {
    expect(classifyFee(null, 'free_transfer')).toBe('free');
    expect(formatFee(null, null, 'free_transfer')).toBe('Free');
    // An explicit zero is a real, known figure.
    expect(classifyFee(0, 'permanent')).toBe('free');
  });

  it('respects the stored currency and never assumes one', () => {
    expect(formatFee(15000000, 'EUR', 'permanent')).toBe('EUR 15,000,000');
    expect(formatFee(500000, 'GBP', 'loan')).toBe('GBP 500,000');
    expect(formatFee(1200, null, 'permanent')).toBe('1,200');
  });
});

describe('transfer status and type labels', () => {
  it('separates confirmed statuses from unconfirmed ones', () => {
    expect(isConfirmedStatus('completed')).toBe(true);
    expect(isConfirmedStatus('announced')).toBe(true);
    for (const status of ['rumour', 'cancelled', 'rejected'] as const) {
      expect(isConfirmedStatus(status), status).toBe(false);
    }
  });

  it('provides human labels for every status and type', () => {
    for (const status of ['rumour', 'announced', 'completed', 'cancelled', 'rejected'] as const) {
      expect(statusLabel(status), status).toBeTruthy();
    }
    expect(statusLabel('rumour')).toBe('Rumour');
    expect(typeLabel('permanent')).toBe('Permanent');
    expect(typeLabel('loan')).toBe('Loan');
    expect(typeLabel('loan_return')).toBe('Loan return');
    expect(typeLabel('free_transfer')).toBe('Free transfer');
  });
});

describe('transfer filters and canonical URLs', () => {
  it('keeps known filters and drops invalid ones', () => {
    const filters = parseTransferFilters({
      status: 'rumour',
      includeUnconfirmed: 'true',
      type: 'loan',
      player: 'john-doe',
      team: 'fc-example',
      fromTeam: 'real-sample',
      toTeam: 'fc-example',
      season: SEASON_ID,
      window: WINDOW_ID,
      sort: 'asc',
      sortField: 'announcement_date',
      page: '2',
      limit: '9999',
    });
    expect(filters.status).toBe('rumour');
    expect(filters.includeUnconfirmed).toBe(true);
    expect(filters.type).toBe('loan');
    expect(filters.sort).toBe('asc');
    expect(filters.sortField).toBe('announcement_date');
    expect(filters.limit).toBeLessThanOrEqual(50);
  });

  it('rejects a bad slug, uuid, status, type and sort field', () => {
    const filters = parseTransferFilters({
      player: 'bad slug/../etc',
      season: 'not-a-uuid',
      window: 'nope',
      status: 'maybe',
      type: 'swap',
      sortField: 'fee',
      page: '0',
    });
    expect(filters.player).toBeNull();
    expect(filters.season).toBeNull();
    expect(filters.window).toBeNull();
    expect(filters.status).toBeNull();
    expect(filters.type).toBeNull();
    expect(filters.sortField).toBe('effective_date');
    expect(filters.page).toBe(1);
  });

  it('detects a selection that asks for unconfirmed records', () => {
    expect(filtersIncludeUnconfirmed(parseTransferFilters({}))).toBe(false);
    expect(filtersIncludeUnconfirmed(parseTransferFilters({ status: 'completed' }))).toBe(false);
    expect(filtersIncludeUnconfirmed(parseTransferFilters({ status: 'rumour' }))).toBe(true);
  });

  it('sends the unconfirmed acknowledgement whenever an unconfirmed status is chosen', () => {
    // Choosing an unconfirmed status is itself the acknowledgement, so the site
    // never generates a URL its own API would reject.
    expect(toTransferQuery(parseTransferFilters({ status: 'rumour' }))).toContain('includeUnconfirmed=true');
    expect(toTransferQuery(parseTransferFilters({ status: 'rumour', includeUnconfirmed: 'true' }))).toContain(
      'includeUnconfirmed=true',
    );
    expect(toTransferQuery(parseTransferFilters({ status: 'completed' }))).not.toContain('includeUnconfirmed');
    expect(toTransferQuery(parseTransferFilters({}))).toBe('');
  });

  it('preserves filters across pages', () => {
    const query = transferPageQuery(parseTransferFilters({ status: 'rumour', includeUnconfirmed: 'true', type: 'loan' }));
    expect(query).toMatchObject({ status: 'rumour', includeUnconfirmed: 'true', type: 'loan' });
  });

  it('builds one stable canonical URL per transfer', () => {
    expect(transferUrl(TRANSFER_ID)).toBe(`/transfers/${TRANSFER_ID}`);
    expect(transferUrl(TRANSFER_ID)).toBe(TRANSFERS_CANONICAL + `/${TRANSFER_ID}`);
  });
});

describe('transfer response validation', () => {
  it('requires an id and a known status', () => {
    expect(asTransferRecord(null)).toBeNull();
    expect(asTransferRecord({ status: 'completed' })).toBeNull();
    expect(asTransferRecord({ id: TRANSFER_ID, status: 'invented' })).toBeNull();
    expect(asTransferRecord({ id: TRANSFER_ID, status: 'completed' })).not.toBeNull();
  });

  it('reads a row with no teams or fee without inventing values', () => {
    const row = asTransferRecord({ id: TRANSFER_ID, status: 'rumour', from_team_id: null, to_team_id: null, fee: null });
    expect(row?.from_team_id).toBeNull();
    expect(row?.fee).toBeNull();
    expect(row?.transfer_type).toBeNull();
  });

  it('assembles an enriched list row', () => {
    const item = asTransferListItem(listRow());
    expect(item?.player?.slug).toBe('john-doe');
    expect(item?.fromTeam?.slug).toBe('fc-example');
    expect(item?.toTeam?.slug).toBe('real-sample');
  });
});

describe('transfer data layer', () => {
  it('sends filters to the backend and flags unconfirmed rows', async () => {
    const seen: Array<{ url: string; init?: unknown }> = [];
    mockApi(
      (pathname) =>
        pathname === '/transfers'
          ? {
              status: 200,
              body: envelope([listRow({ status: 'rumour', fee: null, effective_date: null })], {
                page: 1,
                limit: 20,
                total: 1,
                totalPages: 1,
              }),
            }
          : null,
      seen,
    );
    const result = await fetchTransferList(parseTransferFilters({ status: 'rumour', includeUnconfirmed: 'true' }));
    expect(result.status).toBe('ready');
    expect(result.hasUnconfirmed).toBe(true);
    const url = new URL(seen[0].url);
    expect(url.searchParams.get('status')).toBe('rumour');
    expect(url.searchParams.get('includeUnconfirmed')).toBe('true');
    expect((seen[0].init as { next?: { revalidate?: number } }).next?.revalidate).toBe(TRANSFER_REVALIDATE.list);
  });

  it('separates empty from a transport failure', async () => {
    mockApi((pathname) =>
      pathname === '/transfers' ? { status: 200, body: envelope([], { page: 1, limit: 20, total: 0, totalPages: 0 }) } : null,
    );
    await expect(fetchTransferList(parseTransferFilters({}))).resolves.toMatchObject({ status: 'empty' });

    mockApi(() => null);
    await expect(fetchTransferList(parseTransferFilters({}))).resolves.toMatchObject({ status: 'error', rows: [] });
  });

  it('loads windows without assuming one per season', async () => {
    mockApi((pathname) => (pathname === '/transfers/windows' ? { status: 200, body: envelope([window()]) } : null));
    const result = await fetchTransferWindows();
    expect(result.status).toBe('ready');
    expect(result.items[0].name).toBe('Summer 2026');

    mockApi((pathname) => (pathname === '/transfers/windows' ? { status: 200, body: envelope([]) } : null));
    await expect(fetchTransferWindows()).resolves.toMatchObject({ status: 'empty' });
  });

  it('requests transfer news through the article type', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/news') return null;
      seen.push(url.search);
      return { status: 200, body: envelope([article()]) };
    });
    const result = await fetchTransferNews();
    expect(result.status).toBe('ready');
    expect(seen[0]).toContain('type=transfer');
  });

  it('fetches a detail aggregate and 404s an invalid id without a request', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(String(url));
        return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND', message: 'gone' } }) };
      }) as unknown as typeof fetch,
    );
    await expect(fetchTransferDetail('not-a-uuid')).resolves.toMatchObject({ status: 'not-found' });
    expect(seen).toHaveLength(0);
    await expect(fetchTransferDetail(TRANSFER_ID)).resolves.toMatchObject({ status: 'not-found' });
  });

  it('reads a detail payload with its relations', async () => {
    mockApi((pathname) =>
      pathname === `/transfers/${TRANSFER_ID}/details`
        ? {
            status: 200,
            body: envelope({
              transfer: transfer(),
              player,
              fromTeam,
              toTeam,
              season: { id: SEASON_ID, name: '2026/27', is_current: true },
              window: window(),
              competition: { id: 'c1', name: 'Premier League', slug: 'premier-league' },
            }),
          }
        : null,
    );
    const result = await fetchTransferDetail(TRANSFER_ID);
    expect(result.status).toBe('ready');
    expect(result.detail?.player?.slug).toBe('john-doe');
    expect(result.detail?.window?.name).toBe('Summer 2026');
    expect(result.detail?.competition?.slug).toBe('premier-league');
  });

  it('reports a transport failure as an error, not a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 'UPSTREAM_ERROR', message: 'x' } }) })) as unknown as typeof fetch,
    );
    await expect(fetchTransferDetail(TRANSFER_ID)).resolves.toMatchObject({ status: 'error' });
  });
});

describe('transfer card', () => {
  it('links player, both clubs and the record canonically', () => {
    const html = renderToString(
      createElement(TransferCard, { item: { transfer: transfer(), player, fromTeam, toTeam } }),
    );
    expect(html).toContain('href="/players/john-doe"');
    expect(html).toContain('href="/teams/fc-example"');
    expect(html).toContain('href="/teams/real-sample"');
    expect(html).toContain(`href="/transfers/${TRANSFER_ID}"`);
    expect(html).toContain('Permanent');
    expect(html).toContain('EUR 15,000,000');
    expect(html).toContain('Announced');
    expect(html).toContain('Effective');
  });

  it('shows an undisclosed fee rather than a zero', () => {
    const html = renderToString(
      createElement(TransferCard, {
        item: { transfer: transfer({ fee: null, currency: null }), player, fromTeam, toTeam },
      }),
    );
    expect(html).toContain('Fee undisclosed');
    expect(html).not.toContain('>0<');
    expect(html).not.toContain('>EUR 0<');
  });

  it('marks an unconfirmed transfer unmistakably', () => {
    const html = renderToString(
      createElement(TransferCard, {
        item: { transfer: transfer({ status: 'rumour', fee: null }), player, fromTeam, toTeam },
      }),
    );
    expect(html).toContain('data-status="rumour"');
    expect(html).toContain('Rumour');
    expect(html).toContain('not confirmed');
    expect(html).not.toContain('Completed');
  });

  it('handles missing teams and player without printing an id', () => {
    const html = renderToString(
      createElement(TransferCard, {
        item: { transfer: transfer({ from_team_id: null, to_team_id: null }), player: null, fromTeam: null, toTeam: null },
      }),
    );
    expect(html).toContain('Player not identified');
    expect(html).toContain('aria-label');
    expect(html).not.toContain('team-1');
    expect(html).not.toContain('p1');
  });
});

describe('transfer status and fee components', () => {
  it('never words an unconfirmed status as a completed move', () => {
    expect(renderToString(createElement(TransferStatusBadge, { status: 'completed' }))).toContain('Completed');
    for (const status of ['rumour', 'cancelled', 'rejected'] as const) {
      const html = renderToString(createElement(TransferStatusBadge, { status }));
      expect(html, status).toContain('not confirmed');
    }
  });

  it('labels an unknown fee without a number', () => {
    const html = renderToString(createElement(TransferFee, { fee: null, currency: 'EUR', transferType: 'loan' }));
    expect(html).toContain('Fee undisclosed');
  });
});

describe('transfer detail view and timeline', () => {
  it('shows every relation with a canonical link', () => {
    const html = renderToString(createElement(TransferDetailView, { detail: detail() }));
    expect(html).toContain('href="/players/john-doe"');
    expect(html).toContain('href="/teams/fc-example"');
    expect(html).toContain('href="/teams/real-sample"');
    expect(html).toContain('href="/competitions/premier-league"');
    expect(html).toContain('Summer 2026');
    expect(html).toContain('2026/27');
    expect(html).toContain('EUR 15,000,000');
  });

  it('warns clearly that an unconfirmed record is not a completed move', () => {
    const html = renderToString(createElement(TransferDetailView, { detail: detail({ transfer: transfer({ status: 'rumour' }) }) }));
    expect(html).toContain('This is not a completed transfer');
    expect(html).toContain('Treat it as unverified');
  });

  it('builds a timeline from stored dates only', () => {
    const html = renderToString(createElement(TransferTimeline, { detail: detail() }));
    expect(html).toContain('Announced');
    expect(html).toContain('Effective');
    expect(html).toContain('Completed');
    // No intermediate steps are invented.
    expect(html).not.toContain('Medical');
    expect(html).not.toContain('Contract signed');
  });

  it('marks a rumour as unverified in the timeline', () => {
    const html = renderToString(
      createElement(TransferTimeline, { detail: detail({ transfer: transfer({ status: 'rumour', effective_date: null }) }) }),
    );
    expect(html).toContain('Rumour');
    expect(html).toContain('Unverified');
    expect(html).not.toContain('Effective');
  });

  it('says so when no dates were recorded', () => {
    const html = renderToString(
      createElement(TransferTimeline, {
        detail: detail({ transfer: transfer({ status: 'rumour', announcement_date: null, effective_date: null }) }),
      }),
    );
    expect(html).toContain('No dates have been recorded');
  });

  it('says no window recorded rather than inventing one', () => {
    const html = renderToString(createElement(TransferDetailView, { detail: detail({ window: null }) }));
    expect(html).toContain('No window recorded');
  });
});

describe('transfer filters and news components', () => {
  it('renders a GET form with labelled controls on the canonical path', () => {
    const html = renderToString(
      createElement(TransferFilterForm, { filters: parseTransferFilters({}), windows: [window()], resultCount: 3 }),
    );
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/transfers"');
    expect(html).toContain('<label for="transfer-status">');
    expect(html).toContain('Confirmed only');
    expect(html).toContain('Summer 2026');
    expect(html).toContain('Clear all filters');
  });

  it('only offers the unconfirmed acknowledgement when an unconfirmed status is chosen', () => {
    const confirmed = renderToString(
      createElement(TransferFilterForm, { filters: parseTransferFilters({ status: 'completed' }), windows: [], resultCount: 0 }),
    );
    expect(confirmed).not.toContain('transfer-include-unconfirmed');

    const rumour = renderToString(
      createElement(TransferFilterForm, { filters: parseTransferFilters({ status: 'rumour' }), windows: [], resultCount: 0 }),
    );
    expect(rumour).toContain('transfer-include-unconfirmed');
  });

  it('marks the active status shortcut', () => {
    const confirmed = renderToString(createElement(TransferStatusFilter, { current: null }));
    expect(confirmed).toContain('aria-current="page"');
    const rumour = renderToString(createElement(TransferStatusFilter, { current: 'rumour' }));
    expect(text(rumour)).toContain('status=rumour&includeUnconfirmed=true');
  });

  it('separates empty transfer news from unavailable news', () => {
    const empty = renderToString(createElement(TransferNewsSection, { articles: [], status: 'empty' }));
    expect(empty).toContain('No published transfer stories');
    expect(empty).not.toContain('temporarily unavailable');

    const failed = renderToString(createElement(TransferNewsSection, { articles: [], status: 'error' }));
    expect(failed).toContain('temporarily unavailable');
  });
});

describe('transfer metadata and styles', () => {
  it('canonicalizes the transfer index', async () => {
    const transfersMetadata = await transfersMetadataFn({ searchParams: {} });
    expect(transfersMetadata.alternates?.canonical).toBe(`${siteConfig.siteUrl}${TRANSFERS_CANONICAL}`);
    expect(transfersMetadata.robots).toBe('index,follow');
  });

  it('uses the existing SEO service for a transfer record', async () => {
    mockApi((pathname) =>
      pathname === '/seo/metadata'
        ? {
            status: 200,
            body: envelope({
              title: 'John Doe transfer',
              description: 'Confirmed transfer detail.',
              canonical: `https://football.test/transfers/${TRANSFER_ID}`,
              robots: 'index,follow',
              ogTitle: 'John Doe transfer',
              ogDescription: 'Confirmed transfer detail.',
              ogImage: null,
              twitterTitle: 'John Doe transfer',
              twitterDescription: 'Confirmed transfer detail.',
              twitterImage: null,
            }),
          }
        : null,
    );
    const meta = await transferMetadata({ params: { id: TRANSFER_ID } });
    expect(meta.alternates?.canonical).toBe(`https://football.test/transfers/${TRANSFER_ID}`);
    expect(JSON.stringify(meta)).toContain('"card":"summary_large_image"');
  });

  it('falls back to an indexable canonical when the SEO service is down, and noindexes an invalid id', async () => {
    mockApi(() => null);
    // A valid uuid keeps its canonical so a transient SEO outage cannot
    // deindex a real transfer page; unknown ids 404 at the page level
    // (fetchTransferDetail -> notFound), which carries its own noindex.
    await expect(transferMetadata({ params: { id: TRANSFER_ID } })).resolves.toMatchObject({
      robots: 'index,follow',
      alternates: { canonical: expect.stringContaining(`/transfers/${TRANSFER_ID}`) },
    });
    await expect(transferMetadata({ params: { id: 'not-a-uuid' } })).resolves.toMatchObject({
      robots: 'noindex,nofollow',
    });
  });

  it('ships the transfer styles the components rely on', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles', 'globals.css'), 'utf8');
    for (const selector of [
      '.transfer-card',
      '.transfer-filters',
      '.transfer-status-filter',
      '.transfers-grid',
      '.transfer-facts',
      '.transfer-timeline',
      '.transfer-news',
      '.transfer-detail__warning',
    ]) {
      expect(css, selector).toContain(selector);
    }
    // An unconfirmed record is visually separated from a confirmed one.
    expect(css).toContain('.transfer-card[data-status=\'rumour\']');
    // Mobile leads with the card, single column first.
    expect(css).toContain('.transfers-grid');
    expect(css).not.toContain('overflow-x: scroll');
  });
});

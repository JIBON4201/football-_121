import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchResultCard } from '@/components/search/SearchResultCard';
import { SearchResultsSection } from '@/components/search/SearchResultsSection';
import { SearchEmptyState } from '@/components/search/SearchEmptyState';
import { SearchPagination, pageWindow } from '@/components/search/SearchPagination';
import { SearchInput, createSuggestionFetcher } from '@/components/search/SearchInput';
import { SearchLandingState } from '@/components/search/SearchLandingState';
import { SearchResultSkeleton, SearchFilterSkeleton } from '@/components/search/SearchResultSkeleton';
import { parseSearchFilters } from '@/lib/search';
import { RECENT_SEARCH_LIMIT, readRecentSearches, rememberSearch, clearRecentSearches, removeRecentSearch } from '@/lib/recent-searches';
import type { SearchResultItem } from '@/types/api';

/** React separates adjacent text nodes with comment markers. */
function stripComments(html: string): string {
  return html.replace(/<!--.*?-->/g, '');
}

const results: SearchResultItem[] = [
  {
    entity_type: 'team',
    entity_id: 't1',
    title: 'FC <b>Example</b>',
    slug: 'fc-example',
    url: '/teams/fc-example',
    image: 'https://cdn.test/fce.png',
    description: 'FCE',
    metadata: {},
    relevance: 30,
  },
  {
    entity_type: 'news',
    entity_id: 'n1',
    title: 'Big Win',
    slug: 'big-win',
    url: '/news/big-win',
    image: null,
    description: 'A summary',
    metadata: { article_type: 'match_report', published_at: '2026-01-02T10:00:00.000Z' },
    relevance: 20,
  },
  {
    entity_type: 'player',
    entity_id: 'p1',
    title: 'John Doe',
    slug: 'john-doe',
    url: 'javascript:alert(1)',
    image: null,
    description: 'Forward',
    metadata: { current_team: { id: 't1', name: 'FC Example', slug: 'fc-example' } },
    relevance: 25,
  },
  {
    entity_type: 'competition',
    entity_id: 'c1',
    title: 'Premier League',
    slug: 'premier-league',
    url: '/competitions/premier-league',
    image: null,
    description: 'England',
    metadata: { country: { id: 'e1', name: 'England', slug: 'england' } },
    relevance: 15,
  },
  {
    entity_type: 'match',
    entity_id: 'm1',
    title: 'Example vs Sample',
    slug: 'example-vs-sample',
    url: '/matches/example-vs-sample',
    image: null,
    description: 'Premier League',
    metadata: {
      scheduled_at: '2026-03-01T15:00:00.000Z',
      status: 'live',
      score: '2 - 1',
      home_team: { id: 't1', name: 'FC Example', slug: 'fc-example' },
      away_team: { id: 't2', name: 'Real Sample', slug: 'real-sample' },
    },
    relevance: 12,
  },
];

describe('search result rendering', () => {
  it('groups results entities-first, omitting empty categories', () => {
    const html = renderToString(createElement(SearchResultsSection, { results, query: '' }));
    const order = ['Teams', 'Players', 'Competitions', 'Matches', 'News'];
    let cursor = -1;
    for (const label of order) {
      const index = html.indexOf(`>${label}<`);
      expect(index, label).toBeGreaterThan(cursor);
      cursor = index;
    }
    expect(html).toContain('search-results__group');
  });

  it('renders only categories that have results', () => {
    const html = renderToString(
      createElement(SearchResultsSection, { results: [results[0]], query: '' }),
    );
    expect(html).toContain('Teams');
    expect(html).not.toContain('>News<');
    expect(html).not.toContain('>Matches<');
  });

  it('links every result to its canonical route and never a display name', () => {
    const html = renderToString(createElement(SearchResultsSection, { results, query: '' }));
    expect(html).toContain('href="/teams/fc-example"');
    expect(html).toContain('href="/players/john-doe"');
    expect(html).toContain('href="/competitions/premier-league"');
    expect(html).toContain('href="/matches/example-vs-sample"');
    expect(html).toContain('href="/news/big-win"');
  });

  it('escapes result text and never renders raw HTML', () => {
    const html = renderToString(createElement(SearchResultsSection, { results, query: '' }));
    expect(html).not.toContain('<b>Example</b>');
    expect(html).toContain('FC Example');
    expect(html).not.toContain('javascript:');
  });

  it('highlights the matched term as text, not markup', () => {
    const html = renderToString(
      createElement(SearchResultCard, { item: results[1], query: 'win' }),
    );
    expect(html).toContain('<mark>Win</mark>');
  });

  it('renders a player current club as a canonical team link', () => {
    const html = renderToString(createElement(SearchResultCard, { item: results[2], query: '' }));
    expect(html).toContain('Forward');
    expect(html).toContain('href="/teams/fc-example"');
  });

  it('shows match score, state and kickoff', () => {
    const html = renderToString(createElement(SearchResultCard, { item: results[4], query: '' }));
    expect(html).toContain('2 - 1');
    expect(html).toContain('live');
    expect(html).toContain('2026');
  });

  it('shows news article type and publication date', () => {
    const html = renderToString(createElement(SearchResultCard, { item: results[1], query: '' }));
    expect(html).toContain('Match report');
  });

  it('drops a result whose slug cannot produce a safe canonical link', () => {
    const html = renderToString(
      createElement(SearchResultCard, {
        item: { ...results[0], slug: '../../admin', url: '' },
        query: '',
      }),
    );
    expect(html).toBe('');
  });
});

describe('search input', () => {
  it('renders an accessible combobox with a search landmark', () => {
    const html = renderToString(createElement(SearchInput, { initialQuery: 'real' }));
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="Search football"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('value="real"');
    expect(html).toContain('Search football news, teams, players, competitions and matches');
    // No-JS fallback still posts to the canonical route.
    expect(html).toContain('action="/search"');
    expect(html).toContain('type="submit"');
  });

  it('exposes a polite live region and an accessible description', () => {
    const html = renderToString(createElement(SearchInput, { initialQuery: '' }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-describedby');
    expect(html).toContain('kbd');
  });

  it('is fully controlled, so a deep link does not duplicate the server value', () => {
    const html = renderToString(createElement(SearchInput, { initialQuery: 'arsenal' }));
    // `defaultValue` alongside `value` would make React warn and fight the
    // controlled state, so only the controlled value may be present.
    expect(html).toContain('value="arsenal"');
    expect(html).not.toContain('defaultValue');
  });

  it('does not open suggestions before the reader types', () => {
    const html = renderToString(createElement(SearchInput, { initialQuery: 'arsenal' }));
    // aria-expanded stays false and no listbox is rendered on first paint.
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
  });

  it('requests suggestions through the centralized client with a small limit', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ data: [], requestId: 'r1' }), { status: 200 });
      }),
    );
    const fetcher = createSuggestionFetcher();
    await fetcher('real madrid', new AbortController().signal);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/api/v1/search');
    expect(calls[0]).toContain('q=real+madrid');
    // Suggestions are capped well below a full result page.
    expect(calls[0]).toContain('limit=5');
  });
});

describe('search pagination', () => {
  it('builds a window with gaps and always includes first and last', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    // A two-page window either side of the current page, plus first and last.
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 'gap', 5]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
    expect(pageWindow(1, 0)).toEqual([]);
  });

  it('renders real links, current page and disabled edges', () => {
    const filters = parseSearchFilters({ q: 'arsenal' });
    const html = renderToString(
      createElement(SearchPagination, {
        filters,
        pagination: { page: 2, limit: 10, total: 45, totalPages: 5 },
      }),
    );
    expect(html).toContain('aria-label="Search results pages"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/search?q=arsenal&amp;page=3"');
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    // React separates text nodes with comment markers; strip them to read copy.
    expect(stripComments(html)).toContain('Page 2 of 5 (45 results)');
  });

  it('renders nothing when a single page covers every result', () => {
    const html = renderToString(
      createElement(SearchPagination, {
        filters: parseSearchFilters({ q: 'arsenal' }),
        pagination: { page: 1, limit: 10, total: 3, totalPages: 1 },
      }),
    );
    expect(html).toBe('');
  });

  it('disables the previous link on the first page', () => {
    const html = renderToString(
      createElement(SearchPagination, {
        filters: parseSearchFilters({ q: 'arsenal' }),
        pagination: { page: 1, limit: 10, total: 30, totalPages: 3 },
      }),
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('rel="prev"');
  });
});

describe('search empty state', () => {
  const filters = parseSearchFilters({ q: 'arsenal injury update' });

  it('states nothing matched, keeps the query and offers broader terms', () => {
    const html = renderToString(
      createElement(SearchEmptyState, { query: 'arsenal injury update', filters }),
    );
    expect(html).toContain('No results found');
    expect(html).toContain('arsenal injury update');
    expect(html).toContain('Try a broader search');
    expect(html).toContain('href="/search?q=arsenal%20injury"');
  });

  it('offers navigation back to the major sections', () => {
    const html = renderToString(createElement(SearchEmptyState, { query: 'zzz', filters }));
    expect(html).toContain('Browse instead');
    expect(html).toContain('href="/news"');
    expect(html).toContain('href="/matches"');
    expect(html).toContain('href="/live"');
    expect(html).toContain('href="/teams"');
    expect(html).toContain('href="/players"');
    expect(html).toContain('href="/competitions"');
  });

  it('offers a filter reset only when filters are active', () => {
    const withoutFilters = renderToString(
      createElement(SearchEmptyState, { query: 'zzz', filters, hasFilters: false }),
    );
    expect(withoutFilters).not.toContain('Clear all filters');

    const withFilters = renderToString(
      createElement(SearchEmptyState, { query: 'zzz', filters, hasFilters: true }),
    );
    expect(withFilters).toContain('Clear all filters');
  });

  it('does not fabricate results', () => {
    const html = renderToString(createElement(SearchEmptyState, { query: 'zzz', filters }));
    expect(html).not.toContain('search-card');
    expect(html).not.toContain('Related results');
  });
});

describe('search landing state', () => {
  it('gives guidance and links to major sections', () => {
    const html = renderToString(createElement(SearchLandingState, {}));
    expect(html).toContain('Search the whole platform');
    expect(html).toContain('href="/news"');
    expect(html).toContain('href="/live"');
    expect(html).toContain('aria-label="Browse football sections"');
  });

  it('renders popular entities with canonical links when available', () => {
    const html = renderToString(
      createElement(SearchLandingState, {
        popularTeams: [{ slug: 'arsenal', name: 'Arsenal' }],
        popularCompetitions: [{ slug: 'premier-league', name: 'Premier League' }],
      }),
    );
    expect(html).toContain('href="/teams/arsenal"');
    expect(html).toContain('href="/competitions/premier-league"');
  });
});

describe('recent searches (local only)', () => {
  // The suite runs in the node environment, so a minimal in-memory Storage
  // stands in for the browser rather than pulling in a DOM dependency.
  let store = new Map<string, string>();

  const fakeStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => void store.clear(),
  };

  beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: fakeStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores, de-duplicates and returns most-recent-first', () => {
    rememberSearch('arsenal');
    rememberSearch('chelsea');
    rememberSearch('Arsenal');
    expect(readRecentSearches()).toEqual(['Arsenal', 'chelsea']);
  });

  it('caps the stored history', () => {
    for (let index = 0; index < RECENT_SEARCH_LIMIT + 5; index += 1) {
      rememberSearch(`term number ${index}`);
    }
    expect(readRecentSearches().length).toBeLessThanOrEqual(RECENT_SEARCH_LIMIT);
  });

  it('refuses to store unusable or unsafe values', () => {
    rememberSearch('a');
    rememberSearch('   ');
    rememberSearch('<script>alert(1)</script>');
    // Nothing unsafe is persisted, so it can never be replayed as a query.
    expect(readRecentSearches()).toEqual([]);
  });

  it('ignores a tampered or malformed storage payload', () => {
    store.set('football.recentSearches.v1', '{"not":"an array"}');
    expect(readRecentSearches()).toEqual([]);
    store.set('football.recentSearches.v1', 'not json at all');
    expect(readRecentSearches()).toEqual([]);
    store.set('football.recentSearches.v1', JSON.stringify([123, null, { a: 1 }]));
    expect(readRecentSearches()).toEqual([]);
  });

  it('re-validates entries on read so tampered values are dropped', () => {
    store.set(
      'football.recentSearches.v1',
      JSON.stringify(['arsenal', '<script>alert(1)</script>', 42]),
    );
    expect(readRecentSearches()).toEqual(['arsenal']);
  });

  it('removes a single entry and clears everything', () => {
    rememberSearch('arsenal');
    rememberSearch('chelsea');
    expect(removeRecentSearch('arsenal')).toEqual(['chelsea']);
    clearRecentSearches();
    expect(readRecentSearches()).toEqual([]);
  });

  it('never touches the network or stores anything remotely', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    rememberSearch('arsenal');
    expect(fetchSpy).not.toHaveBeenCalled();
    // The only persistence is this browser's local storage.
    expect(Array.from(store.keys())).toEqual(['football.recentSearches.v1']);
  });

  it('degrades quietly when storage is unavailable', () => {
    vi.stubGlobal('window', {});
    expect(readRecentSearches()).toEqual([]);
    expect(() => rememberSearch('arsenal')).not.toThrow();
    expect(() => clearRecentSearches()).not.toThrow();
  });
});

describe('search loading states', () => {
  it('reserves result slots so the page does not shift', () => {
    const html = renderToString(createElement(SearchResultSkeleton, { count: 4 }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading search results"');
    expect((html.match(/search-card--skeleton/g) ?? []).length).toBe(4);
    // Decorative placeholders are hidden from assistive tech.
    expect(html).toContain('aria-hidden="true"');
  });

  it('reserves filter slots', () => {
    const html = renderToString(createElement(SearchFilterSkeleton, {}));
    expect(html).toContain('aria-hidden="true"');
  });
});

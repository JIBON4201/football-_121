import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  broadenQuery,
  buildSearchUrl,
  canonicalResultUrl,
  compactSuggestions,
  debounce,
  groupResultsByType,
  hasActiveFilters,
  highlightParts,
  isSearchableQuery,
  isSearchableType,
  nextActiveIndex,
  parseSearchFilters,
  parseSearchQuery,
  SEARCH_GROUP_LABELS,
  toSearchQueryString,
} from '@/lib/search';
import { isRenderableResult, toSearchParams } from '@/lib/search-server';
import type { SearchResultItem } from '@/types/api';

const item = (overrides: Partial<SearchResultItem> = {}): SearchResultItem => ({
  entity_type: 'news',
  entity_id: 'a1',
  title: 'Big Win',
  slug: 'big-win',
  url: '/news/big-win',
  image: null,
  description: null,
  metadata: {},
  relevance: 10,
  ...overrides,
});

describe('search logic (pure, DOM-free)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gates queries by length', () => {
    expect(isSearchableQuery('a')).toBe(false);
    expect(isSearchableQuery('ab')).toBe(true);
    expect(isSearchableQuery('   ')).toBe(false);
    expect(isSearchableQuery('x'.repeat(201))).toBe(false);
  });

  it('builds shareable canonical URLs and recovers state', () => {
    expect(buildSearchUrl('arsenal')).toBe('/search?q=arsenal');
    expect(buildSearchUrl('champions league')).toBe('/search?q=champions%20league');
    // An unusable query collapses to the plain route rather than a broken URL.
    expect(buildSearchUrl('  ')).toBe('/search');
    expect(buildSearchUrl('')).toBe('/search');
    expect(parseSearchQuery('?q=arsenal')).toBe('arsenal');
    expect(parseSearchQuery('q=arsenal')).toBe('arsenal');
    expect(parseSearchQuery('?q=champions%20league')).toBe('champions league');
    expect(parseSearchQuery('garbage')).toBe('');
  });

  it('serializes only validated filters, omitting defaults', () => {
    expect(toSearchQueryString({ query: 'arsenal' })).toBe('?q=arsenal');
    expect(toSearchQueryString({ query: 'arsenal', page: 1, type: null })).toBe('?q=arsenal');
    expect(toSearchQueryString({ query: 'arsenal', page: 3 })).toBe('?q=arsenal&page=3');
    expect(toSearchQueryString({ query: 'a', type: 'team', competition: 'premier-league' })).toBe(
      '?q=a&type=team&competition=premier-league',
    );
    // Invalid values are dropped, never serialized.
    expect(toSearchQueryString({ query: 'x', competition: '../../etc/passwd' })).toBe('?q=x');
    expect(toSearchQueryString({ query: 'x', from: 'yesterday' })).toBe('?q=x');
    expect(toSearchQueryString({ query: 'x', page: -4 })).toBe('?q=x');
  });

  it('parses filters from a query string and rejects malformed values', () => {
    const parsed = parseSearchFilters({
      q: '  Arsenal  ',
      type: 'team',
      competition: 'premier-league',
      team: 'arsenal',
      from: '2026-01-01',
      to: '2026-06-30',
      page: '2',
    });
    expect(parsed).toEqual({
      query: 'Arsenal',
      type: 'team',
      competition: 'premier-league',
      team: 'arsenal',
      from: '2026-01-01',
      to: '2026-06-30',
      page: 2,
    });

    // A hand-edited URL cannot inject a type, path or huge page.
    const hostile = parseSearchFilters({
      q: 'x',
      type: 'not-a-type',
      competition: '../../../etc/passwd',
      from: 'yesterday',
      page: '999999',
    });
    expect(hostile.type).toBeNull();
    expect(hostile.competition).toBeNull();
    expect(hostile.from).toBeNull();
    expect(hostile.page).toBe(1);
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parseSearchFilters({ q: ['arsenal', 'chelsea'] }).query).toBe('arsenal');
    expect(parseSearchFilters({ type: ['team', 'player'] }).type).toBe('team');
  });

  it('recognises the five searchable entity types', () => {
    for (const type of ['team', 'player', 'competition', 'match', 'news']) {
      expect(isSearchableType(type)).toBe(true);
      expect(SEARCH_GROUP_LABELS[type as keyof typeof SEARCH_GROUP_LABELS]).toBeTruthy();
    }
    expect(isSearchableType('transfer')).toBe(false);
    expect(isSearchableType('admin')).toBe(false);
  });

  it('reports which filters are narrowing the search', () => {
    const base = parseSearchFilters({ q: 'arsenal' });
    expect(hasActiveFilters(base)).toBe(false);
    expect(hasActiveFilters({ ...base, type: 'team' })).toBe(true);
    expect(hasActiveFilters({ ...base, from: '2026-01-01' })).toBe(true);
    // Page is not a filter: it does not narrow the result set.
    expect(hasActiveFilters({ ...base, page: 4 })).toBe(false);
  });

  it('groups results by entity type in a stable, entities-first order', () => {
    const groups = groupResultsByType([
      item({ entity_type: 'news', entity_id: 'n', title: 'N' }),
      item({ entity_type: 'match', entity_id: 'm', title: 'M' }),
      item({ entity_type: 'team', entity_id: 't', title: 'T' }),
      item({ entity_type: 'player', entity_id: 'p', title: 'P' }),
      item({ entity_type: 'competition', entity_id: 'c', title: 'C' }),
    ]);
    expect(groups.map((group) => group.type)).toEqual([
      'team',
      'player',
      'competition',
      'match',
      'news',
    ]);
    expect(groups.map((group) => group.label)).toEqual(['Teams', 'Players', 'Competitions', 'Matches', 'News']);
  });

  it('omits empty groups and preserves backend ordering within a group', () => {
    const groups = groupResultsByType([
      item({ entity_type: 'team', entity_id: 't1', title: 'First', relevance: 30 }),
      item({ entity_type: 'team', entity_id: 't2', title: 'Second', relevance: 20 }),
    ]);
    expect(groups).toHaveLength(1);
    // Ranking comes from the backend: the frontend must not re-sort.
    expect(groups[0].items.map((entry) => entry.title)).toEqual(['First', 'Second']);
  });

  it('drops results with an unknown entity type', () => {
    const groups = groupResultsByType([
      item({ entity_type: 'transfer' as never, entity_id: 'x' }),
      item({ entity_type: 'team', entity_id: 't1' }),
    ]);
    expect(groups.map((group) => group.type)).toEqual(['team']);
  });

  it('compacts suggestions per type so the dropdown stays small', () => {
    const many = [
      ...Array.from({ length: 8 }, (_, i) => item({ entity_type: 'team', entity_id: `t${i}` })),
      ...Array.from({ length: 8 }, (_, i) => item({ entity_type: 'player', entity_id: `p${i}` })),
      item({ entity_type: 'news', entity_id: 'n0' }),
    ];
    const compact = compactSuggestions(many, 2);
    expect(compact.filter((entry) => entry.entity_type === 'team')).toHaveLength(2);
    expect(compact.filter((entry) => entry.entity_type === 'player')).toHaveLength(2);
    expect(compact).toHaveLength(5);
  });

  it('resolves canonical result URLs and rejects unsafe ones', () => {
    expect(canonicalResultUrl(item({ entity_type: 'team', slug: 'arsenal', url: '/teams/arsenal' }))).toBe(
      '/teams/arsenal',
    );
    // A javascript: URL is discarded and rebuilt from the slug.
    expect(canonicalResultUrl(item({ entity_type: 'player', slug: 'saka', url: 'javascript:alert(1)' }))).toBe(
      '/players/saka',
    );
    // A URL pointing at the wrong base path is rebuilt.
    expect(canonicalResultUrl(item({ entity_type: 'team', slug: 'arsenal', url: '/news/arsenal' }))).toBe(
      '/teams/arsenal',
    );
    // Path traversal in the slug cannot escape the base path.
    expect(canonicalResultUrl(item({ entity_type: 'team', slug: '../../admin', url: '' }))).toBeNull();
  });

  it('navigates flat options with wrapping keys', () => {
    expect(nextActiveIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(nextActiveIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextActiveIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(nextActiveIndex(1, 'Home', 3)).toBe(0);
    expect(nextActiveIndex(1, 'End', 3)).toBe(2);
    expect(nextActiveIndex(1, 'Escape', 3)).toBe(1);
    expect(nextActiveIndex(0, 'ArrowDown', 0)).toBe(-1);
  });

  it('debounces rapid keystrokes into one call', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 250);
    debounced.call('a');
    debounced.call('ab');
    debounced.call('abc');
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('abc');
  });

  it('can cancel a pending debounce', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 250);
    debounced.call('a');
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('search highlighting', () => {
  it('splits text into plain segments without producing markup', () => {
    const parts = highlightParts('Arsenal beat Chelsea', 'arsenal');
    expect(parts).toEqual([
      { text: 'Arsenal', match: true },
      { text: ' beat Chelsea', match: false },
    ]);
    // No part ever contains a tag, so rendering cannot inject HTML.
    for (const part of parts) expect(part.text).not.toMatch(/[<>]/);
  });

  it('handles a query that looks like markup', () => {
    const parts = highlightParts('<script>alert(1)</script> wins', '<script>');
    expect(parts.every((part) => part.text !== '<script>')).toBe(true);
    expect(parts.map((part) => part.text).join('')).not.toContain('<script>');
  });

  it('strips markup from the source text before splitting', () => {
    const parts = highlightParts('FC <b>Example</b> United', 'example');
    expect(parts.map((part) => part.text).join(' ')).not.toContain('<b>');
  });

  it('highlights every occurrence, case-insensitively', () => {
    const parts = highlightParts('Arsenal and arsenal', 'Arsenal');
    expect(parts.filter((part) => part.match)).toHaveLength(2);
  });

  it('returns a single plain part for an empty query', () => {
    expect(highlightParts('Anything', '')).toEqual([{ text: 'Anything', match: false }]);
  });
});

describe('broader term suggestions', () => {
  it('offers genuinely broader queries and never the original back', () => {
    const broader = broadenQuery('arsenal injury update');
    expect(broader).toContain('arsenal injury');
    expect(broader).toContain('injury update');
    expect(broader).not.toContain('arsenal injury update');
  });

  it('offers nothing for a single short term', () => {
    expect(broadenQuery('go')).toEqual([]);
    expect(broadenQuery('')).toEqual([]);
  });
});

describe('search result validation', () => {
  it('accepts well-formed rows and rejects malformed ones', () => {
    expect(isRenderableResult(item())).toBe(true);
    expect(isRenderableResult({ entity_type: 'team' })).toBe(false);
    expect(isRenderableResult(null)).toBe(false);
    expect(isRenderableResult('nope')).toBe(false);
  });

  it('maps filters onto the API query without inventing parameters', () => {
    const filters = parseSearchFilters({ q: 'arsenal', type: 'team', from: '2026-01-01' });
    const params = toSearchParams(filters);
    expect(params).toEqual({ q: 'arsenal', limit: 10, type: 'team', from: '2026-01-01' });
    expect(params).not.toHaveProperty('competition');
    expect(params).not.toHaveProperty('page');
  });
});

import { describe, expect, it } from 'vitest';
import { activeNavRoute, isSectionActive, normalizePath, sectionRoute } from '@/lib/navigation';

describe('canonical navigation state', () => {
  it('resolves top-level sections', () => {
    expect(activeNavRoute('/')).toBe('home');
    expect(activeNavRoute('/news')).toBe('news');
    expect(activeNavRoute('/live')).toBe('live');
    expect(activeNavRoute('/matches')).toBe('matches');
    expect(activeNavRoute('/transfers')).toBe('transfers');
    expect(activeNavRoute('/competitions')).toBe('competitions');
    expect(activeNavRoute('/teams')).toBe('teams');
    expect(activeNavRoute('/players')).toBe('players');
  });

  it('inherits parent state for nested routes', () => {
    expect(activeNavRoute('/news/big-win')).toBe('news');
    expect(activeNavRoute('/matches/a-vs-b')).toBe('matches');
    expect(activeNavRoute('/teams/fc-example')).toBe('teams');
    expect(activeNavRoute('/players/john-doe')).toBe('players');
    expect(activeNavRoute('/competitions/premier-league')).toBe('competitions');
    expect(activeNavRoute('/breaking-news')).toBe('news');
  });

  it('ignores trailing slashes, queries and hashes (no duplicate canonicals)', () => {
    expect(activeNavRoute('/news/')).toBe('news');
    expect(activeNavRoute('/teams/fc-example?tab=squad')).toBe('teams');
    expect(activeNavRoute('/matches#today')).toBe('matches');
    expect(normalizePath('/news/?q=x#y')).toBe('/news');
    expect(normalizePath('/')).toBe('/');
  });

  it('returns null for utility and unknown routes', () => {
    expect(activeNavRoute('/search')).toBeNull();
    expect(activeNavRoute('/search?q=x')).toBeNull();
    expect(activeNavRoute('/admin/articles')).toBeNull();
    expect(activeNavRoute('/nope')).toBeNull();
  });

  it('maps sections back to single canonical listing routes', () => {
    expect(sectionRoute('news')).toBe('news');
    expect(sectionRoute('matches')).toBe('matches');
    expect(sectionRoute('home')).toBe('home');
    expect(isSectionActive('teams', '/teams/x')).toBe(true);
    expect(isSectionActive('news', '/matches')).toBe(false);
  });
});

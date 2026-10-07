/**
 * Admin -> public cache invalidation.
 *
 * This is the regression guard for a real defect: cache tags were attached to
 * every public read but nothing ever called `revalidateTag`, so an edit made in
 * the Control Center stayed invisible to readers until the longest `revalidate`
 * window expired (up to 3600s for directory data).
 *
 * `tests/setup.ts` stubs `next/cache` and records calls, so these assertions
 * check what actually happened rather than that a function exists.
 */
import { describe, expect, it } from 'vitest';
import { revalidatePathCalls, revalidateTagCalls, resetRevalidationCalls } from './setup';

/**
 * The exact tag strings the public read layer passes to `next.tags`.
 *
 * Listed literally rather than imported because the read layer builds them
 * inline; this file is the contract check that the two sides stay in step.
 */
const TAGS_THE_READ_LAYER_USES = [
  'news-list',
  'transfer-records',
  'transfers-list',
  'transfer-windows',
  'transfer-news',
  'teams-list',
  'players-list',
  'competitions-list',
  'homepage:matches',
  'homepage:live',
  'homepage:upcoming',
  'homepage:results',
  'homepage:latest',
  'homepage:teams',
  'homepage:players',
  'homepage:competitions',
  'homepage:transfers-feed',
  'matches:live',
  'matches:upcoming',
  'matches:results',
  'matches-list',
];

const ENTITIES = ['articles', 'matches', 'teams', 'players', 'competitions', 'seasons', 'venues', 'transfers', 'media'] as const;

describe('revalidatePublic', () => {
  it('purges the tagged news feeds and the public routes an article appears on', async () => {
    resetRevalidationCalls();
    const { revalidatePublic } = await import('@/lib/admin/revalidate');

    revalidatePublic('articles');

    // Tagged list feeds the reader actually hits.
    expect(revalidateTagCalls).toContain('news-list');
    expect(revalidateTagCalls).toContain('homepage:latest');
    // Articles are linked to matches, teams, players and competitions, so those
    // surfaces are stale too.
    expect(revalidateTagCalls).toContain('teams-list');
    expect(revalidateTagCalls).toContain('players-list');
    expect(revalidateTagCalls).toContain('competitions-list');

    // Untagged surfaces (SEO metadata, sitemaps) are purged by path.
    expect(revalidatePathCalls).toContain('/news');
    expect(revalidatePathCalls).toContain('/');
    expect(revalidatePathCalls).toContain('/sitemap.xml');
  });

  it('purges every live-score surface when a match changes', async () => {
    resetRevalidationCalls();
    const { revalidatePublic } = await import('@/lib/admin/revalidate');

    revalidatePublic('matches');

    for (const tag of ['homepage:live', 'homepage:upcoming', 'homepage:results', 'matches:live', 'matches:upcoming', 'matches:results', 'matches-list']) {
      expect(revalidateTagCalls).toContain(tag);
    }
    expect(revalidatePathCalls).toContain('/matches');
    expect(revalidatePathCalls).toContain('/live');
  });

  it('purges only the affected match detail when a slug is supplied', async () => {
    resetRevalidationCalls();
    const { revalidatePublic } = await import('@/lib/admin/revalidate');

    revalidatePublic('matches', { matchSlug: 'eastvale-v-northbridge' });

    expect(revalidateTagCalls).toContain('match-details:eastvale-v-northbridge');
    expect(revalidatePathCalls).toContain('/matches/eastvale-v-northbridge');
  });

  it('invalidates team edits on the surfaces that render teams', async () => {
    resetRevalidationCalls();
    const { revalidatePublic } = await import('@/lib/admin/revalidate');

    revalidatePublic('teams');

    expect(revalidateTagCalls).toContain('teams-list');
    expect(revalidateTagCalls).toContain('homepage:teams');
    expect(revalidatePathCalls).toContain('/teams');
    // A team change also moves matches (team sheets) and related news.
    expect(revalidatePathCalls).toContain('/matches');
  });

  it('invalidates transfers on both the list and the homepage feed', async () => {
    resetRevalidationCalls();
    const { revalidatePublic } = await import('@/lib/admin/revalidate');

    revalidatePublic('transfers');

    expect(revalidateTagCalls).toContain('transfers-list');
    expect(revalidateTagCalls).toContain('transfer-news');
    expect(revalidateTagCalls).toContain('transfer-windows');
    expect(revalidateTagCalls).toContain('homepage:transfers-feed');
    expect(revalidatePathCalls).toContain('/transfers');
  });

  it('accepts an explicit detail path for a single record', async () => {
    resetRevalidationCalls();
    const { revalidatePublic } = await import('@/lib/admin/revalidate');

    revalidatePublic('teams', { paths: ['/teams/eastvale-city'] });

    expect(revalidatePathCalls).toContain('/teams/eastvale-city');
  });

  it('never throws for an entity with no tags of its own', async () => {
    resetRevalidationCalls();
    const { revalidatePublic } = await import('@/lib/admin/revalidate');

    expect(() => revalidatePublic('seasons')).not.toThrow();
    expect(() => revalidatePublic('venues')).not.toThrow();
    expect(() => revalidatePublic('media')).not.toThrow();
  });
});

describe('tag coverage against the public read layer', () => {
  it('every tag the read layer emits is reachable from some admin write', async () => {
    const { publicTagsFor } = await import('@/lib/admin/revalidate');
    const reachable = new Set<string>();
    for (const entity of ENTITIES) {
      for (const tag of publicTagsFor(entity)) reachable.add(tag);
    }

    // 'match-details:<slug>' is dynamic and covered by its own test above.
    const unreachable = TAGS_THE_READ_LAYER_USES.filter((tag) => !reachable.has(tag));
    expect(unreachable).toEqual([]);
  });
});
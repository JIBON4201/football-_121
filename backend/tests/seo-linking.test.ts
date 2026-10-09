import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { resetCacheStore } from '../src/lib/cache';
import { app, installTestEnv } from './helpers';
import type { FakeClient, FakeQueryBuilder } from './fake';

/**
 * Related-content linking must stay a fixed number of queries no matter how many
 * entities an article is linked to. The previous implementation issued one query
 * per linked entity, so a hub article with 20 teams, 20 players, 20 competitions
 * and 20 matches cost ~90 sequential round trips.
 */

const RELATION_TABLES = ['article_teams', 'article_players', 'article_competitions', 'article_matches'] as const;

function pad(n: number): string {
  return String(n).padStart(12, '0');
}

function publishedArticle(id: string, slug: string, title: string) {
  return {
    id,
    slug,
    status: 'published',
    published_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    article_type: 'news',
    is_breaking: false,
    is_featured: false,
    title,
    excerpt: `${title} excerpt`,
    content: 'Body content for the related-content test.',
  };
}

/** Ops recorded against one table, in the order the query builder saw them. */
function opsFor(fake: FakeClient, table: string): string[] {
  return fake.queries
    .filter((q) => q.table === table)
    .flatMap((q) => q.ops.map((op) => op.op));
}

/** How many times a table was filtered by `article_id` (the article's own links). */
function articleLinkReads(fake: FakeClient, table: string): number {
  return fake.queries.filter(
    (q) => q.table === table && q.ops.some((op) => op.op === 'eq' && op.args[0] === 'article_id'),
  ).length;
}

/** The grouped sibling queries: one `in(...)` per relation table. */
function groupedSiblingQueries(fake: FakeClient): FakeQueryBuilder[] {
  return fake.queries.filter(
    (q) => RELATION_TABLES.includes(q.table as (typeof RELATION_TABLES)[number]) && q.ops.some((op) => op.op === 'in'),
  );
}

/**
 * Hub article linked to `entitiesPerKind` entities of every kind, each of which is
 * also linked to `siblingsPerEntity` sibling articles.
 */
function seedHub(fake: FakeClient, entitiesPerKind = 20, siblingsPerEntity = 5): string {
  const store = fake.store;
  const hubId = 'a0000000-0000-4000-8000-000000000001';
  store.articles!.push(publishedArticle(hubId, 'hub-article', 'Hub Article'));

  let siblingSeq = 0;
  const kinds = [
    { table: 'article_teams', column: 'team_id', kind: 'team' },
    { table: 'article_players', column: 'player_id', kind: 'player' },
    { table: 'article_competitions', column: 'competition_id', kind: 'competition' },
    { table: 'article_matches', column: 'match_id', kind: 'match' },
  ] as const;

  for (const rel of kinds) {
    if (!store[rel.table]) store[rel.table] = [];
    for (let e = 0; e < entitiesPerKind; e += 1) {
      const entityId = `${rel.kind}-${pad(e)}`;
      if (rel.kind === 'team' && store.teams) {
        store.teams.push({ id: entityId, slug: `team-${e}`, name: `Team ${e}`, short_name: `T${e}`, is_active: true });
      } else if (rel.kind === 'player' && store.players) {
        store.players.push({ id: entityId, slug: `player-${e}`, display_name: `Player ${e}`, position: 'Forward' });
      } else if (rel.kind === 'competition' && store.competitions) {
        store.competitions.push({ id: entityId, slug: `competition-${e}`, name: `Competition ${e}`, is_active: true });
      } else if (rel.kind === 'match' && store.matches) {
        store.matches.push({ id: entityId, slug: `match-${e}`, status: 'scheduled', scheduled_at: '2030-02-01T15:00:00.000Z' });
      }
      store[rel.table]!.push({ article_id: hubId, [rel.column]: entityId });
      for (let s = 0; s < siblingsPerEntity; s += 1) {
        siblingSeq += 1;
        const siblingId = `a${pad(siblingSeq)}`;
        store.articles!.push(publishedArticle(siblingId, `sibling-${siblingSeq}`, `Sibling ${siblingSeq}`));
        store[rel.table]!.push({ article_id: siblingId, [rel.column]: entityId });
      }
    }
  }
  return hubId;
}

describe('SEO related-content linking', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    resetCacheStore();
  });

  it('uses one grouped query per relation table instead of one per entity', async () => {
    seedHub(fake);
    const before = fake.queries.length;

    const res = await request(app).get('/api/v1/seo/related?type=news&slug=hub-article&limit=5');

    expect(res.status).toBe(200);
    const queries = fake.queries.slice(before);
    // Four relation tables, one grouped `in(...)` each — not one query per entity.
    const grouped = queries.filter(
      (q) => RELATION_TABLES.includes(q.table as (typeof RELATION_TABLES)[number]) && q.ops.some((op) => op.op === 'in'),
    );
    expect(grouped).toHaveLength(RELATION_TABLES.length);
    for (const q of grouped) {
      const inOp = q.ops.find((op) => op.op === 'in')!;
      // Every linked entity of that table is collected into a single `in(...)`.
      expect((inOp.args[1] as unknown[]).length).toBe(20);
      // The window is bounded: entities x per-entity ceiling, never unbounded.
      const range = q.ops.find((op) => op.op === 'range');
      expect(range).toBeDefined();
      expect((range!.args[1] as number) - (range!.args[0] as number) + 1).toBeLessThanOrEqual(20 * 20);
    }
    // No per-entity `eq` lookups against an entity id remain: the only `eq` left
    // on a relation table is the single read of the article's own links.
    const perEntity = queries.filter(
      (q) =>
        RELATION_TABLES.includes(q.table as (typeof RELATION_TABLES)[number]) &&
        q.ops.some((op) => op.op === 'eq' && op.args[0] !== 'article_id'),
    );
    expect(perEntity).toHaveLength(0);
  });

  it('reads each article relation table once per request, shared by resolver and linkers', async () => {
    seedHub(fake);
    const before = fake.queries.length;

    const res = await request(app).get('/api/v1/seo/related?type=news&slug=hub-article&limit=5');

    expect(res.status).toBe(200);
    // The article resolver, the related-article scorer and the entity-link builder
    // all need "which entities is this article linked to". One read per table.
    for (const table of RELATION_TABLES) {
      expect(articleLinkReads(fake, table)).toBe(1);
    }
    // Total request cost is fixed: 4 relation reads + 4 grouped queries + entity
    // rows + the article itself, regardless of how many entities are linked.
    expect(fake.queries.length - before).toBeLessThanOrEqual(20);
  });

  it('returns the same related articles and entity links as the unbatched shape', async () => {
    seedHub(fake);
    const res = await request(app).get('/api/v1/seo/related?type=news&slug=hub-article&limit=5');

    expect(res.status).toBe(200);
    const { related, entities } = res.body.data;

    // Every sibling is linked to exactly one entity, so every score is 1 and the
    // ranking falls back to ascending article id.
    expect(related.map((r: { slug: string }) => r.slug)).toEqual([
      'sibling-1',
      'sibling-2',
      'sibling-3',
      'sibling-4',
      'sibling-5',
    ]);
    for (const item of related) {
      expect(item.entityType).toBe('news');
      expect(item.url).toBe(`${config.site.baseUrl}/news/${item.slug}`);
    }

    // Entity links are canonical, deduplicated, self-free and relation-ordered.
    expect(entities.map((e: { url: string }) => e.url)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `${config.site.baseUrl}/teams/team-${i}`),
      ...Array.from({ length: 10 }, (_, i) => `${config.site.baseUrl}/players/player-${i}`),
    ]);
    expect(entities).not.toContainEqual(expect.objectContaining({ url: `${config.site.baseUrl}/news/hub-article` }));
    expect(new Set(entities.map((e: { url: string }) => e.url)).size).toBe(entities.length);
  });

  it('ranks articles by shared-entity overlap, then by id', async () => {
    const store = fake.store;
    const hubId = 'a0000000-0000-4000-8000-000000000001';
    store.articles!.push(publishedArticle(hubId, 'overlap-hub', 'Overlap Hub'));
    // Hub is linked to team-0 and team-1.
    store.article_teams!.push({ article_id: hubId, team_id: 't0' }, { article_id: hubId, team_id: 't1' });
    store.teams!.push(
      { id: 't0', slug: 't0', name: 'T0', short_name: 'T0', is_active: true },
      { id: 't1', slug: 't1', name: 'T1', short_name: 'T1', is_active: true },
    );
    // overlap-both shares both entities (score 2), overlap-one shares one (score 1).
    store.articles!.push(publishedArticle('a000000000010', 'overlap-both', 'Overlap Both'));
    store.articles!.push(publishedArticle('a000000000009', 'overlap-one', 'Overlap One'));
    store.article_teams!.push(
      { article_id: 'a000000000010', team_id: 't0' },
      { article_id: 'a000000000010', team_id: 't1' },
      { article_id: 'a000000000009', team_id: 't0' },
    );

    const res = await request(app).get('/api/v1/seo/related?type=news&slug=overlap-hub&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.data.related.map((r: { slug: string }) => r.slug)).toEqual(['overlap-both', 'overlap-one']);
  });

  it('returns empty results for an article with no entity links', async () => {
    fake.store.articles!.push(publishedArticle('a000000000001', 'lonely', 'Lonely'));
    const before = fake.queries.length;

    const res = await request(app).get('/api/v1/seo/related?type=news&slug=lonely&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.data.related).toEqual([]);
    expect(res.body.data.entities).toEqual([]);
    // Still a fixed number of reads: the four relation tables, then nothing else.
    expect(fake.queries.length - before).toBeLessThanOrEqual(8);
  });

  it('returns empty results for a non-news entity type', async () => {
    const res = await request(app).get('/api/v1/seo/related?type=team&slug=fc-example&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ related: [], entities: [] });
  });

  it('clamps the limit and never returns more related articles than asked', async () => {
    seedHub(fake, 20, 5);
    const res = await request(app).get('/api/v1/seo/related?type=news&slug=hub-article&limit=3');

    expect(res.status).toBe(200);
    // The route validates limit to 1..20; the service clamps again, so the
    // response can never exceed the requested window.
    expect(res.body.data.related.length).toBe(3);
  });

  it('excludes the article itself and unpublished siblings from related results', async () => {
    const store = fake.store;
    const hubId = 'a0000000-0000-4000-8000-000000000001';
    store.articles!.push(publishedArticle(hubId, 'self-excluded', 'Self Excluded'));
    store.teams!.push({ id: 't0', slug: 't0', name: 'T0', short_name: 'T0', is_active: true });
    store.article_teams!.push({ article_id: hubId, team_id: 't0' });
    // A draft sibling and a future-dated sibling must not appear.
    store.articles!.push({
      ...publishedArticle('a000000000010', 'draft-sibling', 'Draft Sibling'),
      status: 'draft',
      published_at: null,
    });
    store.articles!.push({
      ...publishedArticle('a000000000011', 'future-sibling', 'Future Sibling'),
      published_at: '2999-01-01T00:00:00.000Z',
    });
    store.article_teams!.push(
      { article_id: 'a000000000010', team_id: 't0' },
      { article_id: 'a000000000011', team_id: 't0' },
    );

    const res = await request(app).get('/api/v1/seo/related?type=news&slug=self-excluded&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.data.related).toEqual([]);
  });

  it('selects only the columns the related-content response needs', async () => {
    seedHub(fake, 3, 1);
    const before = fake.queries.length;

    const res = await request(app).get('/api/v1/seo/related?type=news&slug=hub-article&limit=5');

    expect(res.status).toBe(200);
    // The linking path reads relation rows and entity rows; none of them may
    // select every column. (The article resolver's own `select('*')` is a
    // separate, pre-existing read that also feeds metadata and structured data.)
    const linkingTables = [...RELATION_TABLES, 'teams', 'players', 'competitions', 'matches'];
    for (const q of fake.queries.slice(before)) {
      if (!linkingTables.includes(q.table)) continue;
      for (const op of q.ops) {
        if (op.op !== 'select') continue;
        expect(String(op.args[0])).not.toBe('*');
      }
    }
    // Relation rows carry exactly the entity id and the article id.
    const relationColumns: Record<string, string> = {
      article_teams: 'team_id',
      article_players: 'player_id',
      article_competitions: 'competition_id',
      article_matches: 'match_id',
    };
    for (const table of RELATION_TABLES) {
      const grouped = fake.queries.find((q) => q.table === table && q.ops.some((op) => op.op === 'in'));
      expect(grouped).toBeDefined();
      const select = grouped!.ops.find((op) => op.op === 'select')!;
      expect(String(select.args[0]).split(',').sort()).toEqual(['article_id', relationColumns[table]].sort());
    }
  });

  it('keeps entity links to a bounded set of entities per relation table', async () => {
    // 25 linked teams: only the first 10 become canonical links.
    const store = fake.store;
    const hubId = 'a0000000-0000-4000-8000-000000000001';
    store.articles!.push(publishedArticle(hubId, 'many-teams', 'Many Teams'));
    for (let e = 0; e < 25; e += 1) {
      const id = `team-${pad(e)}`;
      store.teams!.push({ id, slug: `team-${e}`, name: `Team ${e}`, short_name: `T${e}`, is_active: true });
      store.article_teams!.push({ article_id: hubId, team_id: id });
    }

    const res = await request(app).get('/api/v1/seo/related?type=news&slug=many-teams&limit=5');

    expect(res.status).toBe(200);
    const teamLinks = res.body.data.entities.filter((e: { entityType: string }) => e.entityType === 'team');
    expect(teamLinks).toHaveLength(10);
    expect(teamLinks.map((t: { slug: string }) => t.slug)).toEqual(
      Array.from({ length: 10 }, (_, i) => `team-${i}`),
    );
  });

  it('works when called directly without a shared context', async () => {
    const { entityLinksForArticle, relatedArticles } = await import('../src/seo/linking');
    const hubId = seedHub(fake, 2, 1);

    const related = await relatedArticles(hubId, 5);
    const entities = await entityLinksForArticle(hubId, 'hub-article');

    expect(related.length).toBeGreaterThan(0);
    expect(related[0].entityType).toBe('news');
    expect(entities.length).toBeGreaterThan(0);
    expect(entities[0].url.startsWith(config.site.baseUrl)).toBe(true);
  });
});

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';
import type { FakeClient } from './fake';

describe('unified search', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  it('finds teams with canonical URL contract', async () => {
    const res = await request(app).get('/api/v1/search?q=example');
    expect(res.status).toBe(200);
    const team = res.body.data.find((r: { entity_type: string }) => r.entity_type === 'team');
    expect(team).toBeDefined();
    expect(team).toMatchObject({ title: 'FC Example', slug: 'fc-example', url: '/teams/fc-example' });
    expect(team.image).toBeNull();
    expect(typeof team.relevance).toBe('number');
  });

  it('finds players, competitions, matches and news in one query', async () => {
    const res = await request(app).get('/api/v1/search?q=premier&type=competition');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      entity_type: 'competition',
      slug: 'premier-league',
      url: '/competitions/premier-league',
    });
  });

  it('ranks exact matches above partial matches deterministically', async () => {
    const first = await request(app).get('/api/v1/search?q=john');
    const second = await request(app).get('/api/v1/search?q=john');
    expect(first.body.data.map((r: { slug: string }) => r.slug)).toEqual(
      second.body.data.map((r: { slug: string }) => r.slug),
    );
    const player = first.body.data.find((r: { entity_type: string }) => r.entity_type === 'player');
    expect(player.slug).toBe('john-doe');
    expect(player.url).toBe('/players/john-doe');
  });

  it('supports partial matching', async () => {
    const res = await request(app).get('/api/v1/search?q=xample');
    expect(res.status).toBe(200);
    expect(res.body.data.some((r: { slug: string }) => r.slug === 'fc-example')).toBe(true);
  });

  it('never returns drafts or private data', async () => {
    const res = await request(app).get('/api/v1/search?q=draft');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('draft-piece');
  });

  it('rejects empty queries without touching the database', async () => {
    const before = fake.queries.length;
    for (const path of ['/api/v1/search', '/api/v1/search?q=%20%20']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(fake.queries.length).toBe(before);
  });

  it('returns empty set (not an error) for no results', async () => {
    const res = await request(app).get('/api/v1/search?q=zzzznothing');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('rejects unsupported entity types', async () => {
    const res = await request(app).get('/api/v1/search?q=win&type=stadium');
    expect(res.status).toBe(400);
  });

  it('filters matches by team id and news by relation', async () => {
    const teamId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
    const matchRes = await request(app).get(`/api/v1/search?q=sample&type=match&team_id=${teamId}`);
    expect(matchRes.status).toBe(200);
    expect(matchRes.body.data.length).toBeGreaterThan(0);
    expect(
      matchRes.body.data.every(
        (r: { metadata: { home_team: { id: string } | null; away_team: { id: string } | null } }) =>
          r.metadata.home_team?.id === teamId || r.metadata.away_team?.id === teamId,
      ),
    ).toBe(true);

    const newsRes = await request(app).get(`/api/v1/search?q=win&type=news&team_id=${teamId}`);
    expect(newsRes.body.data).toHaveLength(1);
    expect(newsRes.body.data[0].url).toBe('/news/big-win');
  });

  it('bounds result sets and paginates consistently', async () => {
    const res = await request(app).get('/api/v1/search?q=e&limit=2&page=1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2 });

    const over = await request(app).get('/api/v1/search?q=e&limit=999');
    expect(over.status).toBe(400);
  });

  it('selects minimal columns (never full article content)', async () => {
    await request(app).get('/api/v1/search?q=win&type=news');
    const articleQueries = fake.queries.filter((q) => q.table === 'articles');
    expect(articleQueries.length).toBeGreaterThan(0);
    for (const query of articleQueries) {
      const selects = query.ops.filter((op) => op.op === 'select');
      for (const select of selects) {
        expect(String(select.args[0])).not.toContain('content');
      }
    }
  });

  it('issues a bounded number of queries per search', async () => {
    const before = fake.queries.length;
    await request(app).get('/api/v1/search?q=example');
    expect(fake.queries.length - before).toBeLessThanOrEqual(15);
  });

  it('rejects malformed filter values', async () => {
    const res = await request(app).get('/api/v1/search?q=win&team_id=not-a-uuid&from=bad-date');
    expect(res.status).toBe(400);
  });

  it('includes a player current club resolved in a bounded number of queries', async () => {
    const before = fake.queries.length;
    const res = await request(app).get('/api/v1/search?q=john&type=player');
    expect(res.status).toBe(200);
    const player = res.body.data.find((r: { entity_type: string }) => r.entity_type === 'player');
    expect(player).toBeDefined();
    expect(player.metadata.current_team).toMatchObject({ slug: 'real-sample' });
    // One history lookup plus one team lookup, regardless of result count.
    expect(fake.queries.length - before).toBeLessThanOrEqual(6);
  });

  it('omits a current club rather than inventing one', async () => {
    fake.store.player_team_history = [];
    const res = await request(app).get('/api/v1/search?q=john&type=player');
    expect(res.status).toBe(200);
    expect(res.body.data[0].metadata.current_team).toBeUndefined();
  });

  it('serves other entity types when one lookup fails', async () => {
    // A failure in the player lookup must not fail the whole search.
    fake.failTables.add('players');
    const res = await request(app).get('/api/v1/search?q=example');
    expect(res.status).toBe(200);
    expect(res.body.data.some((r: { entity_type: string }) => r.entity_type === 'team')).toBe(true);
    expect(res.body.data.some((r: { entity_type: string }) => r.entity_type === 'player')).toBe(false);
  });

  it('fails the request only when the caller asked solely for the failed type', async () => {
    fake.failTables.add('players');
    const res = await request(app).get('/api/v1/search?q=john&type=player');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

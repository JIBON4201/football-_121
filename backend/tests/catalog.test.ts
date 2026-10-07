import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';

describe('catalog APIs (teams, players, competitions, transfers)', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('teams: list, search, detail, 404', async () => {
    const list = await request(app).get('/api/v1/teams');
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBe(2);

    const search = await request(app).get('/api/v1/teams?q=example');
    expect(search.body.data).toHaveLength(1);

    const detail = await request(app).get('/api/v1/teams/fc-example');
    expect(detail.status).toBe(200);

    const missing = await request(app).get('/api/v1/teams/no-such-team');
    expect(missing.status).toBe(404);
  });

  it('teams: rejects invalid active flag', async () => {
    const res = await request(app).get('/api/v1/teams?active=maybe');
    expect(res.status).toBe(400);
  });

  it('players: list, position filter, detail', async () => {
    const list = await request(app).get('/api/v1/players');
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBe(1);

    const filtered = await request(app).get('/api/v1/players?position=Forward');
    expect(filtered.body.data).toHaveLength(1);

    const detail = await request(app).get('/api/v1/players/john-doe');
    expect(detail.status).toBe(200);

    const missing = await request(app).get('/api/v1/players/jane-doe');
    expect(missing.status).toBe(404);
  });

  it('competitions: list, active filter, detail', async () => {
    const list = await request(app).get('/api/v1/competitions');
    expect(list.status).toBe(200);

    const active = await request(app).get('/api/v1/competitions?active=true');
    expect(active.body.data).toHaveLength(1);

    const detail = await request(app).get('/api/v1/competitions/premier-league');
    expect(detail.status).toBe(200);
  });

  it('transfers: only announced/completed are visible', async () => {
    const list = await request(app).get('/api/v1/transfers');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].status).toBe('completed');
  });

  it('transfers: rumours are rejected as a filter and hidden by id', async () => {
    const badFilter = await request(app).get('/api/v1/transfers?status=rumour');
    expect(badFilter.status).toBe(400);

    const hidden = await request(app).get('/api/v1/transfers/33333333-3333-4333-8333-333333333333');
    expect(hidden.status).toBe(404);

    const found = await request(app).get('/api/v1/transfers/11111111-1111-4111-8111-111111111111');
    expect(found.status).toBe(200);

    const badId = await request(app).get('/api/v1/transfers/not-a-uuid');
    expect(badId.status).toBe(400);
  });
});

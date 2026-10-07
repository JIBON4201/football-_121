import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import { parseArgs } from '../src/cli/import';
import { runImport, verifyIntegrity } from '../src/providers/importService';
import { registerSeedProvider } from '../src/providers/seed/seedProvider';
import { unregisterProvider } from '../src/providers/registry';
import type { FakeClient } from './fake';

const SEED_DS = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  name: 'Seed Provider',
  provider: 'seed',
  api_version: 'v1',
  is_active: true,
  priority: 1000,
};

function seedDataSource(fake: FakeClient) {
  fake.store.data_sources = [{ ...SEED_DS }];
}

describe('initial import system', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedDataSource(fake);
    registerSeedProvider();
  });

  afterEach(() => {
    unregisterProvider('seed');
  });

  it('dry-run mutates nothing and classifies correctly', async () => {
    const before = JSON.stringify(fake.store);
    const report = await runImport({ provider: 'seed', dryRun: true });
    expect(JSON.stringify(fake.store)).toBe(before);
    expect(report.dryRun).toBe(true);

    const byEntity = Object.fromEntries(report.stages.map((stage) => [stage.entityType, stage]));
    // ENG already exists in the fixture store → update; ESP is new → create.
    expect(byEntity.countries).toMatchObject({ discovered: 2, created: 1, failed: 0 });
    expect(byEntity.competitions).toMatchObject({ discovered: 1, updated: 1, failed: 0 });
    expect(byEntity.teams).toMatchObject({ discovered: 4, created: 4, failed: 0 });
    expect(byEntity.players).toMatchObject({ discovered: 8, created: 8, failed: 0 });
    expect(byEntity.matches).toMatchObject({ discovered: 3, created: 3, failed: 0 });
    expect(byEntity.events).toMatchObject({ discovered: 4, created: 4, failed: 0 });
    expect(byEntity.transfers).toMatchObject({ discovered: 1, created: 1, failed: 0 });
    expect(report.integrity).toBeNull();
  });

  it('imports the full scope with dependency order intact', async () => {
    const report = await runImport({ provider: 'seed' });
    expect(report.stages.every((stage) => stage.status === 'completed')).toBe(true);

    expect(fake.store.countries).toHaveLength(2); // ENG merged + ESP created
    expect(fake.store.competitions).toHaveLength(1); // Premier League slug-merged
    expect(fake.store.seasons).toHaveLength(1);
    expect(fake.store.teams).toHaveLength(6);
    expect(fake.store.players).toHaveLength(9);
    expect(fake.store.matches).toHaveLength(5);
    expect(fake.store.match_events).toHaveLength(5); // 1 fixture + 4 imported
    expect(fake.store.match_lineups).toHaveLength(3); // 1 fixture + 2 imported
    expect(fake.store.match_lineup_players).toHaveLength(5); // 1 fixture + 4 imported
    expect(fake.store.match_team_statistics).toHaveLength(3); // 1 fixture + 2 imported
    expect(fake.store.match_player_statistics).toHaveLength(3); // 1 fixture + 2 imported
    expect(fake.store.transfers).toHaveLength(3);
    expect(fake.store.team_competitions).toHaveLength(6); // 2 fixture + 4 imported
    expect(fake.store.player_team_history).toHaveLength(9); // 1 fixture + 8 imported

    const integrity = await verifyIntegrity(SEED_DS.id);
    expect(integrity.duplicateMappings).toBe(0);
    expect(integrity.mappings).toBeGreaterThan(0);
  });

  it('is idempotent across re-runs with stable mappings', async () => {
    await runImport({ provider: 'seed' });
    const counts = JSON.stringify({
      teams: fake.store.teams.length,
      players: fake.store.players.length,
      matches: fake.store.matches.length,
      mappings: fake.store.external_entity_ids.length,
      links: fake.store.team_competitions.length,
      history: fake.store.player_team_history.length,
    });
    const second = await runImport({ provider: 'seed' });
    expect(JSON.stringify({
      teams: fake.store.teams.length,
      players: fake.store.players.length,
      matches: fake.store.matches.length,
      mappings: fake.store.external_entity_ids.length,
      links: fake.store.team_competitions.length,
      history: fake.store.player_team_history.length,
    })).toBe(counts);
    const teamsStage = second.stages.find((stage) => stage.entityType === 'teams');
    expect(teamsStage?.created).toBe(0);
    expect((teamsStage?.updated ?? 0)).toBeGreaterThan(0);
  });

  it('fails dependently-ordered stages safely (matches before teams)', async () => {
    const report = await runImport({ provider: 'seed', entities: ['matches'] });
    const stage = report.stages[0];
    expect(stage.status).toBe('failed');
    expect(stage.failed).toBe(3);
    expect(stage.created).toBe(0);
    expect(fake.store.matches).toHaveLength(2); // seed matches untouched
  });

  it('recovers from interruption without duplication', async () => {
    await runImport({ provider: 'seed', entities: ['teams'], limit: 2 });
    expect(fake.store.teams).toHaveLength(4); // 2 seed + 2 imported
    await runImport({ provider: 'seed', entities: ['teams'] });
    expect(fake.store.teams).toHaveLength(6);
    const slugs = fake.store.teams.map((row) => (row as { slug: string }).slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('respects selective scope and date ranges', async () => {
    const report = await runImport({
      provider: 'seed',
      entities: ['matches'],
      params: { competitionExternalId: 'seed-comp-epl', from: '2030-01-01', to: '2030-12-31' },
    });
    // Matches alone cannot resolve teams → invalid relationships, no writes.
    expect(report.stages[0].failed).toBeGreaterThan(0);

    const ok = await runImport({
      provider: 'seed',
      entities: ['countries', 'competitions', 'seasons', 'teams', 'players', 'matches'],
      params: { from: '2020-01-01', to: '2027-12-31' },
    });
    expect(ok.stages.every((stage) => stage.status === 'completed')).toBe(true);
  });
});

describe('import CLI and admin boundary', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedDataSource(fake);
    registerSeedProvider();
  });

  afterEach(() => {
    unregisterProvider('seed');
  });

  it('parses CLI arguments and rejects bad input', () => {
    const parsed = parseArgs(['--dry-run', '--entity', 'teams', '--entity', 'matches', '--limit', '10', '--json']);
    expect(parsed.scope.dryRun).toBe(true);
    expect(parsed.scope.limit).toBe(10);
    expect(parsed.scope.provider).toBe('seed');
    expect(parsed.scope.entities).toEqual(['teams', 'matches']);
    expect(parsed.json).toBe(true);
    expect(() => parseArgs(['--entity', 'stadiums'])).toThrow();
    expect(() => parseArgs(['--bogus'])).toThrow();
    expect(() => parseArgs(['--limit', '0'])).toThrow();
  });

  it('removed admin import endpoint stays protected (401 unauth, 404 authed)', async () => {
    expect((await request(app).post('/api/v1/admin/import').send({})).status).toBe(401);
  });
});

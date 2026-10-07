import { beforeEach, describe, expect, it } from 'vitest';
import { providerConfigFromEnv, redactedConfig, validateProviderConfig } from '../src/providers/config';
import {
  MappingConflictError,
  lookupMapping,
  saveMapping,
} from '../src/providers/externalIds';
import {
  normalizeCountryCode,
  normalizeCurrency,
  normalizeDateTime,
  normalizeFoot,
  slugify,
} from '../src/providers/normalize';
import { resolveEntity } from '../src/providers/resolver';
import { NormalizedMatchSchema, NormalizedTeamSchema, validateRecord } from '../src/providers/validation';
import { serviceClient } from '../src/lib/supabase';
import { installTestEnv } from './helpers';
import type { FakeClient } from './fake';

describe('provider core (normalize, validate, config, mappings)', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  it('normalizes slugs, codes, dates and enums', () => {
    expect(slugify('Real Madrid CF', 'x')).toBe('real-madrid-cf');
    expect(slugify('!!!', 'ext-9')).toMatch(/^entity-/);
    expect(normalizeCountryCode('eng')).toBe('ENG');
    expect(normalizeCountryCode('xx1')).toBeUndefined();
    expect(normalizeDateTime('2026-09-01T15:00:00Z')).toBe('2026-09-01T15:00:00.000Z');
    expect(normalizeDateTime('tomorrow')).toBeUndefined();
    expect(normalizeFoot('Left')).toBe('left');
    expect(normalizeFoot('middle')).toBeUndefined();
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency('USDD')).toBeUndefined();
  });

  it('validates normalized records with stable codes', async () => {
    const good = validateRecord(NormalizedTeamSchema, { externalId: 'x1', name: 'FC Test' });
    expect(good.ok).toBe(true);

    const missing = validateRecord(NormalizedTeamSchema, { externalId: 'x1' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.failure.code).toBe('MISSING_FIELD');

    const badEnum = validateRecord(NormalizedMatchSchema, {
      externalId: 'x1',
      competitionExternalId: 'c1',
      homeTeamExternalId: 'h1',
      awayTeamExternalId: 'a1',
      scheduledAt: '2026-09-01T15:00:00.000Z',
      status: 'playing',
    });
    expect(badEnum.ok).toBe(false);
    if (!badEnum.ok) expect(badEnum.failure.code).toBe('INVALID_ENUM');
  });

  it('validates provider config and redacts secrets', () => {
    process.env.PROVIDER_DEMO_BASE_URL = 'https://api.example.com';
    process.env.PROVIDER_DEMO_API_KEY = 'TOP-SECRET';
    const cfg = providerConfigFromEnv('PROVIDER_DEMO');
    expect(validateProviderConfig(cfg)).toEqual([]);
    const safe = redactedConfig(cfg);
    expect(safe).toMatchObject({ hasApiKey: true });
    expect(JSON.stringify(safe)).not.toContain('TOP-SECRET');

    delete process.env.PROVIDER_DEMO_BASE_URL;
    expect(validateProviderConfig(providerConfigFromEnv('PROVIDER_DEMO'))).toContain('baseUrl is required');
    delete process.env.PROVIDER_DEMO_API_KEY;
  });

  it('creates, looks up and updates external mappings', async () => {
    const client = serviceClient();
    expect(await lookupMapping(client, 'ds1', 'team', 'ext-1')).toBeNull();
    expect(await saveMapping(client, 'ds1', 'team', 'ext-1', 'team-uuid-1')).toBe('created');
    expect(await lookupMapping(client, 'ds1', 'team', 'ext-1')).toBe('team-uuid-1');
    expect(await saveMapping(client, 'ds1', 'team', 'ext-1', 'team-uuid-1')).toBe('updated');
  });

  it('detects mapping conflicts without leaking internals', async () => {
    const client = serviceClient();
    await saveMapping(client, 'ds1', 'team', 'ext-a', 'team-uuid-1');
    await expect(saveMapping(client, 'ds1', 'team', 'ext-b', 'team-uuid-1')).rejects.toBeInstanceOf(
      MappingConflictError,
    );
  });

  it('resolves entities by mapping, slug match, missing and ambiguous', async () => {
    const client = serviceClient();
    await saveMapping(client, 'ds1', 'team', 'ext-known', 'team-uuid-9');
    expect(
      await resolveEntity(client, { dataSourceId: 'ds1', entityType: 'team', externalId: 'ext-known', table: 'teams', slug: 'whatever' }),
    ).toEqual({ status: 'mapped', entityId: 'team-uuid-9' });

    expect(
      await resolveEntity(client, { dataSourceId: 'ds1', entityType: 'team', externalId: 'ext-new', table: 'teams', slug: 'fc-example' }),
    ).toEqual({ status: 'matched', entityId: expect.any(String) });

    expect(
      await resolveEntity(client, { dataSourceId: 'ds1', entityType: 'team', externalId: 'ext-nope', table: 'teams', slug: 'no-such-slug' }),
    ).toEqual({ status: 'missing' });

    fake.store.teams.push({ id: 'dup-1', slug: 'dupe-club', name: 'Dupe 1' });
    fake.store.teams.push({ id: 'dup-2', slug: 'dupe-club', name: 'Dupe 2' });
    expect(
      await resolveEntity(client, { dataSourceId: 'ds1', entityType: 'team', externalId: 'ext-dupe', table: 'teams', slug: 'dupe-club' }),
    ).toEqual({ status: 'ambiguous' });
  });
});

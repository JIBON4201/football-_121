import { createApp } from '../src/app';
import { config } from '../src/config';
import { resetCacheStore } from '../src/lib/cache';
import { resetRateLimits } from '../src/lib/rateLimit';
import { resetRoleFetcher, setRoleFetcher } from '../src/lib/roles';
import { resetClients, setClientFactories } from '../src/lib/supabase';
import { resetTokenVerifier, setTokenVerifier } from '../src/middleware/auth';
import { resetUploadRateLimits } from '../src/middleware/uploadRateLimit';
import { InMemoryStorageProvider, setStorage } from '../src/media/storage';
import { FakeClient, seedStore } from './fake';

export const app = createApp();

const DEFAULT_RATE = { ...config.rateLimit };
const DEFAULT_CORS = [...config.corsOrigins];
const DEFAULT_PAGE = { ...config.pagination };
const DEFAULT_MEDIA = {
  maxUploadBytes: config.media.maxUploadBytes,
  allowedMimeTypes: [...config.media.allowedMimeTypes],
  allowAvif: config.media.allowAvif,
  maxDimension: config.media.maxDimension,
  uploadRateLimitPerMin: config.media.uploadRateLimitPerMin,
};

export let testStorage = new InMemoryStorageProvider();

let currentRoles: string[] = [];

export function setTestRoles(roles: string[]): void {
  currentRoles = roles;
}

/** Fresh isolated environment per test: fake DB, stubbed auth/roles, clean limits. */
export function installTestEnv(): { fake: FakeClient } {
  const store = seedStore();
  const fake = new FakeClient(store);
  setClientFactories({ anon: () => fake as never, service: () => fake as never });
  setTokenVerifier(async (token) =>
    token === 'valid-token' ? { id: 'user-1', email: 'test@example.com' } : null,
  );
  setRoleFetcher(async () => currentRoles);
  resetRateLimits();
  resetUploadRateLimits();
  resetCacheStore();
  testStorage = new InMemoryStorageProvider();
  setStorage(testStorage);
  currentRoles = [];
  config.rateLimit.publicMax = DEFAULT_RATE.publicMax;
  config.rateLimit.authedMax = DEFAULT_RATE.authedMax;
  config.corsOrigins = [...DEFAULT_CORS];
  config.pagination.maxLimit = DEFAULT_PAGE.maxLimit;
  config.pagination.defaultLimit = DEFAULT_PAGE.defaultLimit;
  config.media.maxUploadBytes = DEFAULT_MEDIA.maxUploadBytes;
  config.media.allowedMimeTypes = [...DEFAULT_MEDIA.allowedMimeTypes];
  config.media.allowAvif = DEFAULT_MEDIA.allowAvif;
  config.media.maxDimension = DEFAULT_MEDIA.maxDimension;
  config.media.uploadRateLimitPerMin = DEFAULT_MEDIA.uploadRateLimitPerMin;
  return { fake };
}

export function restoreRealClients(): void {
  resetClients();
  resetTokenVerifier();
  resetRoleFetcher();
}

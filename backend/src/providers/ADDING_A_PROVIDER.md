# Adding a Football Data Provider

This guide adds a new external provider without changing core football services.

## 1. Create the adapter

Implement `FootballDataProvider` (`src/providers/provider.ts`). Keep every
provider-specific shape inside the adapter and return **normalized DTOs**
(`src/providers/types.ts`) only:

```ts
import { ProviderHttpClient } from './httpClient';
import { providerConfigFromEnv } from './config';

export function createAcmeProvider() {
  const config = providerConfigFromEnv('PROVIDER_ACME');
  const http = new ProviderHttpClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    requestsPerMinute: config.requestsPerMinute,
  });
  return {
    name: 'acme',
    capabilities: { competitions: true, teams: true /* … */ },
    ping: () => http.request('/status').then(() => undefined),
    getTeams: async () => (await http.request('/teams')).map(toNormalizedTeam),
  };
}
```

Map provider fields to normalized DTOs first (e.g. `"Home Team"` → `homeTeamExternalId`),
then let the shared `normalize.ts` + `validation.ts` layers converge everything.

## 2. Register the runtime adapter

```ts
import { registerProvider } from './registry';

registerProvider({ name: 'acme', priority: 100, enabled: true, createAdapter: createAcmeProvider });
```

## 3. Register the data source row

Insert into `data_sources` (`provider = 'acme'`, `priority`, `is_active`).
`external_entity_ids` mappings are created automatically during sync.

## 4. Sync

Trigger `POST /api/v1/admin/sync` (admin only) or call `runSync()` from a
future worker. Records flow through validation → resolution → idempotent
persistence; failures land in `sync_errors` and the job becomes `partial`.

## Rules

- Secrets stay in env vars (`PROVIDER_ACME_API_KEY`). Never log, store, or return them.
- No provider types outside the adapter. No raw SQL. No frontend access.
- Priority decides future primary/fallback selection; conflicts are recorded, never auto-merged.

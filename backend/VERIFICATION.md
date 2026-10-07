# Step 40 — Production Integration & Real-Data Verification

This directory documents the verification harness added in Step 40 and, more
importantly, **what has and has not actually been verified**.

The guiding rule: a check that cannot run reports `SKIP` with a reason. Nothing
is inferred, and no live data is fabricated.

## Running the verification pass

```bash
cd backend

# Offline checks only (no credentials, no database, no running deployment)
npm run verify -- --no-db

# Full pass against a running deployment
npm run verify -- \
  --api   https://api.football.example.org \
  --site  https://football.example.org \
  --admin-token "$ADMIN_TOKEN" \
  --media-id  <media-uuid> \
  --out    ../reports

# Machine-readable only (for CI)
npm run verify -- --api https://api.example.org --json
```

Exit code is **non-zero** when any check fails or any `BLOCKER` finding is
raised, so CI cannot go green on a broken verification run. `SKIP` never counts
as success — it is reported separately as *unverified*.

### Options

| Flag | Purpose |
| --- | --- |
| `--api <url>` | Enables API contract, cache, security, SEO, live, worker, media and latency checks |
| `--site <url>` | Enables the frontend route smoke test |
| `--admin-token <t>` | Enables worker/scheduler health (those routes are correctly auth-protected) |
| `--media-id <uuid>` | Enables media variant verification (repeatable) |
| `--no-db` | Skips all database-dependent checks |
| `--json` / `--markdown` / `--quiet` | Output selection |
| `--out <dir>` | Writes `verification.json` + `verification.md` artifacts |

## Architecture

```
src/verify/
  types.ts         Severity model (BLOCKER/HIGH/MEDIUM/LOW/INFO) and CheckResult
  report.ts        Aggregation, severity classification, JSON/Markdown, exit gating
  sourceScan.ts    Env-var inventory + secret scanning (source and browser bundle)
  envAudit.ts      Env documentation gaps, env separation, secret exposure
  providerCheck.ts Provider config shape, adapter registration, credential hygiene
  schemaCheck.ts   DB connectivity + schema/RLS/enum/index consistency
  canonicalAudit.ts Duplicate entities, external-ID fan-out, relationships, freshness
  httpChecks.ts    Live HTTP checks + the pure validators they reuse
  checks.ts        Orchestrator
  cli.ts           CLI entrypoint (npm run verify)
```

`supabase/migrations/023_step40_verification.sql` adds two read-only
diagnostics that PostgREST can reach (it cannot read `pg_catalog` directly):

- `verify_schema_health()` — extensions, enums, tables, indexes, triggers, RLS
- `verify_canonical_data()` — duplicates, external-ID fan-out, broken
  relationships, freshness signals

Both are `service_role`-only and mutate nothing.

## Permanent regression suites

Verification that only runs once is worthless, so the contract is locked into CI:

- `tests/step40-verify.test.ts` — the tooling itself (49 tests)
- `tests/step40-contract.test.ts` — API contract, caching, security, graceful
  degradation, SEO artifacts (20 tests)

Both run with the existing suite via `npm test`.

## Production boot guard

`assertEnvIsSane()` (`src/lib/envRules.ts`) is called by `server.ts`, the worker
CLI and the scheduler CLI. In production it refuses to start when credentials
are missing, still hold `.env.example` placeholders, CORS contains only local
origins, `SITE_BASE_URL` is a placeholder, or the service-role key equals the
public anon key.

## Findings from this pass

| Severity | Finding | Status |
| --- | --- | --- |
| BLOCKER | No real environment exists — no `.env`, no Supabase project, no provider credentials. Every real-data check is unverified. | **Open** — needs credentials |
| MEDIUM | No production entrypoint calls `setCacheStore()`, so server-side response caching is a no-op. HTTP `Cache-Control` still works, so a CDN/browser cache is effective. | Reported by `cache.wiring` |
| LOW | `SITE_BASE_URL` defaults to `https://football.example.com`. Harmless in development, a BLOCKER in production. | Guarded by `assertEnvIsSane()` |
| — | Entity resolution relies solely on provider external IDs (no fuzzy name matching). This is deliberate — fuzzy matching risks merging genuinely distinct entities — so duplicates are *detected* by `verify_canonical_data()` rather than silently merged. | By design |

### Bugs this pass found and fixed

- `inspectProviderEnv()` ignored its `env` argument and read `process.env`,
  so provider checks could never validate an arbitrary environment. Refactored
  into `providerConfigFromRecord()` as the single source of truth.
- `SUPABASE_URL` accepted the `https://xyzcompany.supabase.co` placeholder in
  production because it is a syntactically valid URL. Now explicitly rejected.
- `backend/.env.example` omitted the entire `PROVIDER_*` block and the
  worker/scheduler runtime contract; `frontend/.env.example` omitted all five
  `NEXT_PUBLIC_FEATURE_*` flags. All documented.
- The verification suite initially treated `/api/v1/articles` as a public
  endpoint. It is correctly `requireAuth`, so the suite would have reported a
  false BLOCKER against correct code.

## What still requires credentials or a running deployment

These are reported as *unverified*, not as passing:

- Real provider connectivity, authentication, rate limits, timeout behaviour,
  pagination, response validation
- Controlled real-data import and its idempotency re-run
- Entity resolution against live provider naming
- Real upcoming/completed/live match and timezone verification
- Live state transitions and event-idempotency under repeated live sync
- Schema consistency, canonical duplicate audit, freshness against real rows
- Every public frontend route, SEO metadata/JSON-LD, sitemap URLs, media
  delivery, latency, mobile viewport and accessibility behaviour

Run the full command above against a real deployment to close them out.
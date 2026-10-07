# Production Deployment Checklist

Every box below must be ticked **before** the site is declared live. This file
also records what has already been automated, so only the genuinely manual steps
remain.

Status legend: `[x]` verified in this repo · `[ ]` requires the real environment

---

## 1. Environment audit

Automated by `npm run verify` (see `backend/VERIFICATION.md`). It fails the run
on any BLOCKER and reports unverified checks explicitly.

| Variable | Purpose | Required in production |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase project URL | yes — BLOCKER if unset or placeholder |
| `SUPABASE_ANON_KEY` | Public/anon key (RLS-honouring reads) | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only privileged key | yes — **never** exposed to the browser |
| `SITE_BASE_URL` | Canonical public origin | yes — drives canonicals, sitemaps, robots, JSON-LD |
| `CORS_ORIGINS` | Comma-separated browser origins | yes — must not be localhost-only |
| `PROVIDER_BASE_URL` | Football provider API base | yes |
| `PROVIDER_API_KEY` | Football provider credential | yes — server-side only |
| `PROVIDER_ENABLED` | Enables real provider sync | yes |
| `MEDIA_BUCKET` / `MEDIA_CDN_BASE_URL` | Image storage | yes |
| `CACHE_TTL_*` | Public cache lifetimes | tune per traffic |
| `RATE_LIMIT_PUBLIC_MAX` / `_AUTHED_MAX` | Abuse ceilings | tune per traffic |
| `SEO_*` / `SITE_NAME` / `SITE_LANGUAGE` | SEO identity | yes |
| `ADMIN_TOKEN` | Operator-only verifier access | optional |
| `NODE_ENV` | `production` | yes |

Frontend (`frontend/.env.example`): `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SITE_NAME`,
`NEXT_PUBLIC_FEATURE_*`, `API_URL` (server-side), `NEXT_PUBLIC_API_URL` (browser).

- [x] Every variable the code reads is documented in a `.env.example`.
- [x] Placeholder values from `.env.example` are rejected in production
      (`xyzcompany.supabase.co`, `public-anon-key`, …) — `backend/src/lib/envRules.ts`.
- [x] A production service key identical to the anon key is rejected.
- [x] `SITE_BASE_URL` / `NEXT_PUBLIC_SITE_URL` must be a real non-local HTTPS
      origin; the frontend **refuses to boot** otherwise (Step 42).
- [x] Dev/test credentials cannot reach production: placeholders and local-only
      CORS are BLOCKERs, and the API, worker and scheduler all call
      `assertEnvIsSane()` at startup.
- [x] No secrets committed: `.env`, `.env.local`, `.env.*.local` and `reports/`
      are git-ignored.
- [x] No secrets in the browser bundle — verified by scanning the built
      `.next/static` output.
- [x] No hardcoded localhost URLs in canonicals, sitemaps, robots or JSON-LD.
- [x] No development-only flags left on: the seed/mock provider is not
      registered in production and `--provider seed` is refused.

## 2. Database

- [x] 23 migrations, reviewed: no `TRUNCATE`, no `DELETE FROM`, no
      column-type changes. The only destructive-looking statements are
      `DROP INDEX IF EXISTS` in `016_hardening.sql`, which remove indexes
      redundant with PK/UNIQUE constraints and are then guarded by `CREATE
      INDEX IF NOT EXISTS`.
- [x] Required extensions, 9 enums, 47 tables, FKs, constraints, triggers and
      functions are enumerated in `backend/src/verify/schemaCheck.ts` and diffed
      against the live catalog by `verify_schema_health()`.
- [x] Duplicate entities, external-ID fan-out, broken relationships and data
      freshness are audited by `verify_canonical_data()`.
- [x] Migration `023` adds read-only diagnostics, `service_role`-only.
- [ ] **Apply all 23 migrations to a clean production database and confirm they
      execute.** *Cannot be done here — no database exists.* Verify in order
      001 → 023.
- [ ] **Confirm backup/restore.** Supabase point-in-time recovery must be
      enabled and a restore rehearsed in a staging project. Do not assume backups
      work without a tested restore.

### Migration safety note

`CREATE TYPE` and `CREATE TRIGGER` have no `IF NOT EXISTS` in PostgreSQL, so
migrations are **not re-runnable**. They are safe in strict sequential order on a
clean database, which is how migration tooling applies them. Do not re-apply an
already-applied file. `016`'s `DROP INDEX` takes `ACCESS EXCLUSIVE` locks — on a
large populated database, run it in a maintenance window.

## 3. Football provider

- [x] Credentials are read only from server-side environment variables and are
      redacted in all diagnostics.
- [x] Rate limiting, exponential backoff with jitter, 429/`Retry-After`,
      timeouts, response-size caps and malformed-JSON rejection are implemented in
      `src/providers/httpClient.ts` and covered by tests.
- [x] The seed/mock provider cannot run in production.
- [x] The frontend has **no** provider dependency — it only talks to the backend API.
- [ ] **Register the real provider adapter and run a controlled import.** This is
      the largest outstanding gap: the only registered adapter is `seed`.

## 4. Processes to run

| Process | Command | Notes |
| --- | --- | --- |
| API | `npm run build && npm start` | 1+ instances; in-memory rate limiter is **per-process** |
| Worker | `npm run worker` | ≥1 instance; leases make job claiming safe |
| Scheduler | `npm run scheduler` | exactly 1 instance; duplicates are idempotency-gated but 1 is correct |

Scale the API horizontally only after replacing the in-memory rate limiter and
cache store with Redis (documented swap points in `src/lib/rateLimit.ts` and
`src/lib/cache.ts`).

## 5. Health checks

| Endpoint | Auth | Verifies |
| --- | --- | --- |
| `/api/v1/health` | public | process is up |
| `/api/v1/health/database` | public | PostgREST reachable (503 when not) |
| `/api/v1/admin/providers/health` | admin | each data source + provider reachability |
| `/api/v1/admin/workers/health` | admin | queue depth, claims, stale leases |
| `/api/v1/admin/schedulers/health` | admin | schedules enabled, last/next run, overdue count |
| `/api/v1/admin/sync-freshness` | admin | per-entity data freshness |

None expose credentials, connection strings or internal hostnames. The three
`/admin/*` routes require an authenticated administrative role and return
401/403 otherwise (asserted in `tests/step41-hardening.test.ts`).

Point your platform's uptime checks at `/api/v1/health` and
`/api/v1/health/database`.

## 6. Deployment order

1. Provision Supabase project; enable PITR backups.
2. Apply migrations 001 → 023 in order. Verify `verify_schema_health()`.
3. Create the `data_sources` row for the real provider and seed taxonomy data.
4. Configure the API environment; deploy the API. Confirm `/api/v1/health`.
5. Deploy the frontend with `NEXT_PUBLIC_SITE_URL` + `API_URL`; confirm
   `/robots.txt` shows the production domain.
6. Start the scheduler, then the worker.
7. Run a controlled import (`npm run import -- --dry-run` first).
8. Post-deployment smoke test (below).

## 7. Post-deployment smoke test

- [ ] `/`, `/news`, `/news/[slug]`, `/breaking-news`, `/transfers`, `/matches`,
      `/matches/[slug]`, `/live`, `/competitions`, `/competitions/[slug]`,
      `/teams`, `/teams/[slug]`, `/players`, `/players/[slug]`, `/search` all 200
- [ ] `/robots.txt` advertises `https://<domain>/sitemap.xml`
- [ ] `/sitemap.xml` and every partition return 200 XML with absolute HTTPS URLs
- [ ] `/api/v1/health` and `/api/v1/health/database` 200
- [ ] `/api/v1/admin/providers/health`, `/workers/health`, `/schedulers/health`,
      `/sync-freshness` 200 with a real provider
- [ ] Real fixture data visible (no empty states on public pages)
- [ ] `npm run verify -- --api … --site … --admin-token …` reports 0 blockers
- [ ] Submit `https://<domain>/sitemap.xml` in Google Search Console

## 8. Domain and indexing

- [ ] HTTPS certificate valid and auto-renewing; HTTP → HTTPS 301 at the edge
- [ ] `www` / non-`www` forced to one canonical host (pick one, 301 the other)
- [ ] Canonical domain matches `NEXT_PUBLIC_SITE_URL` and `SITE_BASE_URL`
- [ ] Property verified in Google Search Console; sitemap submitted

## 9. Known blockers before go-live

These are recorded in `PRODUCTION-REPORT.md` and must be resolved or formally
accepted before declaring the site live:

1. **No deployment target configured** — no CI/CD, container or hosting config
   exists in the repository.
2. **No production environment** — no `.env`, no Supabase project, no provider
   credentials; 16 verification checks remain unverified.
3. **No real provider adapter** — only the fixture provider is implemented, so
   real football data cannot flow yet.
4. **Critical Next.js advisory** — `next@14.2.18` has 1 critical + 1 high
   advisory with no fixed 14.x release; requires a planned major upgrade.
# Vercel Full-Stack Migration Report - Football

Date (UTC): 2026-10-07. Scope: migrate the whole site (public frontend + API +
Admin) onto a single Vercel deployment. **Nothing was deployed.**

## 1. Current architecture (before this migration)

- `frontend/` - Next.js 14.2.35 App Router. Public pages in `src/app/(site)`, Admin
  in `src/app/control-center`, SEO handlers (`sitemap.xml`, `sitemaps/[file]`,
  `robots.ts`), `src/middleware.ts` (CSP nonce, admin redirect, redirects).
  Called the API over HTTP via `src/lib/api-client.ts` with base
  `API_URL || NEXT_PUBLIC_API_URL || http://localhost:4000`.
- `backend/` - Express 4 + TypeScript (`src/app.ts` -> `src/server.ts` ->
  `app.listen(PORT, 4000)`), mounted at `/api/v1`. Separate process, own port,
  own env file. Plus long-running `worker`, `scheduler` and CLI scripts.
- `supabase/migrations` - 27 migrations; the only data store.
- Vercel hosted the **frontend only**; the API had to live on a separate
  always-on Node host (Railway/Render/VPS) per `VERCEL_READINESS_REPORT.md` §2.

## 2. Changes made

| # | Change | File |
|---|---|---|
| 1 | Mounted the **unchanged Express app** as a Vercel serverless function: catch-all Pages-Router API route that hands Node `(req, res)` to `createApp()`. Next's JSON body parser disabled so Express owns parsing/limits/validation. | `frontend/pages/api/v1/[[...path]].ts` (new) |
| 2 | Production boot guards (`assertEnvIsSane`, `assertAdminBypassSafe`) now run at function module load, so an unsafe prod env fails loudly instead of silently serving placeholders. | same file |
| 3 | Allowed the frontend to import `../backend/src`. | `frontend/next.config.mjs` (`experimental.externalDir`) |
| 4 | Backend dependencies are installed on the Vercel build machine (`npm --prefix ../backend install`) because webpack resolves `express`, `@supabase/supabase-js`, `helmet`, `cors`, `zod`, `sanitize-html` from `backend/node_modules` at build time; they are bundled into the function and not needed at runtime. | `frontend/package.json` (`prebuild`, `predev`) |
| 5 | Production API base resolution: `API_URL` -> `NEXT_PUBLIC_API_URL` -> same origin. Browser fetch uses a relative `/api/v1/...` path; **server-side fetch** (RSC, route handlers, server actions, sitemap proxy) uses an absolute URL from `NEXT_PUBLIC_SITE_URL` (or Vercel's `VERCEL_URL`). `http://localhost:4000` is now a **dev-only** fallback. Empty-string env values are treated as unset (`||`, not `??`). | `frontend/src/lib/api-client.ts`, `frontend/src/config/site.ts`, `frontend/src/middleware.ts`, `frontend/src/lib/sitemap-proxy.ts` |
| 6 | Fixed a pre-existing type error that a stale `tsconfig.tsbuildinfo` had masked (`useSearchParams()` is nullable in Next 14.2.x), so `next build` type-checks cleanly on Vercel. | `frontend/src/components/admin/ResourceToolbar.tsx` |
| 7 | Environment documentation rewritten for the single-deployment topology. | `VERCEL_ENV.example`, `VERCEL_FULLSTACK_SETUP.md` (new), this report |
| 8 | Verified against a **production build with zero API env vars**: every public page, `/sitemap.xml`, `/robots.txt`, the admin login gate, `/api/v1/health/database` (Supabase) and RBAC 401 all pass. | (no code) |

No database, schema, Supabase table, design, content or unrelated feature was
touched. No API route, payload shape, status code or error envelope changed.

## 3. Backend architecture after migration

```
Vercel deployment
├── Next.js app (App Router) ............ public site + Admin + SEO handlers
└── Pages API route /api/v1/* ........... Node runtime serverless function
    └── createApp() from backend/src/app.ts   (built once per cold start)
        ├── requestContext, helmet, CORS allowlist, express.json, content-type guard
        ├── optional Bearer auth, rate limits (trust proxy, IP tiers)
        ├── /api/v1 router: health, news, matches, teams, players, competitions,
        │   transfers, categories, countries, tags, search, articles, media,
        │   seo, auth, me, admin/*, docs.json
        └── 404 + error handler -> { error: { code, message, details? }, requestId }
Supabase: Postgres (only DB) + Auth + Storage
```

Response format is identical to the standalone server because it *is* the same
Express app; only the process boundary moved.

### API routes (unchanged, all under `/api/v1`)
`GET /health`, `GET /health/database`, `GET /docs.json`, news, matches, teams,
players, competitions, transfers, categories, countries, tags, search, articles
(auth), media (upload/orphans/mutations, authed), seo (robots + sitemaps),
`auth/login|logout`, `me`, `admin/*` (RBAC, dev bypass refused in prod).

## 4. Required Vercel environment variables

Only what the code actually reads (full list in `VERCEL_ENV.example`):

- Public: `NEXT_PUBLIC_SITE_URL` (required), `NEXT_PUBLIC_API_URL`
  (optional - leave empty, same origin), `NEXT_PUBLIC_SITE_NAME`, feature flags,
  `NEXT_PUBLIC_ADMIN_BYPASS` (false).
- Server: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `CORS_ORIGINS`, `SITE_BASE_URL` (all required in production by the existing
  `assertEnvIsSane` guard), `API_URL` (optional), optional tuning
  (`RATE_LIMIT_*`, `CACHE_TTL_*`, `MEDIA_*`, `SEO_*`, `PAGINATION_*`,
  `TRUST_PROXY_HOPS`).
- Vercel-managed, never set: `PORT`, `NODE_ENV`.

Server-side Supabase access stays in `backend/src/lib/supabase.ts`
(`anonClient()` for RLS reads, `serviceClient()` for editorial/RBAC/storage).
No `NEXT_PUBLIC_SUPABASE_*` exists; no key can reach the browser.

## 5. Supabase connection status

**Connected.** Verified through the serverless route: `GET /api/v1/health/database`
-> `{"status":"ok"}`; live reads returned through the API (`/api/v1/news` 10
articles, `/api/v1/teams`, `/api/v1/search?q=arsenal` 200, `/api/v1/sitemaps/*`
XML). Schema untouched.

## 6. Frontend -> API connection status

**Connected, same origin.** With `API_URL`/`NEXT_PUBLIC_API_URL` unset in
production the browser calls relative `/api/v1/...` and SSR uses
`NEXT_PUBLIC_SITE_URL`. Verified against a production build (`next start`):
`/`, `/news`, `/news/<slug>`, `/matches`, `/teams` -> 200 with server-rendered
content; `/sitemap.xml` -> 200; `/sitemaps/teams.xml` -> 200; `/robots.txt` ->
200 with `Sitemap: <site origin>`.

## 7. Admin -> API connection status

**Connected, same origin.** `/control-center/login` -> 200; unauthenticated
`GET /api/v1/admin/dashboard` -> `401` (RBAC intact);
`POST /api/v1/auth/login` with bad credentials -> `401 UNAUTHORIZED`
("Invalid email or password") and with a malformed body -> `400
VALIDATION_ERROR`, i.e. Supabase Auth is reached through the function and the
`{ error, requestId }` envelope the Control Center parses is unchanged. Sessions
stay in httpOnly cookies; the admin bypass is force-disabled in production on
both ends.

## 8. Localhost references remaining

All are dev-only or guards (verified by grep over `frontend/src` and `backend/src`):

- `frontend/src/config/site.ts:12,23` and `frontend/src/lib/api-client.ts:247` -
  `http://localhost:*` fallbacks reachable only when `NODE_ENV !== 'production'`.
- `frontend/src/middleware.ts:57,64` - same, plus dev-only HMR `ws://localhost:*`
  in CSP.
- `backend/src/config.ts:33` - `CORS_ORIGINS` default; production boot refuses to
  start without a real value (`lib/envRules.ts`).
- `backend/src/admin/bypass.ts:90` - dev bypass sentinel email (unreachable in prod).
- `backend/src/lib/envRules.ts`, `backend/src/verify/*` - placeholder/`localhost`
  **detection** logic and CLI defaults.

No production request path points at `localhost`, `127.0.0.1` or port 4000.

## 9. Verification results

| Check | Result |
|---|---|
| `frontend` production build (`next build`) | **PASS** - all public, dynamic, admin, SEO routes + `/api/v1/[[...path]]` compiled |
| `frontend` typecheck (`tsc --noEmit`) | **PASS** |
| `frontend` lint (`eslint .`) | **PASS** |
| `frontend` tests | **PASS** - 36 files, 640 tests |
| `backend` typecheck | **PASS** |
| `backend` tests | **PASS** - 47 files, 548 tests |
| API routes | **PASS** - health, health/database, docs.json, news, teams, search, auth/login (200/400/401), admin/dashboard 401, 404 envelope, 415 content-type guard |
| Supabase connection | **PASS** via `/api/v1/health/database` + live data reads |
| Frontend -> API | **PASS** (same-origin, zero config) |
| Admin -> API | **PASS** (login 200, auth + RBAC enforced) |
| Error handling | **PASS** - `{ error: { code, message }, requestId }` identical to standalone |
| SEO | **PRESERVED** - robots.txt, sitemap index, sitemap partitions, canonicals from `NEXT_PUBLIC_SITE_URL` |

Note: `npm run build` prints the existing `next.config` production-domain
**warnings** locally because `frontend/.env.local` uses `http://localhost:3000`.
On Vercel `NEXT_PUBLIC_SITE_URL` is an https domain, so the guard passes silently.

## 10. Remaining items (deployment-time, not code defects)

1. Set the production env vars above in the Vercel project (Root Directory
   `frontend`, Framework Next.js, Node 22). Nothing is required for
   `API_URL`/`NEXT_PUBLIC_API_URL` when staying same-origin.
2. **Rotate the Supabase service-role key** in the local `backend/.env` before
   launch (flagged earlier as previously shared) and set the rotated value in
   Vercel.
3. `npm run worker` / `npm run scheduler` (2s/60s pollers) and the import/verify
   CLIs are **not** Vercel functions. They are not needed to serve the site; run
   them from any machine with the backend env, or move them to Vercel Cron /
   Supabase scheduled functions later if the sync queue is needed in production.
4. In-memory rate-limit buckets/cache are per function instance (best effort).
   Shared Upstash Redis is optional hardening, not a blocker.
5. Re-run `scripts/seo-crawl-check.mjs --sample 100` against the live domain and
   confirm production 404s (dev soft-404 WARNs become real 404s off `next dev`).
6. Function duration: Vercel Hobby caps a function at 10s (Pro 60s+). Public
   read endpoints are well inside it; the sitemap partitions are the heaviest and
   are cached (3600s) - raise `maxDuration` / plan if a crawl ever times out.

## 11. Final status

**READY_FOR_VERCEL**

The public site, the `/api/v1` API and the Admin panel now run as one Vercel
deployment with Supabase as the only data store - no Railway/Render/VPS. Nothing
was deployed; `vercel` CLI should be run only after the env vars in
`VERCEL_ENV.example` are set.

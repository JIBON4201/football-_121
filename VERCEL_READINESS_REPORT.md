# Vercel Readiness Report — Football Website

Date (UTC): 2026-10-07. Scope: prepare + validate only. **No deploy. No domain connected. No Supabase data changed.**

## 1. Project architecture

- **Frontend (`frontend/`)**: Next.js `^14.2.35`, React 18.3.1, `npm` (`package-lock.json`), `engines node >=20`. Scripts: `dev/next dev`, `build/next build`, `start/next start`, `typecheck/tsc --noEmit`, `lint/eslint .`, `test/vitest run`. App Router, no `src/app/api/**` (only `sitemap.xml`, `sitemaps/[file]`, `control-center/[...unmatched]` route handlers + `robots.ts`). All public pages are async Server Components with `generateMetadata`; interactive islands (`site-header`, `directory-explorer`, `transfer-hub`, search, admin forms) are `'use client'` leaves. ISR via `revalidate` + `fetch next:{revalidate,tags}` + `revalidateTag/revalidatePath` from admin actions. Middleware (`src/middleware.ts`): CSP nonce, `/control-center` login redirect (bypass-aware), trailing-slash 308, slug-lowercase 308. No `output:export`, no `generateStaticParams`, no `vercel.json` (none needed).
- **Backend (`backend/`)**: Express 4 + TypeScript (CommonJS, `outDir dist`), `engines node >=20`, persistent `app.listen(PORT)` server (`src/server.ts`) behind `createApp()` (`src/app.ts`: trust-proxy, request-context, helmet, optional-auth, rate-limit, `/api/v1` mount, 404/error handlers). Public groups: `health`, `news`, `matches`, `teams`, `players`, `competitions`, `transfers`, `categories`, `countries`, `tags`, `search`, `seo`, `discovery` (robots/sitemaps), `media` (gated public reads), `auth/login`; private: `articles` (router-level `requireAuth`), `me`, `media/upload+orphans+mutations`, `admin/*` (`requireAdmin`/`requirePermission` or dev bypass). Forever processes: `npm run worker` (2s poll, 120s leases, heartbeats) + `npm run scheduler` (60s DB-driven tick). In-memory rate buckets + cache store + `setInterval` sweeper. Uploads → Supabase Storage; dataset/parquet reads are CLI-only.
- **Data**: Supabase Postgres. Public reads via `anonClient()` (RLS); privileged/editorial/RBAC/storage via `serviceClient()` (service-role, server-only). No local-disk dependency on any request path.

## 2. Vercel compatibility — FRONTEND: COMPATIBLE / BACKEND: NOT HOSTABLE ON VERCEL (by design)

- Frontend uses only Vercel-native primitives (ISR, tags, middleware, route handlers, `headers()` security). No custom server, no static-export conflict, no `next/image` remote config needed (no `next/image` usage at all — plain `<img>`).
- Backend **cannot** run on Vercel serverless: `listen()` + in-process rate/cache state + timer loops + 60–120s worker leases violate serverless ephemerality/timeouts. No `serverless-http` adapter exists and none was faked.
- Required topology: **Vercel = frontend only**; **API + worker + scheduler = separately hosted long-running Node** (Railway/Render/Fly/VPS/Docker); Supabase unchanged. This is documented in `VERCEL_DEPLOYMENT.md §1`.

## 3. Build / TypeScript / lint / tests

| Check | Result |
|---|---|
| Frontend `npm run build` | **PASS** — all routes compiled (public, dynamic `[slug]/[id]`, admin, sitemap/robots handlers), `ƒ Middleware 27.1 kB`. Only expected output: `next.config` production-domain WARNINGs (localhost `NEXT_PUBLIC_SITE_URL` in local build env; `next start` would throw — correct guard, prod env fixes it). |
| Frontend `npm run typecheck` | **PASS** (`tsc --noEmit`, clean). |
| Frontend `npm run lint` | **PASS** (`eslint .`, clean). |
| Frontend `npm run test` | **PASS — 36 files, 640 tests**. |
| Backend `npm run build` (`tsc -p`) | **PASS**. |
| Backend `npm run typecheck` | **PASS** (verified in prior pass; no backend src changed in this pass). |

No errors ignored; the one file change in this pass was deleting stale `src/middleware.ts.BAK` (dead duplicate, not imported).

## 4. Environment variable audit (no values printed)

**Frontend — public (inlined into client JS, must be set in Vercel before build):**
`NEXT_PUBLIC_SITE_URL` (required, https, no slash), `NEXT_PUBLIC_API_URL` (required, backend https), `NEXT_PUBLIC_SITE_NAME` (optional), `NEXT_PUBLIC_FEATURE_LIVE/BREAKING/TRANSFERS/SEARCH/BOTTOM_NAV` (optional), `NEXT_PUBLIC_ADMIN_BYPASS` (dev-only — must be unset/false in prod; forced false when `NODE_ENV=production`).
Used in: `config/site.ts`, `config/features.ts`, `lib/admin-bypass.ts`, `lib/api-client.ts`, `middleware.ts`, `lib/sitemap-proxy.ts`, `page-components.tsx`, `next.config.mjs` guard.

**Frontend — server-only (never `NEXT_PUBLIC_`):**
`API_URL` (SSR + sitemap proxy; falls back to `NEXT_PUBLIC_API_URL` — set explicitly in prod).

**Backend — all server-only (API host, never Vercel client):**
`PORT`, `NODE_ENV`, `TRUST_PROXY_HOPS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS`, `ADMIN_BYPASS_AUTH`, pagination/rate/cache limits, `MEDIA_*`, `PROVIDER_*` (BLOCKERs in prod when enabled), `SITE_BASE_URL/NAME/LANGUAGE`, `SEO_*`. Prod boot guards (`lib/envRules.ts`) refuse placeholders/`localhost`/`example.com`/bypass-on.

**Files:** `frontend/.env.example` (public names + localhost dev values, no secrets — compliant, unchanged), `backend/.env.example` (placeholders only — compliant, unchanged), **new `VERCEL_ENV.example`** (Vercel variable names, no values). Real secrets live only in gitignored `backend/.env` + `frontend/.env.local` (both ignored at root and per-package).

## 5. API audit (production handling per endpoint)

Base `/api/v1` (see backend audit for file:line map). Public `GET`s carry `validateRequest` + `cacheable()` (TTL per group: static 300s, news 60s, matches 30s, SEO 3600s) and envelope `{data, pagination?, requestId}`; 4xx/5xx via typed `ApiError` + `errorHandler` (CORS reject → 403). Auth: global optional Bearer (`auth.getUser`) for rate-tier uplift; `requireAuth` on `me`, `articles/*`, media mutations, `auth/logout`; `requireAdmin`/`requirePermission` on `admin/*` (+ dev bypass, prod-refused). CORS: allowlist callback vs `CORS_ORIGINS` (must list the Vercel domain in prod), credentials false, JSON-only guard for mutations. Timeouts: provider HTTP 10s + 3 retries + 5MB cap; media processing 30s; no `server.timeout` override (host default). DB: `anonClient` reads (RLS) vs `serviceClient` writes — no key leaves the server; `GET /health` (no DB) + `/health/database` (one-row anon probe, 200/503, no creds) for load-balancer checks; `GET /docs.json` serves static OpenAPI (cached). No endpoint depends on localhost when `CORS_ORIGINS`/`SITE_BASE_URL`/`API_URL` are set to production values.

## 6. Supabase audit

- Connectivity: verified via running dev stack (`/health` ok, `/health/database` pattern, live sitemap counts: articles 10, matches 3, teams 4, players 8, competitions 1, transfers 1). No schema or data change in this pass.
- Server-side credentials stay server-side: grep confirms zero `SERVICE_ROLE`/key material in `frontend/src` (only cautionary comments); backend uses `anonClient` vs `serviceClient` split correctly; browser uses only public API base (no `NEXT_PUBLIC_SUPABASE_*` anywhere — frontend never contacts Supabase directly).
- No query depends on local dev files; storage is Supabase bucket, not disk.

## 7. Localhost dependency audit — PASS (dev-only fallbacks, no prod hardcode)

Frontend `src`: `config/site.ts:15,20`, `lib/api-client.ts:237`, `middleware.ts:48` (+ dev-only CSP `ws://localhost:*`/`127.0.0.1:*`, correctly omitted in prod) — all `??`/`||` fallbacks overridden by setting `NEXT_PUBLIC_SITE_URL`/`API_URL`/`NEXT_PUBLIC_API_URL` in Vercel.
Backend `src`: `config.ts:33` CORS fallback, `admin/bypass.ts:90` sentinel `dev-bypass@localhost.invalid`, `envRules`/`verify` placeholder + prod-blocker checks — all require real values in prod and refuse to boot otherwise.
No `127.0.0.1`/`0.0.0.0`/hardcoded-port production dependency. Dev `.env.local`/`.env` values retained untouched.

## 8. SEO audit — PRESERVED, PASS

Prior indexing work verified intact on the running stack: `robots.txt` 200 (`Allow:/`, `Disallow:/control-center + /api/`, `Sitemap:` on site origin, search deliberately allowed for its `noindex`); `/sitemap.xml` index (10 site-origin partitions, 36 URLs) + all partitions 200 with absolute canonical locs; every indexable page emits self-consistent canonical + unique title/description + OG/Twitter + `index,follow`; search `noindex,follow` with canonical `/search`; missing entities 404+`noindex` (dev streams 200+`noindex`, prod sends real 404 — validator treats dev form as WARN); `BreadcrumbList` on all details+listings, `ItemList` on all listings, `NewsArticle`/`SportsEvent`/`SportsTeam`/`Person`/`WebSite`+`SearchAction`/`Organization` where appropriate; `/news/`→308, `/NEWS`→308, `/Teams/Arsenal`→308; `og-default.png` 200. Exhaustive crawl (`--sample 100`): **36 crawled (35 indexable, 1 noindex), 36 sitemap URLs, 0 errors**. Canonicals derive from `NEXT_PUBLIC_SITE_URL`, so they flip to the Vercel domain automatically once env is set — no code change needed.

## 9. Images — PASS

Zero `next/image` imports (hence no `images.remotePatterns` needed and none added). All artwork via `<img>` (entity `logo_url`/`photo_url`, CMS `srcSet`, `ResponsiveImage` with `onError → /og-default.png` fallback). Local assets (`brand-mark.svg`, `og-default.png` 1200×630) served from `public/` with immutable `_next/static` caching. No optimization disabled; nothing to configure on Vercel.

## 10. Caching / performance — PASS (sane, privacy-safe)

Public: ISR (`revalidate` 30–3600 by content volatility) + `fetch` tags + `Cache-Control: public, max-age=3600, stale-while-revalidate=600` on sitemaps + immutable static assets. Admin/user-specific: `cache:'no-store'` + `noStore()` on session, mutations, `me`, health/database. Bounded fan-outs (match enrich 12, related 500/300 caps, search page cap 50, `maxLimit` 100) prevent crawl/API blowups. No private data cached publicly.

## 11. Admin panel — PROTECTED

Same-deployment `/control-center`: middleware cookieless redirect → login (308), `(protected)` server layout re-gates (`redirect`/`AccessDenied`), backend re-authorizes every call. Sessions in httpOnly cookies, never localStorage; no admin secret in client bundle (server-actions-only imports verified). Bypass (`NEXT_PUBLIC_ADMIN_BYPASS` + `ADMIN_BYPASS_AUTH`) is dual-fenced off in production on both ends. No separate Vercel project needed.

## 12. Security findings

- **Required pre-launch action (not a code defect): rotate the Supabase service-role key currently in local `backend/.env`.** The file's own comments flag it as previously shared/compromised. It is gitignored and server-only (never in client code or logs), but it must be revoked in Supabase and replaced on the API host before any production traffic. No value is printed here.
- No other exposed/hardcoded credentials in code (grep clean outside gitignored `.env` + `node_modules`).
- Stale `middleware.ts.BAK` deleted (eliminates a confusing dead copy of CSP/allowlist logic).
- No debug endpoints remain (`__probe__`/`__probe2__` deleted in prior pass; none found now).
- CORS is allowlist-based (`CORS_ORIGINS`), `helmet` on, mutation content-type guard on, per-class rate limits (+ separate upload limiter), no `credentials:true` wildcard. No change needed.
- Dev logging uses structured `log({msg,…})` without PII/secret interpolation; `redactedConfig` omits keys. Source maps are Next defaults; no secret is bundled client-side to leak via maps.

## 13. Remaining blockers (deployment-time, none are code defects)

1. Set Vercel production env (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`, `API_URL`) — cannot be validated locally without deploying (forbidden in this pass).
2. Host the backend API + worker + scheduler on an always-on host with `NODE_ENV=production` and the `backend/.env.example` values pointed at prod (incl. rotated Supabase keys, prod `CORS_ORIGINS`/`SITE_BASE_URL`).
3. Rotate the flagged dev service-role key (§12) before launch.
4. Re-run `scripts/seo-crawl-check.mjs --sample 100` + §8 health checks against the real domains and confirm prod 404s (dev soft-404 WARNs must read as real 404s under `next start`).

## 14. Exact Vercel settings

- Root Directory: `frontend` · Framework: Next.js (auto) · Build: `npm run build` · Output: default (blank) · Install: `npm install` · Node: 20+ · `vercel.json`: none.
- Env (Production): `NEXT_PUBLIC_SITE_URL=https://<domain>` · `NEXT_PUBLIC_API_URL=https://<api-host>` · `API_URL=https://<api-host>` · optional name/flags · `NEXT_PUBLIC_ADMIN_BYPASS` unset/false.

## VERCEL STATUS: READY

Code and configuration are production-safe for Vercel (frontend) with the separately-hosted API architecture. No production-blocking build, type, lint, test, SEO, security, or routing defect remains in code. The §13 items are mandatory deployment-time steps to execute when launch is authorized — no further code change is required for them.

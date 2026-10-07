# Vercel Full-Stack Setup - Football

Single-deployment topology: **Vercel hosts the public Next.js site, the `/api/v1`
API and the Admin panel. Supabase is the database (and auth/storage). There is no
Railway/Render/VPS process.**

```
Browser ──► Vercel (Next.js)
             ├─ /, /news, /matches, ...   public site (App Router, ISR)
             ├─ /control-center/...        Admin panel (same deployment)
             ├─ /sitemap.xml, /robots.txt  SEO route handlers
             └─ /api/v1/...                API = backend Express app, mounted
                                           as a Next.js Pages-Router API route
                                                 │  (serverless function)
                                                 ▼
                                          Supabase Postgres/Auth/Storage
```

## 1. How the API runs on Vercel

`frontend/pages/api/v1/[[...path]].ts` is a catch-all Pages-Router API route. It
builds the **unchanged** Express app (`backend/src/app.ts` -> `createApp()`) once
per cold start and hands Node's `(req, res)` to it, so every route, middleware
and response envelope is byte-for-byte what the standalone server produced:

```ts
import { createApp } from '../../../../backend/src/app';

const app = createApp();

export const config = { api: { bodyParser: false } }; // Express owns the body

export default function handler(req, res) {
  app(req, res);
}
```

- `experimental.externalDir: true` in `next.config.mjs` lets the frontend import
  `../backend/src`. Webpack bundles Express, Supabase JS, helmet, cors, zod and
  sanitize-html into the function; nothing is required from `backend/node_modules`
  at runtime.
- `assertEnvIsSane()` and `assertAdminBypassSafe()` (the boot guards from
  `backend/src/server.ts`) run at module load, so an unsafe production env fails
  the first invocation instead of silently serving placeholders.
- Next's built-in JSON body parser is disabled (`bodyParser: false`); Express
  applies its own size limit, content-type guard and zod validation.
- Because Pages-Router API routes run in the **Node runtime**, the full Express
  stack works: helmet, CORS, IP rate limits (`trust proxy`), bearer auth, RBAC,
  uploads to Supabase Storage.

## 2. Project settings (Vercel Dashboard)

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Next.js (auto-detected) |
| Install Command | `npm install` (default; `prebuild` installs backend deps) |
| Build Command | `npm run build` (default) |
| Node.js | 22.x (`engines`) |
| `vercel.json` | none needed |
| Regions | default (`iad1`); keep Supabase in the same region for latency |

## 3. Environment variables

Copy `VERCEL_ENV.example`. Minimum for production:

| Variable | Scope | Required | Value |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | public | yes | `https://<your-domain>` (https, no trailing slash) |
| `SUPABASE_URL` | server | yes | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | server | yes | anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | server | yes | service-role key (server-only) |
| `CORS_ORIGINS` | server | yes | `https://<your-domain>` |
| `SITE_BASE_URL` | server | yes | same as `NEXT_PUBLIC_SITE_URL` |

Optional: `NEXT_PUBLIC_SITE_NAME`, feature flags, rate/cache/media tuning.

**`API_URL` and `NEXT_PUBLIC_API_URL` can stay empty.** The API is same-origin, so
the client falls back to relative `/api/v1/...` calls and the server falls back to
`NEXT_PUBLIC_SITE_URL`. Set them only if the API moves to another host.

`NEXT_PUBLIC_ADMIN_BYPASS` / `ADMIN_BYPASS_AUTH` must be false/unset: the function
refuses to boot with the bypass on.

### Server-side Supabase access
- Keys are read from `process.env` only (`backend/src/lib/supabase.ts`):
  `anonClient()` for RLS-governed reads, `serviceClient()` (service-role) for
  editorial/RBAC/storage writes.
- The browser never talks to Supabase and never receives a key: no
  `NEXT_PUBLIC_SUPABASE_*` exists, and `NEXT_PUBLIC_*` only carries site config.
- `SUPABASE_SERVICE_ROLE_KEY` is a Vercel server-only variable, never inlined into
  the client bundle.

## 4. CORS

Frontend and API share an origin, so CORS is a no-op for normal traffic (no
`Origin` header on same-origin fetches). The allowlist still guards direct calls:

- `CORS_ORIGINS=https://<your-domain>` (comma-separated if you add preview
  domains). Requests from other origins get `403 FORBIDDEN`.
- `credentials: false` - the Admin session is a Bearer token in an httpOnly
  cookie, not a cookie-based CORS flow, so no wildcard/`credentials: true` is used.

## 5. SEO (unchanged)

- Canonical URLs, robots.txt `Host`/`Sitemap`, sitemap URLs all derive from
  `NEXT_PUBLIC_SITE_URL` / `SITE_BASE_URL` - they flip to the Vercel domain from
  env alone.
- `/sitemap.xml` (index) and `/sitemaps/[file]` still proxy the backend documents
  through `API_URL` (now same-origin) with the same 3600s cache and 502-on-failure
  behavior.
- Structured data (NewsArticle, SportsEvent, BreadcrumbList, ItemList, ...) is
  generated unchanged in the server components.

## 6. What is NOT deployed

- `backend/src/server.ts` (`app.listen`) - replaced by the serverless route.
- `npm run worker`, `npm run scheduler` (2s/60s pollers), `npm run import*`,
  `npm run verify` - CLI/cron jobs. They are not needed to serve the site; run
  them from a machine with the backend env (`npm run verify`, imports) or wire
  them to Vercel Cron / Supabase scheduled functions later if desired.
- In-memory rate-limit buckets and cache are per-instance now (best effort). A
  shared store (Upstash Redis) is optional hardening.

## 7. Local development

```bash
# terminal 1 - standalone API (optional; the Next dev server also mounts /api/v1)
cd backend && npm run dev            # http://localhost:4000
# terminal 2 - site
cd frontend && npm run dev           # API_URL=http://localhost:4000
```

With `API_URL=http://localhost:4000` the site talks to the standalone backend; with
it unset in dev, Next serves `/api/v1` itself from the same Express app.

## 8. Verify after deploy (no code changes required)

```bash
curl -s https://<domain>/api/v1/health
curl -s https://<domain>/api/v1/health/database
curl -sI https://<domain>/robots.txt
curl -s https://<domain>/sitemap.xml | head
node scripts/seo-crawl-check.mjs --sample 100   # SEO crawl
```

Sign in at `/control-center/login` to confirm Admin -> API (same origin) works.

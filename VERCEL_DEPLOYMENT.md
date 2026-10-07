# Vercel Deployment Guide — Football Website

Do NOT deploy yet per task scope. This guide is the exact procedure to follow when authorized.
No UI redesign, no schema change, no data deletion performed in this prep pass.

## 1. Required architecture (read first)

| Piece | Where it runs | Why |
|---|---|---|
| Frontend (`frontend/`, Next.js 14) | **Vercel** | Framework auto-detected; ISR + middleware + route handlers are Vercel-native. |
| Backend API (`backend/`, Express `app.listen`) | **Separately hosted long-running Node** (Railway / Render / Fly / VPS / Docker), NOT Vercel | Persistent server with in-memory rate buckets, cache store, `setInterval` sweeper, plus forever `worker` (2s poll, 120s leases) and `scheduler` (60s tick). Serverless functions have no `listen`, freeze after response, fragment in-memory state, and time out long jobs. Do not force it into Vercel; there is no serverless adapter in the repo. |
| Worker + scheduler (`npm run worker`, `npm run scheduler`) | Same API host or second always-on process | DB-driven queues (`sync_jobs/sync_schedules`); need SIGTERM handling + 60–120s leases. |
| Database / storage / auth | Supabase (existing project) | No migration in this pass. |

Minimum prod topology: `Vercel (web) → https API host (Node) → Supabase`.

## 2. Vercel project settings

- **Framework Preset:** Next.js (auto-detected from `frontend/package.json`).
- **Root Directory:** `frontend` (monorepo: set Vercel project root to `frontend/` OR import only that subdir).
- **Build Command:** `npm run build` (default `next build`).
- **Output Directory:** default (`.next` — leave blank; do NOT set `out/`).
- **Install Command:** `npm install` (lockfile `frontend/package-lock.json` present).
- **Node.js Version:** 20+ (repo `engines: node >=20`; Vercel default 20/22 both fine).
- **`vercel.json`:** none required and none created. No rewrites/redirects needed; trailing-slash + case normalization lives in `src/middleware.ts` (308), security headers in `next.config.mjs`, sitemap/robots in App Router. Do not add custom config unless a future need arises.

## 3. Environment variables (Vercel Dashboard → Settings → Environment Variables)

Set for **Production** (and Preview if testing). `NEXT_PUBLIC_*` is inlined at build time — changing it requires a rebuild/redeploy.

| Variable | Scope | Required | Value rule |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Public (client) | Yes | `https://<prod-domain>`, no trailing slash, no localhost. `next start` refuses to boot otherwise (guard in `next.config.mjs`). |
| `NEXT_PUBLIC_API_URL` | Public (client) | Yes | `https://<api-host>` (browser-reachable backend). |
| `API_URL` | Server-only | Yes | Same as above (SSR + `/sitemap.xml` proxy). Falls back to `NEXT_PUBLIC_API_URL` when unset — set it explicitly anyway. |
| `NEXT_PUBLIC_SITE_NAME` | Public | No | Defaults `Football`. |
| `NEXT_PUBLIC_FEATURE_*` | Public | No | `LIVE/BREAKING/TRANSFERS/SEARCH/BOTTOM_NAV`; defaults in `frontend/.env.example`. |
| `NEXT_PUBLIC_ADMIN_BYPASS` | Public (dev-only) | **Must be unset/false** | Forced `false` when `NODE_ENV=production`; backend also refuses to boot with its bypass flag in prod. Never set `true` on Vercel. |

Template (names only): `VERCEL_ENV.example` at repo root. Local templates `frontend/.env.example` / `backend/.env.example` already contain names + dev placeholders only — no real secrets were added.

## 4. Backend host settings (NOT Vercel)

On the API host set `NODE_ENV=production` plus (see `backend/.env.example`):

```
PORT=<injected by host>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service-role key — server-only, rotate the dev key flagged compromised in backend/.env comments>
CORS_ORIGINS=https://<vercel-app-domain>[,https://www.<domain>]
SITE_BASE_URL=https://<vercel-app-domain>
SITE_NAME=Football
ADMIN_BYPASS_AUTH=false
PROVIDER_BASE_URL= / PROVIDER_API_KEY= (BLOCKERs in prod when provider enabled; PROVIDER_ENABLED=false disables sync)
TRUST_PROXY_HOPS=<1 when behind proxy/load balancer>
```

Boot guards (`backend/src/lib/envRules.ts`) refuse prod start on missing/placeholder Supabase keys, `example.com`/`localhost` site URL, localhost-only CORS, or bypass flags. Run `npm run build && npm start`, plus `npm run worker` and `npm run scheduler` as companion processes.

## 5. Supabase configuration

- No schema change in this pass; request path uses `anonClient()` (RLS) for public reads and `serviceClient()` (service-role) only server-side for privileged/media/RBAC paths. Service-role key never appears in `frontend/` (verified by grep; only cautionary comments).
- Auth: Supabase Auth via backend `/api/v1/auth/login`; admin session in httpOnly cookies (`cc_at`/`cc_rt`), verified server-side on every admin request. Browser never holds service-role material.
- Storage: uploads go to Supabase Storage bucket (`MEDIA_BUCKET`, default `media`), never local disk. No local-file dependency on any request path (dataset/parquet reads are CLI-only).
- Before launch: rotate the dev service-role key noted compromised in `backend/.env` comments, tightening RLS as already configured; no data change.

## 6. Domain configuration

1. Deploy API host first; note its `https://` URL.
2. Create Vercel project with root `frontend/`, set env vars above with the final web domain as `NEXT_PUBLIC_SITE_URL`/`SITE_BASE_URL`/`CORS_ORIGINS`.
3. Assign the production domain in Vercel (Dashboard → Domains). No code change needed: canonicals, OG URLs, sitemap locs, and robots `Sitemap:`/`Host:` derive from `NEXT_PUBLIC_SITE_URL` / `SITE_BASE_URL`.
4. Update backend `CORS_ORIGINS` + `SITE_BASE_URL` to the assigned domain and restart API/worker/scheduler.

## 7. Admin configuration

- Panel lives at `/control-center` on the same Vercel deployment (no separate project needed).
- Middleware redirects anonymous `/control-center/*` → `/control-center/login` (308); `(protected)` layout re-verifies server-side (`redirect` or `AccessDenied`). Backend re-enforces `requireAdmin`/`requirePermission` on every `/api/v1/admin/*` call — the middleware gate is UX only, never the security boundary.
- No admin secrets in client JS (server actions + `next/headers` cookies only). Bypass flags are prod-fenced on both ends; keep them unset/false everywhere in production.

## 8. Post-deployment verification (run in order)

```bash
# 1. Frontend config
curl -s https://<domain>/robots.txt            # Allow:/, Disallow:/control-center + /api/, Sitemap: https://<domain>/sitemap.xml
curl -s https://<domain>/sitemap.xml           # index with 10 site-origin partitions
curl -s "https://<domain>/sitemaps/articles.xml" | head -c 300  # urlset, absolute canonical locs
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://<domain>/news/      # 308 → /news
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://<domain>/NEWS       # 308 → /news
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/og-default.png             # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/news/no-such-article-xyz  # 404 (prod)

# 2. Full SEO crawl against production
node scripts/seo-crawl-check.mjs --site https://<domain> --sample 100 --out reports/seo-crawl-prod.json
# Expect: 0 errors. Only acceptable WARNs: Google-News overlap, thin-content on genuinely empty feeds.

# 3. Backend health (from API host)
curl -s https://<api-host>/api/v1/health
curl -s https://<api-host>/api/v1/health/database
```

Also verify: homepage + one sample each of news/match/team/player/competition/transfer detail render 200 with self-consistent canonical; `/search?q=test` is `noindex,follow`; admin login flow works with a seeded admin (bypass off); `next.config` HSTS present (prod only).

## 9. Google Search Console setup (AFTER deployment, not now)

1. Verify property for the production domain; submit `https://<domain>/sitemap.xml` (index) — Google discovers partitions automatically.
2. Request inspection of `/` + a sample article/match/team page; monitor Coverage for 404s (expected only for genuinely removed slugs) and Enhancements for structured data.
3. Do NOT submit localhost/dev URLs. No Search Console action was taken in this pass.

## 10. Rollback procedure

- **Frontend:** Vercel Dashboard → Deployments → select previous production deployment → Promote to Production. No data impact (frontend is stateless; ISR revalidates from the API).
- **Backend:** redeploy previous API image/commit on the API host; restart `worker`/`scheduler`. Env vars are host-level and unchanged by a code rollback.
- **Supabase:** no migration shipped in this pass, so no DB rollback needed. If a later change adds migrations, roll back via the migration tool's down path + point-in-time restore per Supabase docs.
- Verify rollback with §8 checks (robots/sitemap/health + one detail page per type).

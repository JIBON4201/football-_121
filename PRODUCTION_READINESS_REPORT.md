# Production Readiness Report

Date: 2026-10-06
Scope: Frontend (Next.js 14), Backend API (Express), Supabase integration, env/secrets, SEO, security, performance.
Audit method: static code review of all three explore-agent findings + full production build, typecheck, ESLint, and frontend/backend test suites. No secrets were printed; only variable names and paths are referenced.

## Overall status

The application is architecturally production-ready: strict env guards, RBAC on all admin routes, sanitized admin audit logging, no SQL injection surface, no secret-leaking endpoints, RLS enabled on all tables, per-request CSP nonces, HSTS in prod, and all 547 backend + 640 frontend tests pass. Two release blockers remain before a public internet deploy.

## Critical blockers

1. **Unpatched Next.js CVEs (frontend).** `next` 14.2.35 is flagged by `npm audit` for 30+ advisories (critical/high: DoS via Server Actions/RSC, middleware bypass/SSRF, cache poisoning, middleware redirect cache poisoning, XSS via CSP nonces). Patched to the latest 14.2.x (14.2.35) in this pass; remaining advisories require a planned upgrade to Next 15.5.x/16.x. Must be scheduled before long-lived public exposure.
2. **React Server Components / Server Actions / Image optimizer DoS** — same root cause as #1; a subset is only fixed in 15.5.x/16.x. Deploy behind rate limits + a WAF/CDN (e.g. Cloudflare) in the interim.

## High-priority issues

1. **`GET /api/v1/articles/publish-due` performs a state change on any authenticated user** (`backend/src/routes/v1/articles.routes.ts:100-106`). No role check, GET method. Fix: require admin role + convert to POST, or delete and rely on the scheduler worker.
2. **Logout never revokes the refresh token server-side** — `auth.admin.signOut` was called on the anon client; FIXED in this pass (`backend/src/auth/passwordAuth.ts:36` now uses `serviceClient()`).
3. **Media bucket not provisioned** — no migration creates the Supabase Storage `media` bucket or its storage RLS policies; code serves public bucket URLs (`backend/src/media/storage.ts:22-27`). Fix: add a migration creating the bucket + explicit `storage.objects` INSERT/UPDATE/DELETE policies scoped to service role; document public-read intent.
4. **NewsArticle JSON-LD was missing `datePublished` and `publisher.logo`** and used inconsistent branding — FIXED in this pass (`frontend/src/app/(site)/news/[slug]/page.tsx:32-46`, `site-data.ts` now exposes `publishedIso`).
5. **Backend regex HTML sanitizer was bypassable** (stored-XSS path for any `author` role) — FIXED in this pass: `sanitizeContent` now uses `sanitize-html` with an allowlist (`backend/src/lib/validate.ts:124-160`); frontend already re-sanitizes at render (`frontend/src/lib/content.ts:29`).
6. **No `FORCE ROW LEVEL SECURITY`** on any table — owner/service connections bypass RLS. Acceptable for the service-role backend; add `FORCE ROW LEVEL SECURITY` if defense-in-depth is required.
7. **`ADMIN_BYPASS_AUTH=true` / `NEXT_PUBLIC_ADMIN_BYPASS=true` present in local envs** — dev-only and boot-refused in production (`envRules.ts`, `bypass.ts:106-114`), but confirm both are absent from the production deployment env.

## Medium-priority issues

1. **`trust proxy` not set** — all IP-keyed rate limits collapse behind a proxy. FIXED: `TRUST_PROXY_HOPS` config added (`backend/src/config.ts:28`, `app.ts:12`); set to your proxy hop count in production.
2. **No dedicated login throttling** — FIXED: new `auth` rate-limit class (≈10 req/min) on `/auth/login|register|forgot-password|reset-password` (`backend/src/lib/rateLimit.ts`).
3. **Cache store is a no-op** — `setCacheStore` is never called (`backend/src/lib/cache.ts:95`); all `cached()` calls hit PostgREST directly. Fix: call `setCacheStore(new MemoryCacheStore())` at boot or add Redis. Cache keys also lack an auth dimension — fine today (public-only call sites), but document before reusing for private data.
4. **Sitemap missing page types** — no entries for `/transfers/<id>`, `/news/category/*`, `/news/tag/*`, or the static index pages (`/`, `/news`, `/matches`, `/teams`, `/players`, `/competitions`, `/live`, `/breaking-news`, `/transfers`). Add them in `backend/src/services/sitemap.service.ts`.
5. **Category/tag/search metadata lack `openGraph`/`twitter`** (`frontend/src/app/(site)/news/category/[slug]/page.tsx:27-34`, `news/tag/[slug]/page.tsx:28-33`, `search/page.tsx:29-34`).
6. **`fetchRedirectTarget` defined but never called** (`frontend/src/lib/data-fetch.ts:99`) — renamed slugs 404 instead of 301/308. Wire it into page 404 paths or delete it.
7. **Breadcrumb JSON-LD fallback pointed at `https://touchline.example`** — FIXED (`frontend/src/components/touchline/page-components.tsx:103` now falls back to `siteConfig.siteUrl`).
8. **`/api/v1/docs.json` (full OpenAPI) public in all envs** — gate to non-prod or admin.
9. **Match-events admin router never mounted** (`backend/src/routes/v1/admin/match-events.routes.ts`) — dead code; mount or delete.
10. **`scripts/predeploy.mjs:146-161` rewards committed `.env` files** — inverts the intended check; treat presence of `backend/.env` in a repo as a failure.
11. **vitest/esbuild/tinypool audit findings (backend + frontend)** — dev-only; upgrade vitest to v5 when convenient.
12. **No `src/app/global-error.tsx`** — root-layout failures escape the error boundary.

## Low-priority issues

1. Two parallel JSON-LD components (`JsonLd.tsx` vs `StructuredData`) — unify long-term.
2. Category/tag/live/breaking/listing pages lack JSON-LD breadcrumbs/CollectionPage.
3. Trailing-slash redirect path drops the CSP request-header forwarding (harmless; response still gets CSP).
4. `frontend/.gitignore` was missing `.env.local` — FIXED.
5. Dev-flavored `.next` build artifacts embed localhost + bypass flags — rebuild with production env before deploy (already enforced implicitly by the domain guard).
6. React `Invalid value for prop 'action'` warnings in admin AccessDenied tests — cosmetic; fix the form action typing.
7. `frontend/.next`/backend `dist` carry no secrets (verified) — keep the deploy pipeline building fresh artifacts.

## SEO readiness

- `robots.txt` (`frontend/src/app/robots.ts`): correct — allows everything public, disallows `/control-center`, does NOT block `/search` (which is `noindex,follow`, so Google must be able to see that). `host` + `sitemap` directives present.
- Sitemaps: index proxied from backend; partitions for news/articles/matches/teams/players/competitions. Missing transfers + static index pages (Medium #4).
- Canonicals: all public pages set via `buildPageMetadata` (touchline) or page metadata; home canonicalizes to bare origin; trailing-slash normalized by middleware 308; middleware redirects `/path/` → `/path` consistently.
- Metadata coverage: all 19 public `(site)` pages export metadata/generateMetadata. Gaps: category/tag/search lack OG/Twitter (Medium #5); match/transfer pages lose canonical/robots when the SEO service is null (`data-fetch.ts:118-119`).
- Structured data: home has WebSite+SearchAction+Organization; news article has NewsArticle (fixed) + BreadcrumbList; teams SportsTeam; players Person; competitions SportsOrganization; match/transfer use backend-provided JSON-LD. Category/tag/search/live/breaking/index pages have none (Low #2).
- noindex/nofollow: search (`noindex,follow`), not-found branches, control-center (`noindex,nofollow,nocache` at `control-center/layout.tsx:11`), admin 404s with `x-robots-tag`. Correctly permissive elsewhere.
- `/control-center` disallows in robots + noindex — defense in depth confirmed.

**Google indexing readiness: READY after sitemap coverage + OG/Twitter metadata fixes (Medium #4, #5).**

## Security findings

- PASS: every `/api/v1/admin/*` route behind `authenticate({required:true})` + `requireAdmin()`/`requirePermission(...)` (16 route files); bypass fenced by 3 layers and refused at boot in prod.
- PASS: token verification introspects via Supabase `auth.getUser` (no alg confusion; identity/roles not taken from client claims).
- PASS: error handler never leaks stack/messages in prod (`errorHandler.ts:67-73`).
- PASS: no raw SQL; `escapeIlike` closes PostgREST `or=` injection; audit logging on all admin mutations with secret redaction; media uploads validated by magic-byte MIME + size + dimension caps, no SSRF surface; no endpoint returns service keys.
- PASS: CORS strict allowlist, fail-closed; CSP nonce per request; HSTS prod-only; `X-Content-Type-Options`, `X-Frame-Options DENY`, Referrer-Policy, Permissions-Policy set; COOP/CORP cross-origin for media.
- FIXED: regex XSS sanitizer → sanitize-html; logout revocation; `trust proxy`; auth rate limits.
- OPEN: Next CVE set (blocker #1/#2); `publish-due` GET mutation (High #1); docs.json public (Medium #8).

## Performance findings

- Production build succeeds: 39 pages, shared JS 87.3 kB, heaviest route `/search` at ~97 kB first load — healthy.
- Backend cache TTLs defined (static 300s / news 60s / matches 30s) but the cache store is a no-op (Medium #3).
- Static/ISR split: static for index pages, dynamic for `[slug]` detail routes with 60s revalidate on listing pages — reasonable.
- Media pipeline generates 5 variants up to 1600w — correct; `<img srcSet>` used on article covers; `fetchPriority="high"` on the hero.
- No oversized assets detected in build output; middleware runs on all non-static paths (26.9 kB) — acceptable.
- Watch: `dashboard.admin.service.ts` table/nameCol interpolation is internal-literal only; keep it that way.

## Backend/API findings

- All tests pass (547). Typecheck clean. Rate limiting per-class with `RateLimit-*` headers and 429 + Retry-After.
- OpenAPI at `/api/v1/docs.json` publicly reachable (Medium #8).
- Scheduler/worker/import CLIs guard production use (`--allow-production`, seed-provider refusal).

## Database findings

- 27 migrations apply cleanly conceptually; all 45 tables have RLS enabled with public `SELECT USING (true)` only on non-sensitive catalog data; admin/sync/audit tables gated by `public.is_admin(auth.uid())`.
- `supabase/apply-all.sql` is not re-runnable (documented); grants for diagnostic functions scoped to `service_role` after `REVOKE ALL FROM PUBLIC`.
- Missing: `media` bucket provisioning migration (High #3).
- `db.canonical`/`db.connectivity`/`data.freshness` verify steps are SKIP in dev (no DB) — run `npm run verify` against the production database once connected.

## Deployment requirements

1. Set production env: `NODE_ENV=production`, `SITE_BASE_URL=https://<domain>`, `CORS_ORIGINS=https://<domain>`, `SUPABASE_*` real values, `TRUST_PROXY_HOPS=<proxy hop count>`, `ADMIN_BYPASS_AUTH=false`/`NEXT_PUBLIC_ADMIN_BYPASS=false`, `PROVIDER_*` keys, no placeholders (envRules BLOCKER list will enforce).
2. HTTPS only at the edge; HTTP must 308 to HTTPS (HSTS + domain guard already force the canonical origin).
3. Buy/configure a CDN/WAF; route through `trust proxy` hops; per-instance rate limiting is fine for a single instance — add Redis for multi-instance.
4. Run `npm run verify` (with a real `SUPABASE_SERVICE_ROLE_KEY`) to clear the DB SKIPs; apply `supabase/migrations` or `apply-all.sql` to a fresh project.
5. Schedule a Next.js major upgrade (15.5.x/16.x) and vitest v5 upgrade.
6. Add the media bucket migration before first upload.
7. Rebuild frontend with production env so canonical/OG URLs are correct (domain guard refuses to boot otherwise).

## Recommended fixes (exact)

| # | File | Change |
|---|------|--------|
| 1 | `backend/src/routes/v1/articles.routes.ts:100` | Require admin role; change GET→POST; or remove in favor of the scheduler. |
| 2 | `supabase/migrations/028_media_bucket.sql` | Create the `media` bucket + storage.objects policies. |
| 3 | `backend/src/routes/index.ts:46` | Gate `/api/v1/docs.json` to non-prod or admin. |
| 4 | `backend/src/lib/cache.ts` | Call `setCacheStore(new MemoryCacheStore())` at boot. |
| 5 | `backend/src/services/sitemap.service.ts` | Add transfers partition + static index URLs. |
| 6 | `frontend/src/app/(site)/news/category/[slug]/page.tsx:27`, `news/tag/[slug]/page.tsx:28`, `search/page.tsx:29` | Add `openGraph`/`twitter` via a shared builder. |
| 7 | `frontend/src/lib/data-fetch.ts:99` | Call `fetchRedirectTarget` on detail 404s for 308 slug redirects. |
| 8 | `frontend/src/app/news/[slug]/page.tsx` (touchline) — DONE | NewsArticle JSON-LD datePublished/publisher.logo. |
| 9 | `backend/src/lib/validate.ts` — DONE | sanitize-html allowlist. |
| 10 | `backend/src/auth/passwordAuth.ts` — DONE | `serviceClient().auth.admin.signOut`. |
| 11 | `frontend/src/components/touchline/page-components.tsx` — DONE | Breadcrumb JSON-LD base URL. |
| 12 | `backend/src/config.ts`, `app.ts`, `lib/rateLimit.ts` — DONE | `trust proxy`; auth rate-limit class. |
| 13 | `frontend/.gitignore` — DONE | ignore `.env*`. |
| 14 | `frontend` next@14.2.35 — DONE | latest 14.2.x patch; plan 15/16 upgrade. |

## Fixes applied in this audit

- Replaced the regex HTML sanitizer in `backend/src/lib/validate.ts` with `sanitize-html` (allowlist, `http/https/mailto` only, `rel=noopener` on links).
- `logout` now uses the service client to revoke (`backend/src/auth/passwordAuth.ts`).
- Added `TRUST_PROXY_HOPS` and wired `app.set('trust proxy', …)` (`backend/src/config.ts`, `app.ts`).
- Added a tight `auth` rate-limit class for login/register/forgot/reset (`backend/src/lib/rateLimit.ts`).
- NewsArticle JSON-LD now carries `datePublished`, `publisher.logo`, absolute image (`frontend/src/app/(site)/news/[slug]/page.tsx`); `ArticleDetail.publishedIso` added (`site-data.ts`).
- Breadcrumb JSON-LD no longer falls back to `touchline.example` (`page-components.tsx`).
- Removed ESLint-failing unused imports in `breaking-news/page.tsx`.
- `frontend/.gitignore` now ignores `.env`, `.env.local`, `.env.*.local`.
- Upgraded `next` 14.2.18 → 14.2.35; backend `sanitize-html` + `@types/sanitize-html` added.

Verification after fixes: backend `tsc --noEmit` clean; backend 547/547 tests pass; frontend `tsc --noEmit` clean; ESLint clean; frontend 640/640 tests pass; `next build` succeeds (39 routes).

## Final decision

**PRODUCTION STATUS: NO-GO** — pending two blockers: (1) the Next.js 14 line carries unpatched critical advisories whose fixes require a major upgrade to Next 15.5.x/16.x (plan it before public launch or front it with a WAF + strict rate limits); (2) the Supabase `media` storage bucket has no provisioning/policies migration, so uploads/public URL behavior is undefined in a fresh project. All other blockers have code fixes available or are deployment-env tasks documented above. After the Next major upgrade and the media-bucket migration, with production env verified (`npm run verify` + envRules BLOCKER=0) and a fresh HTTPS production build, this site is ready for GO.

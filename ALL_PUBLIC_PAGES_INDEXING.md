# ALL Public Pages Indexing — Football Website

Goal: **every unique, valuable, public page → discoverable → crawlable → indexable**.
No UI redesign. No schema change. No fake pages. No keyword stuffing. No deploy, no Search Console submission (explicitly out of scope).

## 1. All public route types

Frontend is Next.js App Router. Canonical route table: `frontend/src/config/routes.ts` (mirrors backend SEO canonicals, enforced by tests).

| Route | Pattern | Source file |
|---|---|---|
| Homepage | `/` | `src/app/(site)/page.tsx` |
| News listing | `/news` | `src/app/(site)/news/page.tsx` |
| News detail | `/news/[slug]` | `src/app/(site)/news/[slug]/page.tsx` |
| News category | `/news/category/[slug]` | `src/app/(site)/news/category/[slug]/page.tsx` |
| News tag | `/news/tag/[slug]` | `src/app/(site)/news/tag/[slug]/page.tsx` |
| Breaking news | `/breaking-news` | `src/app/(site)/breaking-news/page.tsx` |
| Matches listing | `/matches` | `src/app/(site)/matches/page.tsx` |
| Match detail | `/matches/[slug]` | `src/app/(site)/matches/[slug]/page.tsx` |
| Live scores | `/live` | `src/app/(site)/live/page.tsx` |
| Competitions listing | `/competitions` | `src/app/(site)/competitions/page.tsx` |
| Competition detail | `/competitions/[slug]` | `src/app/(site)/competitions/[slug]/page.tsx` |
| Teams listing | `/teams` | `src/app/(site)/teams/page.tsx` |
| Team detail | `/teams/[slug]` | `src/app/(site)/teams/[slug]/page.tsx` |
| Players listing | `/players` | `src/app/(site)/players/page.tsx` |
| Player detail | `/players/[slug]` | `src/app/(site)/players/[slug]/page.tsx` |
| Transfers listing | `/transfers` | `src/app/(site)/transfers/page.tsx` |
| Transfer detail | `/transfers/[id]` (UUID) | `src/app/(site)/transfers/[id]/page.tsx` |
| Search | `/search` | `src/app/(site)/search/page.tsx` |

Non-public (never indexed): `/control-center/*`, `/api/*`, `/__probe__/*` (deleted), error/loading shells.

Current dataset reality (2026-10-07, via API + sitemap):
articles 10, matches 3, teams 4, players 8, competitions 1, transfers 1,
categories 0, tags 0, static pages 9 → **36 sitemap URLs**.
Zero categories/tags means taxonomy detail routes correctly 404 (no meaningful content to index, nothing invented).

## 2. Indexing rules

| Page type | Robots | Canonical | Sitemap? |
|---|---|---|---|
| `/`, `/news`, `/breaking-news`, `/matches`, `/live`, `/competitions`, `/teams`, `/players`, `/transfers` | `index,follow` | bare path on `NEXT_PUBLIC_SITE_URL` (home = bare origin, no slash) | `pages` partition |
| `/news/[slug]`, `/matches/[slug]`, `/teams/[slug]`, `/players/[slug]`, `/competitions/[slug]` | `index,follow` when entity exists + public; else `noindex` + 404 | `/news/slug`, `/matches/slug`, … (no query, no slash, lowercase) | `articles`, `matches`, `teams`, `players`, `competitions` |
| `/transfers/[id]` | `index,follow` when `announced/completed`; else 404 | `/transfers/uuid` | `transfers` |
| `/news/category/[slug]`, `/news/tag/[slug]` | `index,follow` when category active/tag exists **and** non-empty probe; empty → `noindex,follow`; unknown → 404 + `noindex` | base path; `?page=N` appended only when page>1 | `categories`, `tags` (currently 0 rows → 0 URLs, correct) |
| Paginated listings (`/competitions?page=2`, `/teams?page=2`, `/players?page=2`, `/transfers?page=2`, category/tag `?page=N`) | `index,follow` | includes `?page=N` + `Page N` title | via paginated partition fetch |
| `/news?page=N`, `/breaking-news?page=N` | `index,follow` (single-view archive, see §9) | **base only** (`/news`, `/breaking-news`) — paged strings never mint distinct canonicals | not separately listed |
| `/search`, `/search?q=*` | `noindex,follow` always, canonical always `/search` | `/search` | never |
| Unknown slug/id, inactive/draft/scheduled/rumour/cancelled, invalid UUID | `noindex` + real 404 (prod) | none | never |
| `/control-center/*`, `/api/*`, 404 shell, error shell | `noindex` (`control-center` also `nofollow`, `nocache`) | none | never |

No `noindex` on any valuable public type. No query-param canonicals except meaningful `?page=N`.

## 3. Sitemap architecture

Single source of truth: **backend** `backend/src/services/sitemap.service.ts`.
Served publicly: **frontend proxy** on the canonical origin (sitemaps must live on the URL host).

```
backend  /api/v1/sitemap.xml            → sitemap index
         /api/v1/sitemaps/:p.xml?page=N → partitions
         /api/v1/news-sitemap.xml       → Google News (48h window)
frontend /sitemap.xml                   → proxyBackendSitemap('/sitemap.xml')
         /sitemaps/:file[?page=N]       → validated + proxied
```

- Index: `GET /sitemap.xml` → `sitemapIndexXml` over `SITEMAP_PARTITIONS =
  ['news','articles','matches','teams','players','competitions','transfers','categories','tags','pages']`.
- `partitionUrl(name, page)` advertises **site-origin** URLs (`SITE_BASE_URL/sitemaps/name.xml`), never API-origin.
- `maxPerSitemap = clamp(SEO_SITEMAP_MAX_URLS=5000, 1, 50000)`; index caps 1000 pages/partition (Google limit 50000 URLs / 50MB respected by design).
- Eligibility mirrors public visibility: published + `published_at<=now` (news = last 48h), indexable match statuses only (excludes postponed/cancelled/abandoned), transfers `announced/completed` only, categories `is_active=true`.
- `revalidate = 3600`, `Cache-Control: public, max-age=3600, stale-while-revalidate=600`; upstream 4xx passed through as 404/400; 5xx/exception → `502 Sitemap temporarily unavailable` (never empty-200 deindex).
- Frontend guard `isValidPartitionFile`: `/^[a-z0-9-]+\.xml$/` + numeric `?page>=1`, else real 404.
- Google News overlap (`news.xml` vs `articles.xml` for recent stories) is intentional and allowed; the validator downgrades that specific overlap to WARN.

## 4. Canonical strategy

- Absolute URLs on `siteConfig.siteUrl` (`NEXT_PUBLIC_SITE_URL`, no trailing slash). Home = bare origin.
- Built in one place per stack: frontend `buildPageMetadata` / `toNextMetadata` (+ `routeUrl`/`entityUrl`), backend `absoluteCanonicalUrl` / `canonicalPath`.
- Rules: no query (except meaningful `?page=N`), no trailing slash (middleware 308), lowercase entity paths (middleware 308), no duplicate route formats, redirects served from `redirects` table via `/seo/redirect` (301, loop-safe, 10-hop max).
- Every indexable page emits `<link rel=canonical>`; fallbacks without a canonical stay `noindex` by construction (`toNextMetadata`).
- Production guard `next.config.mjs:assertProductionDomain` refuses `next start` when `NEXT_PUBLIC_SITE_URL` is missing/http/localhost/trailing-slash.

## 5. Robots strategy

Frontend `src/app/robots.ts` (what Google fetches):

```
User-Agent: *
Allow: /
Disallow: /control-center
Disallow: /api/
Sitemap: {siteUrl}/sitemap.xml
Host: {siteUrl}
```

- `/search` deliberately **allowed** so its `noindex,follow` is seen (blocking would freeze it as blocked, never deindexed).
- CSS/JS/images/fonts never blocked (`Allow: /` covers `_next/static`, `public/*`).
- Backend `src/seo/robots.ts` separately gates API paths (`/api/v1/me`, `/articles`, `/media/upload`, `/media/orphans`, `/api/v1/search`); not crawler-facing on the site origin.

## 6. Internal linking strategy (crawl paths)

All public links are plain `<a href>` (zero-JS crawlable; `next/link` only in admin). Mandatory paths:

- Header (all pages): `/live /matches /news /transfers /competitions /teams /players` + `GET /search` form; footer repeats + `/breaking-news`; mobile bottom nav: home/live/matches/news/search.
- `/` → competitions/teams/players cards (6/6/5) + latest/breaking/transfer stories + live/upcoming/recent match cards.
- `/news` → every sitemap article (pool + `fetchNewsList page1 limit100` merge) + breaking strip + **Browse by category/tag** directory (real taxonomy only; currently empty → renders nothing, no fake links).
- `/news/[slug]` → entity chips (`/teams|/players|/competitions…` from `fetchRelatedArticles`), related `/news/*`, sidebar + `More coverage` cards, `More {category}→/news`, `Fixtures→/matches`, `Transfer centre→/transfers`.
- `/matches` → anchor nav + every listed match card → detail; detail → home/away team, competition, players, related news, `All matches→/matches`, `Live→/live`.
- `/competitions/[slug]` → fixtures/results match cards, standings team links, squad `PlayerCard`s, related news; `/teams/[slug]` → opponent clubs, squad players, fixtures/results, news; `/players/[slug]` → current team, transfer teams, news; `/transfers/[id]` → player profile, from/to teams, transfer news, `Back to centre`, `Permalink`.
- Listings paginate with server `<a rel=prev/next>` + `Page X of Y` (`competitions/teams/players/transfers/category/tag/search`).
- No invented relationships: every link resolves from backend joins (`article_*`, `player_team_history`, `team_competitions`, match details fan-out). Unresolvable rows are dropped, never placeholder-linked.
- Deleted debug routes `src/app/__probe__` + `src/app/(site)/__probe2__` (crawl-budget waste, `noindex` shells).

## 7. Dynamic route strategy

- Server Components, ISR (`revalidate`: home 30, live 30, matches 30–300 by phase, news 300, breaking 60, transfers 600, taxonomy 300, sitemap 3600).
- `generateMetadata` per entity: backend `/seo/metadata` → `toNextMetadata` (canonical + robots + OG/Twitter) with honest fallbacks; listings via `buildPageMetadata`.
- Unique title/description per entity from backend snapshots (no stuffing, no boilerplate paragraphs).
- Structured data: home `WebSite+SearchAction` + `Organization`; `NewsArticle` (+publisher/logo); `SportsEvent` (scores only when finished); `SportsTeam`/`Person`; every detail + every listing emits `BreadcrumbList`; every listing emits `ItemList` (first 30 real URLs, absolute). Validated by `assertValidJsonLd`.
- Broken images never invented: OG image only from real entity image; global fallback `/og-default.png` now ships as a real 1200×630 PNG (previously 404).
- Footer + homepage breaking links fixed to canonical `/breaking-news` (was `/news?type=breaking` equity split).

## 8. 404 strategy

- Invalid slug/UUID → `notFound()` before any API call.
- API 404 / unpublished / inactive / rumour → `notFound()` → global `not-found.tsx` (`noindex`, public chrome, `Back to home`).
- Unknown admin path → `control-center/[...unmatched]/route.ts` 404 + `x-robots-tag: noindex,nofollow`.
- Transport/aggregation failure on detail (`matches/[slug]`, `transfers/[id]` error branch) → **throw → 500 via `error.tsx`**, never indexable 200 empty shell (soft-404 eliminated).
- `generateMetadata` for missing entities returns `noindex` titles (`* not found`), so even dev-streamed 200s carry `noindex` (prod sends real 404; validator treats dev 200+noindex+not-found-markers as WARN, prod 404 as pass).
- Redirects: slug changes recorded in `redirects` table, served 301 via `/seo/redirect` (loop-refused → 404).

## 9. Pagination strategy

- Meaningful pagination only: backend-paginated listings (`competitions/teams/players/transfers/category/tag`) with stable ordering, `?page=N` canonicals, `Page N` titles, `rel=prev/next` links.
- `/news` + `/breaking-news` are **single-view archives** (full story set server-rendered, client filter only): `?page=N` canonicalizes to the base, no fake `Page N` titles (previous duplicate-canonical defect fixed).
- `/transfers` paginates by backend page and now exposes prev/next nav (previously fetched page N but linked nothing → orphan pages fixed).
- `/matches`, `/live` are phase-grouped single views, no pagination (correct — no arbitrary `?page` space).
- Arbitrary combinations (search `q/type/competition/team/from/to/sort`, news `?type=` filters, directory client facets) never create indexable URLs: search canonical always `/search`, filters canonicalize to base, client facets have no URL state.
- `SEARCH_MAX_PAGE 50`, backend `maxLimit 100`, details fan-out caps (`MAX_RELATED_ROWS 500`, `MATCH_ENRICH_FANOUT 12`) bound crawl cost.

## 10. Validation process

Script: `scripts/seo-crawl-check.mjs` (extended for this goal; news/articles overlap allowed).

```
node scripts/seo-crawl-check.mjs [--site URL] [--sample N] [--out report.json] [--quiet]
```

Checks every run: robots fetch + `*` rule + `/control-center` blocked + public paths open + sitemap directive; sitemap index + all partitions 200 + urlset format + duplicate URLs (news overlap → WARN) + forbidden URLs (admin/api/search/login) never listed; per-page (static 9 + representative sample of article/category/tag/match/team/player/competition/transfer/listing): 200, `<title>` (10–120 chars), meta description (30–320), canonical present + self-consistent, `<h1>` present, ≥300 chars text (else thin WARN), JSON-LD parses + `@context/@type` + `NewsArticle` headline/datePublished; duplicate canonicals; sitemap coverage; orphan detection (sitemap URL never `<a>`-linked); `/news/` 308 + `/NEWS` 308 + `/Teams/Arsenal` 308; pagination canonical/title/noindex; 404 behaviour (prod 404, dev 200+noindex tolerated as WARN); `/search?q=test` must be `noindex`.

Exit 0 = zero ERRORs (WARNs never fail). Reports: `reports/seo-crawl-check.json` (sample 5), `reports/seo-crawl-full.json` (sample 100, exhaustive for current 36-URL corpus).

Latest exhaustive: **36 crawled (35 indexable, 1 noindex), 36 sitemap URLs, 0 errors, 2 dev-only WARNs** (see report doc).

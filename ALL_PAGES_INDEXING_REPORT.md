# ALL Pages Indexing Report — Football Website

Date (UTC): 2026-10-07. Site checked: `http://localhost:3000` (dev). API: `http://localhost:4000`.
Scope: implementation + validation finished. **No deploy. No Search Console submission.** Stop after this report.

## 1. Totals

| Metric | Value | Source |
|---|---|---|
| Total public URL types | 18 (home, news, news detail, news category, news tag, breaking-news, matches, match detail, live, competitions, competition detail, teams, team detail, players, player detail, transfers, transfer detail, search) | `src/config/routes.ts` + `ALL_PUBLIC_PAGES_INDEXING.md §1` |
| Total discoverable URLs (sitemap corpus) | 36 | `GET /sitemap.xml` → 10 partitions |
| Total sitemap URLs | 36 | validator `stats.sitemapUrls` (exhaustive run) |
| Total indexable URLs (crawled) | 35 | validator `stats.indexable` (sample 100 = all 36 pages: 35 index + 1 noindex) |
| Total noindex URLs (crawled) | 1 (`/search?q=test` probe; `/search` itself is the permanent noindex) | validator `stats.noindex` + `search-indexable` check |
| Orphan pages found | 0 | validator `orphan-pages` (exhaustive run) |
| Missing canonical URLs | 0 | validator `missing-canonical` |
| Missing metadata (title/description) | 0 / 0 | `missing-title`, `missing-description` |
| HTTP errors (indexable sample) | 0 | `http-error`, `sitemap-partition`, `not-404` |
| Duplicate URLs (sitemap) | 0 errors (1 allowed Google-News overlap downgraded to WARN) | `sitemap-duplicate-url` |
| Duplicate canonicals (crawled) | 0 | `duplicate-canonical`, `canonical-mismatch` |
| Empty content (`<h1>` missing) | 0 | `empty-content` |
| Invalid structured data | 0 | `invalid-structured-data` |

Sitemap partition breakdown (live fetch 2026-10-07):

| Partition | URLs | Notes |
|---|---|---|
| `/sitemaps/news.xml` | 0 | Google News, 48h window — corpus has no <48h stories, correct |
| `/sitemaps/articles.xml` | 10 | all published articles |
| `/sitemaps/matches.xml` | 3 | indexable statuses only |
| `/sitemaps/teams.xml` | 4 | |
| `/sitemaps/players.xml` | 8 | |
| `/sitemaps/competitions.xml` | 1 | |
| `/sitemaps/transfers.xml` | 1 | announced/completed only |
| `/sitemaps/categories.xml` | 0 | 0 active categories in DB — correct, nothing invented |
| `/sitemaps/tags.xml` | 0 | 0 tags in DB — correct |
| `/sitemaps/pages.xml` | 9 | `/ /news /breaking-news /transfers /matches /live /competitions /teams /players` |
| **Total** | **36** | |

## 2. Crawl runs

| Run | Command | Result |
|---|---|---|
| Sample | `node scripts/seo-crawl-check.mjs --site http://localhost:3000 --sample 5 --out reports/seo-crawl-check2.json` | 28 crawled (27 indexable, 1 noindex), 36 sitemap URLs, **0 errors, 2 WARNs** |
| Exhaustive (current corpus) | `node scripts/seo-crawl-check.mjs --site http://localhost:3000 --sample 100 --out reports/seo-crawl-full.json` | **36 crawled (35 indexable, 1 noindex), 36 sitemap URLs, 0 errors, 2 WARNs** |

Both WARNs are `soft-404-dev` for synthetic bad slugs (`/news/no-such-article-xyz`, `/teams/no-such-team-xyz`):
dev streams `notFound()` as HTTP 200 + `noindex` not-found content; **production (`next start`) sends a real 404** (validator passes 404 silently, flags only non-404 or indexable 200 as ERROR). Verify in a prod build before launch; no action in dev.

Earlier intermediate run (before category/tag + ItemList work settled) showed 1 transient `empty-content /news` + 2 orphans; re-run after edits is clean (0/0). No `thin-content`, `title-length`, `description-length`, `trailing-slash`, `uppercase-url`, `pagination-*`, `search-indexable`, `robots-*`, `sitemap-*` findings in the final runs.

## 3. Sitemap validation result — PASS

- `/sitemap.xml` 200, valid `sitemapindex`, 10 site-origin partitions, all partitions 200 + valid `urlset`.
- No admin/API/search/login/error/parameter URLs listed.
- No duplicate URLs (except intentional news/articles Google-News overlap → WARN, allowed).
- `news.xml` empty is correct (aging corpus); `categories/tags` empty is correct (empty tables).
- Proxy headers `application/xml`, `public, max-age=3600, stale-while-revalidate=600`; upstream 5xx → 502 (never empty 200).

## 4. Robots validation result — PASS

`GET /robots.txt` 200:

```
User-Agent: *
Allow: /
Disallow: /control-center
Disallow: /api/
Sitemap: http://localhost:3000/sitemap.xml
```

- `*` rule present; `/control-center` blocked; none of `/news /matches /teams /players /competitions /transfers /live` blocked; `/search` not blocked (its `noindex,follow` must be seen); no CSS/JS/image/asset path blocked.

## 5. Fixes shipped in this pass

1. Restored `src/middleware.ts` (was `.BAK`-only): `/news/→/news` 308, `/Teams/X→/teams/x` 308, `/NEWS→/news` 308 verified live.
2. `isValidPartitionFile` widened to `/^[a-z0-9-]+\.xml$/` (hyphen/number-safe, still rejects traversal/uppercase).
3. Footer + homepage breaking links → canonical `/breaking-news` (was `/news?type=breaking`).
4. Deleted crawl-budget waste `src/app/__probe__` + `src/app/(site)/__probe2__`.
5. Created real `public/og-default.png` (1200×630, 200 OK; was 404).
6. `/news` duplicate `?page=N` canonicals removed (single-view archive canonicalizes to base); added real category/tag directory + `BreadcrumbList` + `ItemList`.
7. `/transfers` pagination nav added (`rel=prev/next`, `Page X of Y`); `?page=N` canonicals already correct.
8. `matches/[slug]` + `transfers/[id]` transport failures → real 500 (was indexable 200 thin shell).
9. Listings (`competitions/teams/players/transfers/matches/live/breaking-news`) now emit `BreadcrumbList` + `ItemList` (first 30 real absolute URLs).
10. Validator: Google-News `news.xml`/`articles.xml` overlap downgraded to WARN (was false ERROR).

Tests: frontend `typecheck` clean, **640/640 vitest pass** (incl. `config`, `step42-seo`, `routes`); backend `typecheck` clean.

## 6. Residual knowns (not blockers, verify at launch)

- Dev soft-404s (above) must be re-checked as real 404s in a production build (`next build && next start` with production `NEXT_PUBLIC_SITE_URL=https://…`).
- Titles render as `X | Football | Football` (layout template `%s | Football` applied over builder-suffixed titles) — unique and within length, but redundant; left untouched to avoid breaking the tested metadata contract.
- Categories/tags corpus is empty: taxonomy routes + directory sections correctly render nothing/404 today and will light up automatically when rows exist (no code change needed).
- `Host:` directive in robots.txt is legacy (ignored by Google) — harmless.

## 7. Final readiness status

**READY for production-build verification, NOT for deploy or Search Console.**

- Every unique, valuable, public URL in the current corpus is **discoverable** (`<a>` crawl paths + pagination), **crawlable** (robots allow + 200 + SSR HTML), **indexable** (`index,follow` + canonical + title/description + OG + valid JSON-LD), and **sitemap-listed** (36/36).
- Non-search pages correctly `noindex` + 404/500; search/filter/pagination rules prevent infinite crawl space.
- Validation: **0 errors** on the exhaustive 36-page crawl. Do not submit to Google Search Console. Do not deploy. Next step when authorized: prod-build crawl re-check, then launch.

# Step 42 — Final SEO & Google Indexing Audit

Audit of crawlability, canonicalization, structured data, sitemaps and robots
before deployment. Findings are graded **PASS / WARNING / BLOCKER**, and nothing
verified only in theory is reported as verified.

## Build verification

| | Backend | Frontend |
| --- | --- | --- |
| typecheck | PASS | PASS |
| lint | n/a | PASS |
| tests | PASS — 408 (30 files) | PASS — 461 (25 files) |
| production build | PASS | PASS |

869 tests, up from 817. One pre-existing assertion was updated — see below.

## BLOCKERS found and fixed

### 1. Sitemaps were advertised at URLs that 404 for Google

`partitionUrl()` produced `${site.baseUrl}/api/v1/sitemaps/<name>.xml` — the
**frontend** origin combined with an **API** path. The API is a separate origin
in production and the frontend serves no `/api/*` routes, so every `<loc>` in the
sitemap index pointed at a 404. Google would have found no usable sitemap at all.

The backend still generates the documents, but the index now advertises
`${site.baseUrl}/sitemaps/<name>.xml` on the public origin, and the frontend
re-exposes them there. Sitemap files now sit on the same host as the URLs they
list, which is what Google requires.

### 2. The site had no `/robots.txt` and no `/sitemap.xml`

Crawlers fetch `<site>/robots.txt`. The project only had an *API*
`/api/v1/robots.txt`; the public site 404'd at both locations. Added to the
Next app:

- `app/robots.ts` → `/robots.txt`
- `app/sitemap.xml/route.ts` → `/sitemap.xml` (index)
- `app/sitemaps/[file]/route.ts` → `/sitemaps/<partition>.xml`

No SEO logic is duplicated — the frontend proxies the backend's generated
documents. Verified at runtime: `robots.txt` 200, sitemaps 502 when the backend
is down (**not** a misleading empty 200, which could be read as "no URLs"), and
path traversal rejected with 404.

### 3. Recorded redirects were never served

Every slug change writes a 301 to the `redirects` table, with chain and loop
prevention — but **nothing read that table**. An old article URL simply 404'd,
losing accumulated link equity and stranding already-indexed results.

Added `GET /api/v1/seo/redirect?path=…` (documented in `openapi.json`) and wired
`news/[slug]` to issue a permanent redirect when a slug misses. It returns
`{ redirect: null }` when nothing is recorded, when the chain loops, or when the
lookup fails — so a broken lookup degrades to a 404 rather than redirecting
somewhere unknown.

### 4. No production domain guard on the frontend

Verified by running the built app: robots.txt emitted
`Host: http://localhost:3000` and `Sitemap: http://localhost:3000/sitemap.xml`.
Nothing stopped a misconfigured deploy from handing Google localhost URLs as the
site's canonical identity.

`next.config.mjs` now asserts the production domain: `next build` warns,
`next start` **refuses to boot**. Both paths verified. This mirrors the backend's
`assertEnvIsSane()`.

## WARNING

- **MEDIUM** — No production entrypoint calls `setCacheStore()`, so server-side
  response caching is a no-op. HTTP `Cache-Control` is still emitted, so CDN and
  browser caching are effective. Pre-existing, unchanged, documented.

## Verified as already sound

No changes were needed for any of the following:

- **Canonical URLs** — one deterministic path per entity type, no query strings,
  no trailing slash, invalid slugs rejected before they can become a URL,
  round-trip parse works, case-insensitive duplicate detection, redirect-loop
  detection.
- **Structured data** — `NewsArticle`/`Article` (correct type per article type),
  `SportsEvent` with valid `eventStatus` for every match state, `SportsTeam`,
  `Person`, `Organization`, `WebSite`, `BreadcrumbList`. Nothing fabricated:
  missing headline, date, name or teams returns `null` rather than an empty node;
  a venue is omitted when unknown; **scores are only emitted when the match is
  `finished`**, so a live score can never be published as a final result.
  `dateModified` is omitted when an article was never updated. `</script>` is
  escaped for inline embedding.
- **Status codes** — unknown news/team/player/match/competition/transfer all
  return real 404s; drafts are 404 to the public; malicious slugs are rejected
  with 400 rather than searched for.
- **Indexing strategy** — `/search` is `noindex,follow` with a canonical `/search`.
  Critically, it is **not** blocked in robots.txt: blocking it would stop Google
  from ever seeing the `noindex`. `/matches` and `/news` canonicalize filtered
  and paginated permutations to the base listing, which prevents crawl-space
  expansion; invalid filter values 404.
- **Trailing slash** — middleware 308-redirects `/path/` → `/path`.
- **Sitemap content** — absolute URLs only, no `localhost`, balanced XML, escaped
  metacharacters, drafts and unpublished articles excluded, news sitemap scoped
  to the configured recency window.
- **Caching** — the new sitemap routes revalidate hourly, matching the backend's
  `SEO_CACHE_TTL`, and serve `no-store` on failure.

## Test suite added

- `backend/tests/step42-seo.test.ts` — **42 tests**: canonical generation and
  rejection, sitemap origin and content, robots directives, all structured-data
  types, redirect resolution (including chain following and cycle refusal), 404
  behaviour, and domain hygiene.
- `frontend/tests/step42-seo.test.ts` — **10 tests**: robots crawl policy,
  partition filename validation (traversal), and the metadata bridge.

## One existing assertion changed

`tests/seo.test.ts` asserted that robots.txt contains `/api/v1/sitemap.xml` —
i.e. it **locked in the broken behaviour**. It now asserts the corrected
public-origin URL *and* that the old broken shape is absent, so the contract is
stronger than before, not weaker.

## Still unverified

Everything above was verified against the code and the in-memory fixture, **not**
against a crawl of a live deployment. Unverified until a real environment exists:

- Real crawl report (links, status codes, canonicals, robots directives) —
  **no deployment exists**, and this remains the Step 40 blocker
- Sitemap freshness against real publication timestamps (`lastmod` correctness,
  removal of unpublished content)
- Duplicate/near-duplicate content detection at production scale
- Orphan-page detection with real link graphs
- Open Graph images actually resolving and having correct dimensions
- Core Web Vitals on real hardware/network
- Google Search Console property verification and sitemap submission

No Search Console credential handling was added or automated.

## Google Search Console readiness

Once deployed with a valid `NEXT_PUBLIC_SITE_URL` and the API reachable:

1. `/robots.txt` — served, allow-all, points at `/sitemap.xml`
2. `/sitemap.xml` — index listing news, articles, matches, teams, players and
   competitions partitions
3. Submit `https://<domain>/sitemap.xml` in Search Console
4. URL Inspection works on canonical, noindex and redirect behaviour

The build-time warning and start-time fatal guard ensure step 1 cannot silently
ship a localhost domain.
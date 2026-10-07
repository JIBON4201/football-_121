# Step 41 — Production Performance & Security Hardening

What was audited, what was actually changed, and what remains open. The
governing principle is that a check which cannot run reports as **unverified**,
never as a pass.

## Build verification

| | Backend | Frontend |
| --- | --- | --- |
| typecheck | PASS | PASS |
| lint | n/a | PASS |
| tests | PASS — 366 (29 files) | PASS — 451 (24 files) |
| production build | PASS | PASS |

817 tests total, up from 784. No existing test was removed or weakened.

## Real defects found and fixed

### 1. Unbounded queries on public endpoints (production gate: "unlimited API queries")

`listBy()` / `listByIds()` / `listWhereIn()` in `repositories/related.ts` took an
**optional** `limit`. When a caller omitted it, PostgREST returned the entire
table. Real consequences on public, cacheable endpoints:

- `teams.repo.ts` — every player in a club's all-time history (thousands of
  rows), then all of those ids inlined into one `in=(...)` URL.
- `competitions.repo.ts` / `teams.repo.ts` — every `team_competitions` row,
  which grows with every season the club has contested, forever.
- `matches.repo.ts`, `players.repo.ts` — match events, lineups, statistics and
  career history.

**Fix at the source:** `limit` is now a **required** parameter, so the compiler
forces every call site to declare its bound. 32 call sites were given explicit,
semantically justified limits. Two hard caps back it up:
`MAX_RELATED_ROWS = 500` and `MAX_IN_CLAUSE_IDS = 300` (PostgREST encodes
`in=(...)` into the query string, so unbounded id lists eventually produce
rejected or truncated requests).

Five further unbounded reads were bounded individually: `slugTaken`,
article relations, media variants, a player's public transfers, and the
search relation filter (which previously capped rows in JavaScript *after*
fetching them all).

### 2. Two N+1 query loops

- `listOrphanMedia` called `findMediaReferences` once per media row — up to 100
  queries for one page. Replaced with a single batched lookup
  (`findMediaIdsWithoutReferences`).
- `deactivateRedirectsFor` read all matching rows then issued one `UPDATE` per
  row. Every row gets the same value, so it collapses to one bulk statement.

### 3. Oversized and malformed bodies returned HTTP 500

`express.json()` failures fell through to the generic handler, so a client
sending a 40 MB body got a `500` and the request was logged as an internal
server error. Body-parser errors are now mapped to their correct statuses:
`entity.too.large` → **413**, `entity.parse.failed` → **400**. Added
`PAYLOAD_TOO_LARGE` to the stable error envelope.

### 4. Seed/mock provider was registered in the production worker

`cli/worker.ts` and `cli/import.ts` called `registerSeedProvider()`
unconditionally, so a production worker would happily sync **fixture data** if a
`data_sources` row pointed at the `seed` provider. Registration is now gated on
`!config.isProd`, the import CLI refuses `--provider seed` in production, and
the verification tool no longer registers the mock adapter when running in
production.

### 5. Rate limiting was flat

A single budget treated a trivial `/health` probe exactly like a trigram search
or a full sitemap generation, so an expensive endpoint could exhaust the budget
ordinary browsing depends on. `classifyRequest()` now assigns cost classes with
separate buckets — `expensive` (search, sitemaps) at 1/6 of the browsing budget,
`admin` at 1/4, `media` at 1/2. Separate buckets also stop an attacker blending
classes to bypass one limiter. Every response now carries standard
`RateLimit-Limit` / `-Remaining` / `-Reset` / `-Policy` headers, and
classification strips the query string so it cannot be bypassed with `?...`.

### 6. Frontend was missing HSTS and several CSP directives

`next.config.mjs` sent no `Strict-Transport-Security`. Added, plus
`object-src 'none'`, `base-uri`, `form-action`, `font-src`, `X-DNS-Prefetch-Control`,
a widened `Permissions-Policy`, and explicit immutable caching for `/_next/static`.
HSTS **and** `upgrade-insecure-requests` are gated on production — unconditional
HSTS would pin browsers to `https://localhost` and break local development, and
`upgrade-insecure-requests` would upgrade the local HTTP API origin to HTTPS.

### 7. The test fake could not model `.limit()`

Hardening every query with an explicit bound broke 17 tests, because
`FakeQueryBuilder` had no `limit()` method. The fake now implements
`limit(n)` as `range(0, n-1)` (matching PostgREST) plus `single()`. This was a
gap in test infrastructure, not a product defect — but it had been masking the
fact that the fake modelled a narrower API surface than production actually uses.

## Hardening audit tooling

`src/verify/hardening.ts` adds six checks wired into `npm run verify`:

| Check | What it proves |
| --- | --- |
| `perf.pagination` | No list query in the repository/service layer lacks an explicit bound |
| `sec.rateLimits` | Expensive/admin tiers classify correctly and are cheaper than browsing |
| `sec.bundle` | No server-only import, Node built-in or credential in the browser bundle |
| `sec.headers.frontend` | Required headers configured, HSTS production-gated |
| `sec.prodConfig` | No debug mode, verbose error bodies, or unguarded mock-provider registration |
| `cache.wiring` | Whether a server-side response cache is actually installed |

Current offline result: **10 pass, 0 fail, 1 warn, 0 blockers.**

The unbounded-query detector deliberately does not flag write chains
(`.select('*')` is a `RETURNING` clause, with the verb *before* the select) and
scans to the end of the enclosing function, because fluent chains are frequently
assembled across statements.

## Regression tests

`tests/step41-hardening.test.ts` — 33 tests covering rate-limit classification and
tiers, `RateLimit-*` headers, pagination caps, bounded public lists, oversized
body rejection, authorization boundaries, XSS sanitization, SQL-injection
resistance, secret non-exposure, error-handling safety, and header expectations.

Performance is asserted through **query counts** rather than wall clock. The
in-memory fake makes timings nearly meaningless, while an accidental N+1 shows
up immediately as a jump in queries issued for a single request. Detail pages
(team, match, competition) are budgeted at ≤ 20 queries.

## Open findings — not resolved

| Severity | Finding | Why it is open |
| --- | --- | --- |
| **BLOCKER** | `next@14.2.18` carries 1 critical + 1 high advisory (unauthenticated RCE on Windows hosts; RCE in the AVIF image optimizer). | The advisory range extends past `16.3.0-preview.10`, so **no fix exists within Next 14** — the 14.x line tops out at 14.2.35. `npm audit fix --force` wants `next@16.3.8`, a two-major upgrade that Step 41 explicitly forbids doing uncontrolled. Mitigated, not fixed: this app uses **no `next/image`**, no `images` config, no AVIF, no Server Actions and no custom server, so the image-optimizer RCE is not reachable. Requires a planned major upgrade. |
| MEDIUM | No production entrypoint calls `setCacheStore()`, so server-side response caching is a no-op. | `cacheable()` emits HTTP `Cache-Control`, so CDN/browser caching is effective. `cache.ts` documents a deliberate "swap for Redis later" design. Left unchanged rather than silently altering cache semantics. |
| MEDIUM | In-memory rate limiter is per-process. | Documented swap point for Redis; correct for a single instance, not for multi-instance. |
| — | 16 Step 40 checks remain unverified. | No real environment exists — no `.env`, no Supabase project, no provider credentials, no deployment. All real-data verification is still outstanding. |

## What was verified as already sound

No changes were needed for: XSS (no `dangerouslySetInnerHTML` anywhere in the
frontend; article content is sanitized server-side), SQL injection (Supabase
query builder throughout, `escapeIlike` neutralises LIKE wildcards and
PostgREST filter syntax, slug regex rejects metacharacters), CORS (strict
allow-list, `credentials: false`, no wildcard), secret exposure (browser bundle
scanned, 0 hits), and authorization boundaries (all 5 admin endpoints plus
`/articles`, `/media/orphans/list` and `/me` return 401/403 anonymously, asserted
in tests).
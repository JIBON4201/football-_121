# omincalc Web — frontend foundation (Step 29)

Production frontend architecture for the global football website: Next.js 14
App Router, mobile-first, SEO-driven. Phase 1/2/3-ready without a rewrite.

## Structure

- `src/app/` — canonical routes (`/`, `/news`, `/news/[slug]`, `/breaking-news`,
  `/transfers`, `/matches`, `/matches/[slug]`, `/live`, `/competitions`,
  `/competitions/[slug]`, `/teams`, `/teams/[slug]`, `/players`,
  `/players/[slug]`, `/search`) + root layout/loading/error/not-found.
- `src/components/ui/` — generic primitives (Button, Card, Badge, Tabs,
  DataTable, Alert/EmptyState, Skeletons). No football logic.
- `src/components/domain/` — football components (Badges, MatchStatus,
  ScoreDisplay, MatchCard, NewsCard, EntityCard, DateTimeDisplay,
  LiveMatchList). Presentation-only, typed props.
- `src/components/layout/` — header, primary/mobile nav, footer, search access.
- `src/components/media/` — `ResponsiveImage` (Media Service variants).
- `src/components/seo/` — `JsonLd`, `Breadcrumbs` (backend SEO API data only).
- `src/lib/` — `api-client` (sole /api/v1 access), `data-fetch` (server/client
  strategy), `live` (polling today, WS/SSE interface for Phase 2), `store`
  (UI-only state), `dates` (UTC-first), `media`, `errors`, `validation`.
- `src/config/` — public site config, canonical route table (+ disabled
  Phase 2/3 structures), feature flags. No secrets (tested).
- `src/styles/` — centralized tokens + mobile-first globals.
- `src/middleware.ts` — trailing-slash normalization.

## Rules

- No raw `fetch` to the API outside `lib/api-client`.
- No second SEO rules engine: metadata/breadcrumbs/JSON-LD come from
  `/api/v1/seo/*`; `toNextMetadata` is the only mapping point.
- No image-processing logic in the frontend (backend Media Service owns it).
- Query strings filter; they never form canonical URLs.

## Commands

- `npm run dev` / `npm run build` / `npm run start`
- `npm run typecheck` / `npm run lint` / `npm test`

## Environment (public only)

See `.env.example`. Server components prefer `API_URL`; the browser uses
`NEXT_PUBLIC_API_URL`. Never add secrets here.

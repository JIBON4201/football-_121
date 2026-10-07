# Dataset Mapping Report — Global Football Data Lake → Supabase

> **Status: ANALYSIS ONLY.** No data was imported. No database, backend, frontend, or admin-panel file was modified. All dataset reads were read-only (parquet files opened read-only; profiling libraries installed outside the project in `%TEMP%`).
>
> Dataset inspected: `C:\Users\Dev\Desktop\football-dataset` ("Global Football (Soccer) Data Lake", CC-BY-4.0, sources: API-Football + football-data.co.uk, pipeline docs: `eatpizzanot/soccer-dataset`).
> Database inspected: `supabase/migrations/001–027` (43 tables + 2 admin views per project inventory).
> Method: `data_dictionary.md` + `QUALITY_REPORT.md` (2026-07-05) + `datapackage.json` cross-checked against **actual parquet reads** (hyparquet, head/tail/mid-file samples, 4,000-row scans + targeted key lookups). Sample windows are noted wherever a finding is sample-based rather than file-wide.

---

## 1. Dataset Overview

| Item | Value (verified) |
|---|---|
| Location | `C:\Users\Dev\Desktop\football-dataset` |
| Files | 11 × `.parquet` (total **~186 MB on disk**), plus `README.md`, `data_dictionary.md`, `QUALITY_REPORT.md`, `datapackage.json`, `croissant.json` |
| Fixtures | **673,966** rows (644,901 played per quality report) |
| Leagues | **271** (`leagues.parquet` row count verified: 271) |
| Teams | **11,104** |
| Players | **182,125** |
| Lineups (team sheets) | **565,370** rows |
| Fixture-player rows | **9,960,535** |
| Player-stat rows (flat) | **4,903,099** |
| Team-stat rows | **283,834** |
| Odds rows | **213,983** |
| xG training rows | **257,492** (2 rows per fixture: home + away) |
| League catalogue rows | **1,235** (reference only) |
| Date span (docs) | 2008-06-07 → 2027-06-06 (includes **future scheduled fixtures**, ~1 year ahead) |
| Date span (spot sample, head+tail) | 2016-05-06 → 2026-09-12 (full range not re-scanned; docs value accepted) |
| License | **CC-BY-4.0 — attribution to API-Football and football-data.co.uk is legally required** if we publish/import this data |
| Quality gate | **PASS 54/54** (0 blocking failures, 0 warnings per `QUALITY_REPORT.md`) |

**What the dataset is:** a betting-modelling data lake (BTTS base rate 0.5063), not a CMS feed. It is very strong on fixtures, lineups, player appearances, and aggregate stats; it has **no editorial content, no transfers, no match-event timelines, no venues, no seasons table, and no countries table**.

---

## 2. File-by-File Statistics

Row counts below were **verified by reading parquet footers** (all match the docs exactly). Null % values are from `data_dictionary.md` (file-wide, pipeline-measured); "sample nulls" are from my own 4,000-row head scans — head samples skew old/played, so docs take precedence on nullability.

### 2.1 `fixtures.parquet` — 673,966 rows, 21 cols, ~12.3 MB

| Column | Type | Null % (docs) | Notes from actual samples |
|---|---|---|---|
| `id` | integer | 0% | PK. **Two id ranges observed**: small ids (`97582`) and 100M-range (`100822385`). Sample-distinct: 4,000/4,000 (head). |
| `api_football_id` | integer | 10.8% | 801/4,000 null in head sample; 0/3,966 null in tail sample. Nullable FK candidate. |
| `date_utc` | datetime | 0% | Tz-naive, treat as UTC → `timestamptz`. |
| `league_id` | integer | 0% | 64 distinct in head sample. Spot-checked: `46`→"Primera A" (Colombia), `100000165`→"1. Deild" — resolves in `leagues`. |
| `home_team_id` / `away_team_id` | integer | 0% | Spot-checked `995`→"Alianza Valledupar", `100004165`→"Vestri" — resolve in `teams`. |
| `goals_home` / `goals_away` | integer | 4.3% | Null = not played. 0–8 observed. |
| `status` | string | 0% | Raw code; identical values to `status_norm` in samples (FT/PEN/AET/NS/CANC/PST). |
| `referee_name` | string | 67.7% | 2,578/4,000 null in head sample. Free text (`C. Betancur`, `Sigurþórsson` — UTF-8 names OK). |
| `referee_api_id` | integer | **100%** | All-null in docs and in 4,000-row sample. **Drop.** |
| `created_at` / `updated_at` | datetime | 11.8% / 10.5% | **Pipeline timestamps (2026), not source times.** Do not map to business meaning. |
| `in_csv` / `in_pq` | boolean | 0% | Provenance flags. Anomaly: tail sample rows with **both false** — harmless, content complete. Do not import. |
| `merged_rows` | integer | 0% | 3 distinct values in head sample. Provenance; do not import. |
| `merged_football_data` | boolean | 0% | Provenance; do not import. |
| `status_norm` | string | 0% | Enum FT/AET/PEN/AWD/WO/NS/PST/CANC/ABD/SUSP/OTHER. Head: FT 3,982, PEN 10, AET 8. Tail: FT 3,667, NS 126, CANC 125, AET 45, PEN 2, PST 1. |
| `is_played` | boolean | 0% | Tail: true 3,714 / false 252. |
| `calendar_year` | integer | 0% | 10 distinct in head sample. Derivable; do not import. |
| `btts` | boolean | 4.3% | Derivable (`goals_home>0 AND goals_away>0`); do not import. |

Sample row (head): `{id: 97582, api_football_id: 1027981, date_utc: 2023-06-13T00:30Z, league_id: 46, home 995, away 994, goals 0-0, status FT, referee "C. Betancur", status_norm FT, is_played true, btts false}`.
Sample row (tail): `{id: 100822385, api_football_id: 822385, date 2022-07-27, league 100000165, 4-0 FT, in_csv false, in_pq false}`.

- **Primary ID:** `id` (internal, stable across snapshots per docs). **Reference IDs:** `api_football_id` (nullable → cannot be the sole external key).
- **Date fields:** `date_utc` (kickoff). `created_at`/`updated_at` are pipeline metadata.
- **Team fields:** `home_team_id`, `away_team_id`. **Competition:** `league_id`. **Match/fixture:** everything else.

### 2.2 `match_stats.parquet` — 283,834 rows, 39 cols, ~6.7 MB (one row per fixture)

All columns `home_*`/`away_*` pairs. Key observations from 2 sample rows (fixture 287142/287156) + docs null %:

- Shots total/on-goal, corners, cards, HT goals well populated (~21–23% null).
- **Zone breakdown stored as `0`, not null**, in sampled rows (`inside_box: 0, outside_box: 0` with `shots_total: 10`) while docs report 27.7% null → **0-vs-unknown ambiguity is real** (see §5).
- `home_xg_ht`/`away_xg_ht` **100% null — drop.**
- `xg_covered`/`xg_nulled`/`known_at`/`stats_fetched_at` (74% null)/`in_csv`/`in_pq` are pipeline/QA columns: `known_at` useful for modelling, not for import; keep `xg_covered` logic in mind when handling xG (never import missing xG as 0).
- Sample row: `{fixture_id: 287142, shots 10-5, on-goal 6-3, corners 12-3, yellow 5-1, red 1-0, xg null/null (nulled, uncovered), HT 0-0, known_at kickoff+105min}`. Fixture 287142 **verified present in `fixtures`**.

- **Primary ID:** `fixture_id` (1:1 with fixtures). **Date field:** `known_at` (derived), `stats_fetched_at` (sparse).

### 2.3 `odds.parquet` — 213,983 rows, 9 cols, ~2.5 MB

Sample: `{fixture_id: 209707, home 1.3, draw 5.75, away 9, bookmaker Bet365, source CSV}`. Bookmakers in 4,000-row scan: Pinnacle 3,377, Bet365 554, Betfair 21, 888sport 16, William Hill 15, 1xBet 6 (docs: 96%+ Pinnacle closing). All `>1` per QA gate. `known_at` ≈ kickoff (closing line).

- **Primary ID:** `fixture_id` (assumed 1:1; not explicitly gated — verify before any use).
- **No destination table exists** (see §7).

### 2.4 `fixture_lineups.parquet` — 565,370 rows, 8 cols, ~6.7 MB

Sample: `{fixture_id: 176940, team_id: 52, team_name: "Charlton", coach: "K. Robinson" (17.6% null overall), formation: null (38% null overall)}`. Formations observed: 4-2-3-1, 4-4-2, 4-3-3, 3-5-2, 3-4-2-1, 3-4-1-2, 4-1-4-1 (all fit `varchar(30)`).

- **Primary ID:** composite (`fixture_id`, `team_id`) — matches `uq_match_lineups_match_team`.
- **Team field:** `team_id` (+ denormalized `team_name`, 0.4% null — use IDs, ignore name except reconciliation).

### 2.5 `teams.parquet` — 11,104 rows, 8 cols, ~0.3 MB

Sample: `{id: 1718, name: "El Paso Locomotive", api_football_id: 3993, fd_name: null (91.4% null), rating_mu: 1537.8, rating_sigma: 3.44 (42.5% null)}`.

- **Primary ID:** `id`. **Reference:** `api_football_id` (1.8% null).
- No country, venue, founded year, short name, logo. `rating_mu`/`rating_sigma` are Glicko-2 artefacts with **no DB destination** (`teams` has no `metadata` column).

### 2.6 `players.parquet` — 182,125 rows, 12 cols, ~4.1 MB

Sample: `{id: 59241, api_football_id: 6, name: "Leonardo Balerdi", photo: "https://media.api-sports.io/football/players/6.png"}`.
**`firstname`, `lastname`, `age`, `nationality`, `height`, `weight` are 100% NULL** (verified in docs; sample confirms). `photo` 52.7% null.

- **Primary ID:** `id`. Only reliably importable: name (+ split fallback), photo, api id.

### 2.7 `leagues.parquet` — 271 rows, 7 cols

Sample: `{id: 1, name: "Premier League", country: "England", fd_code: "E0" (46.9% null), api_football_id: 39}`.

- **Primary ID:** `id`. **Competition fields:** name + country string. No type/level/logo except via catalogue (`af_type`: League/Cup).

### 2.8 `fixture_players.parquet` — 9,960,535 rows, 11 cols, ~97.8 MB (largest file)

Sample: `{id: 93318, fixture 172044, team 4, player 18520 ("M. Derbyshire"), starter false, position null, number 27.0, captain false, minutes/rating null}`.
Position values mid-file: D 1,348 / M 1,509 / G 407 / F 702 / NULL 34 (≈0.85% null mid-file vs 33.3% file-wide — **nulls cluster**, likely early seasons/leagues). `number` is float (`27.0`), 6.7% null. `minutes`/`rating` 60%+ null.

- **Primary ID:** `id`. Positions are **single-letter codes** (G/D/M/F) — raw storage recommended, no invention of full names.

### 2.9 `fixture_players_stats_flat.parquet` — 4,903,099 rows, 36 cols, ~74.2 MB

Sample row (fixture 195490, sub, 45 min, rating "6.5"): cards 0/0, duels 6/3, `games_position: "M"`, `games_rating` + `passes_accuracy` are **STRINGS** (`"6.5"`, `"7"`, `"1"` — `"7"`/`"1"` accuracy values are suspect, see §5), `games_number` int, `penalty_missed`/`penalty_scored` int, `goals_total` 93.1% null, `offsides` 94.2% null, `penalty_commited` 99.2% null (sic — provider typo in column name).

- **Primary ID:** `fixture_player_id` → `fixture_players.id` (0 orphans per QA gate; one spot-check target below scan window — gate accepted).

### 2.10 `league_catalogue.parquet` — 1,235 rows, 15 cols (reference only)

`history_status`: not_in_dataset 964 / full 262 / partial 8 / recent_only 1 (matches QA report: 262+8+1 in-dataset leagues ≈ 271). Carries `min_season`/`max_season` (season-range source), `af_type` (League/Cup), `af_has_stats`, Cloudbet columns (betting-product scope — **irrelevant to our site**). `dataset_league_id` 78.1% null (only for in-dataset leagues).

### 2.11 `xg_training.parquet` — 257,492 rows, 15 cols, ~3.9 MB (ML feature table, redundant)

One row per side (`side` home/away + `is_home` mirror columns). Sample: `{fixture 280874, shots 19/8, inside 8, outside 11, blocked 3, corners 4, poss 44, pass_acc 80, xg 1.31}`. Content duplicates `match_stats` + `xg` target. **No destination; skip** (see §7).

---

## 3. Entity Structure & Relationships

```
leagues 1───∞ fixtures ∞───1 teams (home/away)
   │              ├───1 match_stats (0..1, 42% coverage)
   │              ├───1 odds (0..1, 32% coverage, SKIP)
   │              ├───2 fixture_lineups ───∞ fixture_players ───1 players
   │              │        (565k rows)        │  (9.96M rows)      (182k)
   │              │                           └───0..1 fixture_players_stats_flat (4.9M, 49% of appearances)
   │              └───2 xg_training rows (SKIP - redundant)
   └── league_catalogue (reference; N:1 leagues, 1,235 rows incl. out-of-dataset leagues)
teams 1───∞ fixture_players / lineups (via team_id)
players 1───∞ fixture_players (0 orphans per QA gate)
```

- **Cardinality verified:** match_stats 1:1 per fixture (283,834 < 644,901 played — coverage, not duplication); lineups ≈ 2/fixture (565,370 ≈ 2 × covered fixtures); fixture_players ≈ 14.8/fixture (squad subset — see §5.5); stats_flat ≈ 49% of fixture_player rows.
- **Join keys are integers, all resolvable:** spot-checked `leagues(46, 100000165)`, `teams(995, 100004165)`, `fixtures(287142)`, `players(35850)` all found. (Parquet ints decode as **BigInt** — the pipeline must stringify IDs before using them as `external_id`.)
- **NOT in the dataset (no files, no columns):** venues/stadiums, seasons table, season linkage on fixtures (only `calendar_year`), countries table (only name strings), match-event timelines (goals/cards as events), transfers/windows, articles/categories/tags, media, SEO, redirects, favorites, notifications, users/roles, audit, settings. `players.nationality` etc. are 100%-null columns, i.e. absent in practice.

---

## 4. Data Quality Analysis (verified + docs)

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 1 | `referee_api_id` 100% null | Low | drop column |
| 2 | `home_xg_ht`/`away_xg_ht` 100% null | Low | drop columns |
| 3 | `players`: firstname/lastname/age/nationality/height/weight 100% null | **High** | only name+photo usable; name-split fallback required |
| 4 | Zone-shot **0-vs-unknown ambiguity**: `shots_inside_box=0 AND shots_outside_box=0` with `shots_total=10` | **High** | sample rows fixtures 287142/287156; treat 0-zones as unknown when they contradict totals (import as NULL + log) |
| 5 | `games_rating`, `passes_accuracy` are **strings** (`"6.5"`, `"7"`, `"1"`); `"7"`/`"1"` accuracy implausible | Medium | coerce with range checks (rating 0–10, accuracy 0–100), else NULL + `sync_errors` row |
| 6 | `penalty_commited` misspelled in source | Low | map explicitly, document |
| 7 | `fixture_players.position` 33.3% null, clustered; mid-file single letters G/D/M/F | Medium | store raw codes; never invent positions |
| 8 | `api_football_id` nullable on fixtures (10.8%) and teams (1.8%) | **High** | external key must be dataset `id`, not provider id |
| 9 | 41 residual ambiguous duplicate fixture rows (flagged, ≤50 gate) | Medium | import must dedupe on (league, date, home, away); keep first, log rest |
| 10 | 1 pre-reconciliation goal conflict logged; 75 extreme blowouts kept as real | Low | accept; no action |
| 11 | 364 odds rows outside overround band; `in_csv=false AND in_pq=false` rows in tail sample | Low | odds skipped anyway; flags confirm pipeline metadata, not business data |
| 12 | Future fixtures to 2027-06 (≈29k unplayed) | Info | import as `scheduled` — desired for fixtures/upcoming surfaces |
| 13 | 267 thin league-years (<10 played); 8 partial + 1 recent-only league histories | Medium | gate import scope on `history_status` (full first) |
| 14 | Players per fixture ≈ 14.8 avg; `is_starter=false` conflates unused subs with bench; `minutes` 60% null | **High** | `substitute` derivation rule required (starter=false AND (minutes>0 OR rating present) → substitute=true, else false) + document assumption |
| 15 | `players.photo` hotlinks `media.api-sports.io` (52.7% null) | Medium | hotlinking third-party images: license/hotlink risk; consider proxy-or-drop policy (no `media` rows — do NOT fabricate media library entries) |
| 16 | CC-BY-4.0 license | **High (legal)** | attribution to API-Football + football-data.co.uk required wherever data is published |

---

## 5. Existing Database Compatibility (43 tables)

Import-relevant tables: `countries`, `venues` (no source → stays empty), `competitions`, `seasons`, `teams`, `players`, `team_competitions`, `player_team_history`, `matches`, `match_events` (**no source → stays empty**), `match_lineups`, `match_lineup_players`, `match_team_statistics`, `match_player_statistics`, `transfer_windows`/`transfers` (**no source → stay empty**), `data_sources`, `external_entity_ids`, `sync_jobs`/`sync_errors`. Editorial tables (`articles`, `categories`, `tags`, `media`, `seo_metadata`, …) are untouched by this dataset.

Key constraints driving the mapping: all PKs are `uuid` (dataset ints must map via `external_entity_ids`, never as PKs); `matches.slug` UNIQUE NOT NULL (must generate); `seasons.competition_id` NOT NULL + unique per name (**fixtures carry no season → seasons must be synthesized**); `team_competitions.season_id` NOT NULL (same dependency); `transfers`/`transfer_windows` RESTRICT rules irrelevant (no data); `matches` has **no `metadata` column** and `teams`/`players` have **no `metadata` column** — surplus attributes (Glicko ratings, xG, odds, height/weight strings) have nowhere to land except `match_team_statistics.metadata`, `match_player_statistics.metadata`, `transfers.metadata` (unused here).

---

## 6. Proposed Supabase Table Mapping

Conventions: one `data_sources` row, e.g. `{name: 'football-dataset-2026-07', provider: 'dataset', api_version: '1.0'}`; every imported row gets an `external_entity_ids` row `(source, entity_type ∈ {competition, season, team, player, match}, external_id = String(dataset id))`. `api_football_id` recorded as a **second** external-id row where present (same source, `external_id = 'apif:<id>'`) to allow future provider merges.

| # | Dataset file/fields | Supabase table | Field mapping / rules |
|---|---|---|---|
| 1 | `leagues.country` (distinct strings) | `countries` | Synthesize: `name` = distinct country ("England", …); `code` = ISO-3 lookup, **problem: "World" (Euro/Confed cups) has no ISO code** → use documented pseudo-code (e.g. `WLD`) or leave `competitions.country_id` NULL for those; `slug` from name. Requires manual code table for ~40–60 distinct values — small, one-off. |
| 2 | `leagues` (271) | `competitions` | `name`→`name`; `slug` generated+uniquified; `short_name` NULL; `country_id`→§1 match (NULL for World); `type`←`league_catalogue.af_type` (League/Cup); `gender` NULL (unknown — do not assume "male"); `logo_url` NULL; `is_active` true. Dedup vs existing rows by normalized name. |
| 3 | `league_catalogue.min/max_season` + `calendar_year` | `seasons` | **Synthesize** per competition: name from season-year span. Rule: season label = August–July window for European-style leagues else calendar year (approximation — flagged in §9: fixtures carry no season id). `is_current` = latest only. `start/end_date` best-effort (Aug-01/Jul-31 or Jan-01/Dec-31). |
| 4 | `teams` (11,104) | `teams` | `name`→`name`; `slug` generated+uniquified; `short_name` NULL; `country_id` NULL (no source — do not guess from league); `logo_url` NULL; `founded_year` NULL; `venue_id` NULL. Dedup vs existing by normalized name. `rating_mu/sigma`, `fd_name` → **no destination, drop** (no metadata col). |
| 5 | fixtures×teams per season | `team_competitions` | Derive distinct (team, competition, season) from imported matches. Gated on §3 seasons existing. |
| 6 | `players` (182k) | `players` | `display_name`←`name`; `slug` generated+uniquified; `first/last_name`←split on last space **only if plausible, else NULL** (source columns are void); `date_of_birth` NULL; `nationality_id` NULL; `position` NULL (per-appearance only); `photo_url`←`photo` (hotlink policy decision, §4.15); `status` NULL. Dedup by normalized name + api id. |
| 7 | fixture_players (player, team, fixture date→season) | `player_team_history` | **Phase 2 (optional):** one row per (player, team, season): `joined_at` = earliest appearance, `shirt_number` = mode of `number`, `is_current` = latest season only. Skip in phase 1 — nullable paths cover the site. |
| 8 | `fixtures` (674k) | `matches` | `slug`←`{home-slug}-vs-{away-slug}-{date}`+id suffix, unique; `competition_id`, `season_id`←§3 synthesis (**nullable in DB — may stay NULL where ambiguous**); `venue_id` NULL; `home/away_team_id`; `scheduled_at`←`date_utc` (as UTC); `status`← mapping below; scores→`home/away_score` (+`home/away_score_ht` from match_stats); ET/penalty scores NULL (absent); `round`/`matchday`/`attendance` NULL; `referee_name` (≤150 chars). **Status map:** FT/AET/PEN→`finished`; NS→`scheduled`; PST→`postponed`; CANC→`cancelled`; ABD→`abandoned`; SUSP→`suspended`; **AWD/WO/OTHER→quarantine** (no safe equivalent; decide per-row: scores present→`finished`, else `cancelled`, logged). |
| 9 | — (no source) | `match_events` | **Stays empty.** No timeline data exists. |
| 10 | `fixture_lineups` + `fixture_players` | `match_lineups` / `match_lineup_players` | Lineup per (fixture, team): `formation` (validate ≤30 chars), `coach_name` (17.6% null). Players: `position` raw code (≤30), `shirt_number`←`number` (float→smallint, 1–99 else NULL per check), `starter`←`is_starter`, `captain`, `substitute`← rule in §4.14, `minutes_played`←`minutes` (0–150 else NULL). |
| 11 | `match_stats` (284k) | `match_team_statistics` | Direct: possession, shots→`shots`, on-goal→`shots_on_target`, corners, fouls, offsides, yellow/red, pass_accuracy; `passes` column **absent** (only accuracy) → NULL. Zone/corners extras, penalties, xG, HT-xG → **`metadata` jsonb** (`{shots_inside_box, shots_outside_box, blocked_shots, penalties, xg_home_computed…}`); xG stored ONLY with `xg_covered` provenance flag, never as official. `home_xg_ht` dropped (100% null). |
| 12 | `fixture_players_stats_flat` (4.9M) | `match_player_statistics` | Direct: minutes←`games_minutes`, goals←`goals_total`, assists←`goals_assists`, shots←`shots_total`, shots_on_target←`shots_on`, passes←`passes_total`, pass_accuracy←coerced `passes_accuracy`, tackles←`tackles_total`, interceptions, yellow/red cards, rating←coerced `games_rating`; `clearances` NULL (absent). **Rest → `metadata`**: duels, dribbles, fouls, saves, offsides, key passes, blocks, all penalty detail, conceded, captain/substitute/number/position context. String→numeric coercion with range validation, else NULL + `sync_errors`. |
| 13 | `odds`, `xg_training` | — | **No destination. Skip both.** No odds/xg tables exist; `matches` has no metadata column. Rationale documented; revisit only with a schema decision. |
| 14 | `league_catalogue` | — (reference) | Not imported as rows. Used for: import scope gating (`history_status`), season-range synthesis, `af_type`→competition.type. |
| 15 | all imported rows | `external_entity_ids` + `data_sources`/`sync_jobs` | UUID mapping registry + one `sync_jobs` record per batch (existing provider pipeline pattern). |

---

## 7. Missing Required Fields (DB needs, dataset lacks)

| DB requirement | Dataset status | Resolution |
|---|---|---|
| `seasons` rows + fixture→season linkage | No seasons table; only `calendar_year` + catalogue ranges | Synthesize per §6.3 (approximation, documented) |
| `matches.slug` (unique, required) | No slug | Generate + uniquify |
| `matches.round/matchday/attendance`, ET/penalty scores | Absent | NULL (all nullable ✓) |
| `matches.venue_id`, `teams.venue_id` | No venues anywhere | NULL; venues stay admin-managed |
| `match_events.*` (entire timeline) | No goal/card/sub event feed | Table stays empty |
| `countries.code` (NOT NULL unique, 3 chars) | Only free-text names incl. non-countries ("World") | Manual ISO map + pseudo-code policy |
| `players` DOB/nationality/position/foot/height/weight | 100%-null or absent | NULL; height string unparseable→NULL |
| `teams` country/venue/founded/short_name/logo | Absent | NULL (never guess) |
| `competitions` gender/logo | Absent | NULL |
| `transfers`, `transfer_windows` | No files | Stay empty (admin-managed later) |
| Editorial (`articles`, `media`, `seo`, …) | None | Untouched |

Nothing on this list blocks import — every missing field is either nullable or synthesizable except slugs/codes/seasons, which have defined generation rules above.

---

## 8. Unused / Additional Dataset Fields (no DB destination)

| Field(s) | Reason to skip |
|---|---|
| `odds.*` (214k rows: 1X2, bookmaker, source) | No odds table; betting data is out of product scope; `matches` has no metadata column |
| `xg_training.*` (257k rows) | Redundant with `match_stats`; ML-training artefact, not site content |
| `referee_api_id`, `home/away_xg_ht` (100% null) | Void columns |
| `teams.rating_mu/sigma`, `teams.fd_name`, `leagues.fd_code` (46.9% null) | No destination columns; cross-reference value only — keep in ETL notes, not DB |
| `players.height/weight` strings | No valid target (`height_cm` needs 100–250 int; unparseable) — parse-or-NULL at most |
| `players.photo` hotlinks | Importable to `photo_url` but flagged (§4.15) — needs hotlink/licensing decision first |
| `league_catalogue` Cloudbet columns, `present/avail_years` | Betting-product scope; reference only |
| `in_csv/in_pq/merged_rows/merged_football_data/calendar_year/btts/created_at/updated_at(pipeline)` | Pipeline provenance/derivables; canalize into `sync_jobs` notes, not entity tables |
| `xg` values (coarse zone formula, R²≈1.0 vs shots) | Metadata-only with provenance flag; never display as modelled xG |

---

## 9. Recommended Import Order

Mirrors the existing provider `IMPORT.md` order (countries → … → transfers), constrained to what exists:

1. `data_sources` row + dry-run harness (`sync_jobs` status tracking per batch)
2. `countries` (manual ISO map, ~40–60 values) → `competitions` (271, name-deduped) → **`seasons` synthesis** (per competition; Aug–Jul vs calendar rule)
3. `teams` (11,104, name-deduped, slug-uniquified) → `team_competitions` derivation
4. `players` (182,125, slug-uniquified; photo policy decided)
5. `matches` in date batches (played first, then scheduled; status map + quarantine bucket for AWD/WO/OTHER; 41 flagged dups resolved by canonical key)
6. `match_lineups` + `match_lineup_players` (565k + ~11M? No — players subset actually imported; join on imported fixtures only)
7. `match_team_statistics` (284k, zone/penalty/xg → metadata)
8. `match_player_statistics` (4.9M, string coercion + range validation)
9. `external_entity_ids` registry written atomically per batch (rollback unit = batch)
10. (Phase 2, optional) `player_team_history` derivation; (Later) odds/xg schema decision — currently out of scope

Batching: date-ordered batches (e.g. 25–50k fixtures + dependents per `sync_jobs` record) so failures are resumable; validate FK resolvability per batch before write; re-run `verify_schema_health()` after.

---

## 10. Risks and Data Integrity Issues

1. **Volume (~16.6M importable rows; 9.96M + 4.9M dominant).** Replica lag, WAL pressure, index bloat — notably the pg_trgm search indexes (migration 017 covers matches/teams/players/competitions/articles). Mitigate: batch + off-peak + `REINDEX`/vacuum schedule; consider trigram-index rebuild after load.
2. **Season attribution is approximate.** Split-seasons (Aug–May) vs `calendar_year` will misattribute Jan–Jul fixtures without month-aware rules; South-American calendar-year leagues differ. Document rule; quarantine ambiguous (competition, month) combos for review.
3. **Substitute-status assumption** (§4.14) is load-bearing for lineups UX. Log assumption; surface "squad appearance" wording rather than "substitute" where uncertain — or store `substitute=false` + `minutes` and let UI infer.
4. **0-vs-NULL stats** (§4.4) can corrupt analytics (e.g. shots maps). Rule: zone fields contradicting totals → NULL + logged.
5. **String numerics** (`games_rating`, `passes_accuracy`) need strict coercion; out-of-range → NULL + `sync_errors` (existing table, no new infra).
6. **Slug collisions** at 674k scale (derbies share names/dates): deterministic suffix (`…-{dataset-id}` fallback) before insert; citext uniqueness errors must never abort a batch — collect + continue.
7. **ID type trap:** parquet integers decode as **BigInt**; JS `JSON.stringify` throws — pipeline must `String()` all IDs (verified during this inspection).
8. **Existing seed data collisions:** DB already holds editorial seed teams/players/competitions. Import must name-match (normalized, case-insensitive) and attach external IDs to existing rows instead of duplicating — else "Eastvale City" duplicates and public directory forks.
9. **License:** CC-BY-4.0 attribution required on published surfaces (footer/about page note naming API-Football + football-data.co.uk).
10. **xG misrepresentation:** provider xG ≈ deterministic function of shots (R²≈1.0), corr 0.39 with goals. If ever surfaced, label "provider estimate", never "expected goals model".
11. **Betting data excluded by default** (odds/Cloudbet). Revisit only as a product decision.
12. **No event timeline** means match-centre "events" stay empty for imported matches — UI already empty-states this; no action.

---

## 11. Final Import Strategy (estimate)

| Scope | Rows in | Rows importable (est.) |
|---|---|---|
| Competitions/countries/seasons | 271 + ~50 + ~1–3k synth | ~100% (after manual country map) |
| Teams | 11,104 | ~100% (minus name-merged seed dupes) |
| Players | 182,125 | ~100% (sparse profiles accepted) |
| Matches | 673,966 | ~100% minus AWD/WO/OTHER quarantine (~hundreds) and 41 flagged dups |
| Lineups + lineup players | 565,370 + ~9.96M appearances | gated on imported fixtures (~95%+, minus unplayed without sheets) |
| Team stats | 283,834 | ~100% |
| Player stats | 4,903,099 | ~100% minus coercion failures (logged, NULLed) |
| **Total importable** | **~16.6M rows** | **≈ 16.3–16.5M after quarantine/dedupe (~98–99%)** |
| Skipped by design | odds 214k, xg_training 257k, void/derivable columns | 0 rows |

Phasing: **Phase 1** — reference data (countries/competitions/seasons/teams/players, ~200k rows) on a staging copy; **Phase 2** — matches + lineups in date batches with per-batch `sync_jobs`; **Phase 3** — statistics tables; **Phase 4 (optional)** — history derivation + quarantine review. Each phase ends with `verify_schema_health()`, public-API spot checks (`/matches`, `/teams/:slug`, `/players/:slug/statistics`), and admin-UI verification before proceeding. No schema changes are required for Phase 1–3; any future odds/xG-surfacing needs a deliberate migration, not part of this plan.

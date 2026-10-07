# Initial Data Import & Seed System

Controlled population of canonical football data through the provider
pipeline. No step talks to providers directly except registered adapters.

## Workflow

`runImport(scope)` (or `POST /api/v1/admin/import`, or the CLI) executes
stages in dependency order:

countries → venues → competitions → seasons → teams → players →
matches → events → lineups → team-stats → player-stats → transfers

Each stage fetches normalized records, validates them, resolves canonical
entities via `external_entity_ids`, and persists idempotently
(lookup-first insert-or-patch, unique constraints as backstop).

## Scopes

- `provider` (default `seed`) or `dataSourceId`
- `entities`: subset of stages; order is always preserved
- `params`: adapter scope (`competitionExternalId`, `seasonExternalId`,
  `teamExternalIds`, `from`/`to` ISO dates, `limit`)
- `limit` (default 500, max 2000), `batchSize` (default 100)
- Default behavior is conservative: seed scope ships a handful of rows.

## Modes

- **Dry-run**: fetch + validate + classify (create/update/skip/conflict)
  with zero database writes. Invalid references surface as failures.
- **Import**: writes through `sync_jobs` (one job per stage) with per-record
  `sync_errors`; partial success yields `partial`, never silent drops.
- **Re-run**: safe by construction — stable external IDs re-resolve to the
  same rows; completed stages report `updated` instead of duplicating.

## Resume behavior

Jobs are per-stage, so an interrupted import resumes by re-running the same
scope: finished records resolve to updates, missing ones get created.
There is intentionally no destructive reset.

## Error handling & safety

- One bad record never stops a stage; failures are isolated per record.
- Ambiguous matches are recorded as conflicts, never auto-merged.
- Empty provider values never overwrite stored data (patch semantics).
- RLS, constraints, and RBAC (admin-only execution) stay enforced.

## Administrative execution

```bash
npm run import -- --dry-run
npm run import -- --entity teams --entity players --limit 200
npm run import -- --provider seed --from 2026-08-01 --to 2027-05-31 --json
```

Placeholders only — real provider names/keys come from server configuration
(`PROVIDER_<NAME>_BASE_URL` / `PROVIDER_<NAME>_API_KEY`), never from clients.

## Provider limitations (seed)

- Offline deterministic fixtures; transfers resolve without a window row
  (`window_id` stays null until transfer windows are synced).
- `limit`/`from`/`to` filtering is honored; full-text provider search is out
  of scope — use `/api/v1/search` on imported data instead.

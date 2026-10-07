# Scheduled Sync, Retry & Recovery Orchestration

`Scheduler → Job Queue → Sync Worker → Provider Adapter → Database.`
No sync/import logic is duplicated: the scheduler only decides *when*,
the worker only decides *how to execute safely*.

## Schedules

`sync_schedules` rows (`020_sync_schedules.sql`): name (unique), provider,
entity type (`countries`…`transfers`, or `import`), scope
(`entities`, `params`, `limit`, `batchSize`), `frequency_seconds` (≥ 60),
`enabled`, `priority`, `max_attempts`, plus runtime state (`last_run_at`,
`next_run_at`, `last_job_id`, `last_status`, `consecutive_failures`).
All timestamps are UTC; evaluation compares `next_run_at` only, so DST
changes cannot duplicate execution. No credentials are stored.

Typical cadences: metadata (teams/players/competitions) hourly–daily,
upcoming matches every 15–30 min, recent matches every 5–15 min,
match details after completion, transfers hourly where supported.

## Tick lifecycle

Each `tick()`:
1. Recovers stale jobs (running past lease → requeue or dead-letter).
2. Selects due schedules (`enabled`, `next_run_at <= now`).
3. Refreshes each schedule's previous job outcome.
4. Collapses missed windows (10h outage → 1 job, `catchUpCollapsed`).
5. Skips identical queued/running work via idempotency keys
   (`skipped-duplicate`), defers low-priority work past queue depth
   (`deferred-backpressure`), else enqueues and advances `next_run_at`.

## Match lifecycle hooks

`matchLifecycleWindows(now)` yields UTC `upcoming` (+7d) and `recent`
(−2d) windows for `from`/`to` scope params. Pre-match: frequent refresh;
live: high-frequency (future pipeline — hooks only, no polling here);
post-match: details sync (events/lineups/stats scoped per match);
historical: low-frequency. Details adapters may honor `matchExternalId`
or date windows; unknown params are ignored safely.

## Retry, backoff, recovery

Worker-owned (Step 23): transient failures retry with exponential backoff
+ jitter up to `max_attempts` (per schedule); permanent failures fail fast
with `sync_errors` rows. The sweeper requeues crash-orphaned jobs and
dead-letters exhausted ones. Cancel sets `cancel_requested`; loops observe
it between batches. Rate limiting stays provider-aware in the worker
(`ProviderThrottle`); the scheduler never storms — one job per schedule
per tick, depth-gated.

## Freshness

`getFreshness()` derives `fresh/aging/stale` (plus `unavailable` when no
history exists) from real `completed/partial` timestamps per
(provider, entity), with per-family windows. Future live/frontend
indicators consume this — values are never fabricated.

## Admin controls (all `requireAdmin`)

Schedules CRUD, manual trigger (same queue/validation/idempotency;
returns existing job when deduplicated), freshness, queue/worker health.
Public users have no access; payloads reject secret-bearing keys.

## Operations

- Local: `npm run scheduler` (`--interval` seconds ≥ 10, `--once` for a
  single evaluation), `npm run worker` in another shell.
- Production: supervise both processes; scale workers horizontally —
  claims remain single-winner. Monitor `workers/health`, freshness, and
  `consecutive_failures` per schedule. Never edit `sync_jobs` manually;
  recovery is automatic.

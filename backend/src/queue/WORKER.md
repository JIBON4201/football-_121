# Background Sync Worker & Job Queue

Long-running provider imports run outside HTTP requests. The queue **is**
the `sync_jobs` table (`019_sync_queue.sql`): durable, ordered by
`(status, priority, created_at)`, claimed with atomic conditional updates —
no vendor lock-in, no in-memory locks.

## Lifecycle

`queued` → `running` → `completed` / `partial` / `failed`.
Retries return to `queued` with a future `run_after`; attempts are bounded
by `max_attempts` (default 5, max 10). Cancel sets `cancel_requested`;
running work observes it between batches, queued rows are failed with
“Cancelled by operator”.

## Payload

`POST /api/v1/admin/sync` and `/admin/import` validate payloads with zod
(`{kind, dataSource, entityType|entities, jobType, params, limit,
batchSize, priority, maxAttempts}`) and reject secret-bearing keys.
Priority is admin-assigned (`high` 10, `normal` 100, `low` 1000); public
users have no access to any of these routes.

## Worker

`npm run worker` starts `SyncWorker`: poll → claim → heartbeat → execute
(`runSync` with adopted `jobId`, or `runImport` with `parentJobId`) →
release. Transient failures (timeouts, 5xx, 429, 503) retry with
exponential backoff; permanent ones (auth, validation, unsupported ops)
fail fast with a `sync_errors` row. At-least-once delivery: all persistence
is idempotent (external-ID mapping + unique constraints).

## Concurrency & rate limiting

Single-winner claims via conditional `UPDATE`; stale leases (crash,
restart) become re-claimable without manual edits. `ProviderThrottle`
paces jobs per provider (`--provider-interval`).

## Graceful shutdown

SIGTERM/SIGINT stop polling; active work finishes within
`--shutdown-timeout` (default 60s), otherwise the lease is released and the
job recovers via staleness. `--poll`, `--lease` flags tune the loop.

## Observability & health

Structured logs: `worker_started/stopping/stopped`, `job_claimed`
(queue latency), `job_completed` (duration), `job_retry`, `job_failed`,
`sync_complete`. `GET /api/v1/admin/workers/health` reports queue
reachability, active/stale/failed counts, and last success — no secrets.

## Operations

- Local: `npm run worker` (needs `SUPABASE_*` env; service role server-side).
- Production: run as a supervised process (systemd/Docker restart policy);
  scale horizontally — claims stay safe. Never expose worker controls publicly.

-- ============================================================================
-- 019_sync_queue.sql
-- Background job queue columns on sync_jobs (durable DB-backed queue).
-- No new tables: the queue IS sync_jobs, claimed via conditional updates.
-- All statements are transaction-safe (no ALTER TYPE ... ADD VALUE).
-- ============================================================================

ALTER TABLE public.sync_jobs
    ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 100;

ALTER TABLE public.sync_jobs
    ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.sync_jobs
    ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5;

ALTER TABLE public.sync_jobs
    ADD COLUMN IF NOT EXISTS claimed_by text;

ALTER TABLE public.sync_jobs
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

ALTER TABLE public.sync_jobs
    ADD COLUMN IF NOT EXISTS run_after timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.sync_jobs
    ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;

ALTER TABLE public.sync_jobs
    ADD COLUMN IF NOT EXISTS payload jsonb;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sync_jobs_priority') THEN
        ALTER TABLE public.sync_jobs
            ADD CONSTRAINT chk_sync_jobs_priority CHECK (priority >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sync_jobs_attempts') THEN
        ALTER TABLE public.sync_jobs
            ADD CONSTRAINT chk_sync_jobs_attempts CHECK (attempts >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sync_jobs_max_attempts') THEN
        ALTER TABLE public.sync_jobs
            ADD CONSTRAINT chk_sync_jobs_max_attempts CHECK (max_attempts >= 1 AND max_attempts <= 10);
    END IF;
END
$$;

-- Legacy running rows (pre-queue) predate leases: treat them as expired so
-- stale recovery can claim them without manual database edits.
UPDATE public.sync_jobs
SET lease_expires_at = now() - interval '1 hour'
WHERE status = 'running' AND lease_expires_at IS NULL;

-- Dequeue ordering: status, then priority, then age.
CREATE INDEX IF NOT EXISTS idx_sync_jobs_claim
    ON public.sync_jobs (status, priority, created_at);

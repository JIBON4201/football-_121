-- ============================================================================
-- 020_sync_schedules.sql
-- Sync schedules: persistent configuration for the background scheduler.
-- All timestamps are UTC (timestamptz); evaluation uses next_run_at only,
-- so daylight-saving transitions cannot cause duplicate execution.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sync_schedules (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 varchar(150) NOT NULL UNIQUE,
    provider             varchar(100) NOT NULL,
    entity_type          varchar(50)  NOT NULL,
    scope                jsonb       NOT NULL DEFAULT '{}'::jsonb,
    frequency_seconds    integer     NOT NULL,
    enabled              boolean     NOT NULL DEFAULT true,
    priority             smallint    NOT NULL DEFAULT 100,
    max_attempts         smallint    NOT NULL DEFAULT 5,
    last_run_at          timestamptz,
    next_run_at          timestamptz  NOT NULL DEFAULT now(),
    last_job_id          uuid        REFERENCES public.sync_jobs(id) ON DELETE SET NULL,
    last_status          varchar(50),
    consecutive_failures integer     NOT NULL DEFAULT 0,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_schedules_frequency CHECK (frequency_seconds >= 60),
    CONSTRAINT chk_schedules_priority  CHECK (priority >= 0),
    CONSTRAINT chk_schedules_max_attempts CHECK (max_attempts >= 1 AND max_attempts <= 10),
    CONSTRAINT chk_schedules_name_not_empty CHECK (length(btrim(name)) > 0),
    CONSTRAINT chk_schedules_failures CHECK (consecutive_failures >= 0)
);

CREATE INDEX IF NOT EXISTS idx_schedules_due
    ON public.sync_schedules (enabled, next_run_at);

DROP TRIGGER IF EXISTS trg_sync_schedules_updated_at ON public.sync_schedules;
CREATE TRIGGER trg_sync_schedules_updated_at
    BEFORE UPDATE ON public.sync_schedules
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sync_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_schedules_admin_select ON public.sync_schedules
    FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));

CREATE POLICY sync_schedules_admin_insert ON public.sync_schedules
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY sync_schedules_admin_update ON public.sync_schedules
    FOR UPDATE
    TO authenticated
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY sync_schedules_admin_delete ON public.sync_schedules
    FOR DELETE
    TO authenticated
    USING (public.is_admin(auth.uid()));

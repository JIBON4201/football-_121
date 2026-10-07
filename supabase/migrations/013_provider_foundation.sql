-- ============================================================================
-- 013_provider_foundation.sql
-- External Football Data Provider Foundation
-- ============================================================================

-- ============================================================================
-- 1. DATA_SOURCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_sources (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        varchar(150) NOT NULL,
    provider    varchar(100) NOT NULL,
    api_version varchar(50),
    is_active   boolean      NOT NULL DEFAULT true,
    priority    integer      NOT NULL DEFAULT 100,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_ds_name_not_empty     CHECK (length(btrim(name)) > 0),
    CONSTRAINT chk_ds_provider_not_empty CHECK (length(btrim(provider)) > 0),
    CONSTRAINT chk_ds_priority           CHECK (priority >= 0),
    CONSTRAINT uq_data_sources_name       UNIQUE (name)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_sources_provider_version
    ON public.data_sources (provider, COALESCE(api_version, ''));

-- ============================================================================
-- 2. EXTERNAL_ENTITY_IDS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.external_entity_ids (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id uuid         NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
    entity_type    varchar(50)  NOT NULL,
    entity_id      uuid         NOT NULL,
    external_id    varchar(255) NOT NULL,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_eei_entity_type_not_empty CHECK (length(btrim(entity_type)) > 0),
    CONSTRAINT chk_eei_external_id_not_empty CHECK (length(btrim(external_id)) > 0),
    CONSTRAINT uq_eei_source_type_external UNIQUE (data_source_id, entity_type, external_id),
    CONSTRAINT uq_eei_source_type_entity   UNIQUE (data_source_id, entity_type, entity_id)
);

-- ============================================================================
-- 3. SYNC_JOBS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sync_jobs (
    id                uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id    uuid              NOT NULL REFERENCES public.data_sources(id) ON DELETE RESTRICT,
    job_type          varchar(100)      NOT NULL,
    entity_type       varchar(50),
    status            public.sync_status NOT NULL DEFAULT 'queued',
    started_at        timestamptz,
    completed_at      timestamptz,
    records_processed integer           NOT NULL DEFAULT 0,
    records_created   integer           NOT NULL DEFAULT 0,
    records_updated   integer           NOT NULL DEFAULT 0,
    records_failed    integer           NOT NULL DEFAULT 0,
    error_message     text,
    created_at        timestamptz       NOT NULL DEFAULT now(),
    CONSTRAINT chk_sj_job_type_not_empty  CHECK (length(btrim(job_type)) > 0),
    CONSTRAINT chk_sj_records_processed   CHECK (records_processed >= 0),
    CONSTRAINT chk_sj_records_created     CHECK (records_created >= 0),
    CONSTRAINT chk_sj_records_updated     CHECK (records_updated >= 0),
    CONSTRAINT chk_sj_records_failed      CHECK (records_failed >= 0),
    CONSTRAINT chk_sj_completed_after_start CHECK (started_at IS NULL OR completed_at IS NULL OR completed_at >= started_at)
);

-- ============================================================================
-- 4. SYNC_ERRORS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sync_errors (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_job_id   uuid        NOT NULL REFERENCES public.sync_jobs(id) ON DELETE CASCADE,
    entity_type   varchar(50),
    external_id   varchar(255),
    error_code    varchar(100),
    error_message text        NOT NULL,
    payload       jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_se_error_message_not_empty CHECK (length(btrim(error_message)) > 0)
);

-- ============================================================================
-- 5. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ds_provider  ON public.data_sources (provider);
CREATE INDEX IF NOT EXISTS idx_ds_is_active ON public.data_sources (is_active);
CREATE INDEX IF NOT EXISTS idx_ds_priority  ON public.data_sources (priority);

CREATE INDEX IF NOT EXISTS idx_eei_data_source_id   ON public.external_entity_ids (data_source_id);
CREATE INDEX IF NOT EXISTS idx_eei_entity_lookup    ON public.external_entity_ids (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_eei_external_lookup  ON public.external_entity_ids (entity_type, external_id);

CREATE INDEX IF NOT EXISTS idx_sj_data_source_id ON public.sync_jobs (data_source_id);
CREATE INDEX IF NOT EXISTS idx_sj_status         ON public.sync_jobs (status);
CREATE INDEX IF NOT EXISTS idx_sj_job_type       ON public.sync_jobs (job_type);
CREATE INDEX IF NOT EXISTS idx_sj_entity_type    ON public.sync_jobs (entity_type);
CREATE INDEX IF NOT EXISTS idx_sj_created_at     ON public.sync_jobs (created_at);
CREATE INDEX IF NOT EXISTS idx_sj_status_created ON public.sync_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_se_sync_job_id  ON public.sync_errors (sync_job_id);
CREATE INDEX IF NOT EXISTS idx_se_entity_type  ON public.sync_errors (entity_type);
CREATE INDEX IF NOT EXISTS idx_se_external_id  ON public.sync_errors (external_id);
CREATE INDEX IF NOT EXISTS idx_se_created_at   ON public.sync_errors (created_at);

-- ============================================================================
-- 6. UPDATED_AT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS trg_ds_updated_at ON public.data_sources;
CREATE TRIGGER trg_ds_updated_at
    BEFORE UPDATE ON public.data_sources
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_eei_updated_at ON public.external_entity_ids;
CREATE TRIGGER trg_eei_updated_at
    BEFORE UPDATE ON public.external_entity_ids
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 7. RLS (operational tables: admin-only, no public access)
-- ============================================================================

ALTER TABLE public.data_sources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_entity_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_errors        ENABLE ROW LEVEL SECURITY;

CREATE POLICY data_sources_admin_select ON public.data_sources
    FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));

CREATE POLICY data_sources_admin_insert ON public.data_sources
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY data_sources_admin_update ON public.data_sources
    FOR UPDATE
    TO authenticated
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY data_sources_admin_delete ON public.data_sources
    FOR DELETE
    TO authenticated
    USING (public.is_admin(auth.uid()));

CREATE POLICY eei_admin_select ON public.external_entity_ids
    FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));

CREATE POLICY eei_admin_insert ON public.external_entity_ids
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY eei_admin_update ON public.external_entity_ids
    FOR UPDATE
    TO authenticated
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY eei_admin_delete ON public.external_entity_ids
    FOR DELETE
    TO authenticated
    USING (public.is_admin(auth.uid()));

CREATE POLICY sync_jobs_admin_select ON public.sync_jobs
    FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));

CREATE POLICY sync_jobs_admin_insert ON public.sync_jobs
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY sync_jobs_admin_update ON public.sync_jobs
    FOR UPDATE
    TO authenticated
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY sync_jobs_admin_delete ON public.sync_jobs
    FOR DELETE
    TO authenticated
    USING (public.is_admin(auth.uid()));

CREATE POLICY sync_errors_admin_select ON public.sync_errors
    FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));

CREATE POLICY sync_errors_admin_insert ON public.sync_errors
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY sync_errors_admin_update ON public.sync_errors
    FOR UPDATE
    TO authenticated
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY sync_errors_admin_delete ON public.sync_errors
    FOR DELETE
    TO authenticated
    USING (public.is_admin(auth.uid()));

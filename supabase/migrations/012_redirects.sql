-- ============================================================================
-- 012_redirects.sql
-- Production URL Redirect System
-- ============================================================================

-- ============================================================================
-- 1. REDIRECTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.redirects (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_path     text        NOT NULL,
    destination_path text       NOT NULL,
    status_code     smallint    NOT NULL DEFAULT 301,
    is_active       boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_redirects_source_not_empty     CHECK (length(btrim(source_path)) > 0),
    CONSTRAINT chk_redirects_dest_not_empty       CHECK (length(btrim(destination_path)) > 0),
    CONSTRAINT chk_redirects_source_slash         CHECK (source_path LIKE '/%'),
    CONSTRAINT chk_redirects_dest_slash           CHECK (destination_path LIKE '/%'),
    CONSTRAINT chk_redirects_not_identical        CHECK (source_path <> destination_path),
    CONSTRAINT chk_redirects_status_code          CHECK (status_code IN (301, 302, 307, 308))
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_redirects_active_source
    ON public.redirects (source_path)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_redirects_is_active   ON public.redirects (is_active);
CREATE INDEX IF NOT EXISTS idx_redirects_status_code ON public.redirects (status_code);

-- ============================================================================
-- 3. UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_redirects_updated_at ON public.redirects;
CREATE TRIGGER trg_redirects_updated_at
    BEFORE UPDATE ON public.redirects
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE public.redirects ENABLE ROW LEVEL SECURITY;

-- Public read: active redirects only
CREATE POLICY redirects_select_active ON public.redirects
    FOR SELECT
    TO anon, authenticated
    USING (is_active = true);

-- Editors/Admins: full management
CREATE POLICY redirects_insert_staff ON public.redirects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_editor(auth.uid())
    );

CREATE POLICY redirects_update_staff ON public.redirects
    FOR UPDATE
    TO authenticated
    USING (
        public.is_editor(auth.uid())
    )
    WITH CHECK (
        public.is_editor(auth.uid())
    );

CREATE POLICY redirects_delete_staff ON public.redirects
    FOR DELETE
    TO authenticated
    USING (
        public.is_editor(auth.uid())
    );

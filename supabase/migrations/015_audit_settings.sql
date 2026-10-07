-- ============================================================================
-- 015_audit_settings.sql
-- Audit Logging & System Settings
-- ============================================================================

-- ============================================================================
-- 1. AUDIT_LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid         REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    action      varchar(100) NOT NULL,
    entity_type varchar(100),
    entity_id   uuid,
    old_data    jsonb,
    new_data    jsonb,
    ip_address  inet,
    user_agent  text,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_audit_action_not_empty       CHECK (length(btrim(action)) > 0),
    CONSTRAINT chk_audit_entity_type_not_empty  CHECK (entity_type IS NULL OR length(btrim(entity_type)) > 0)
);

-- ============================================================================
-- 2. SYSTEM_SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.system_settings (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    key         varchar(150) NOT NULL UNIQUE,
    value       jsonb        NOT NULL,
    type        varchar(50)  NOT NULL,
    description text,
    updated_by  uuid         REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_settings_key_not_empty  CHECK (length(btrim(key)) > 0),
    CONSTRAINT chk_settings_type_not_empty CHECK (length(btrim(type)) > 0)
);

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_user_id       ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity_type   ON public.audit_logs (entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_entity_id     ON public.audit_logs (entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action        ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_created_at    ON public.audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity_lookup ON public.audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_created  ON public.audit_logs (user_id, created_at);

-- system_settings(key) already indexed via UNIQUE constraint; no extras needed.

-- ============================================================================
-- 4. UPDATED_AT TRIGGER (system_settings only; audit_logs is append-only)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_system_settings_updated_at ON public.system_settings;
CREATE TRIGGER trg_system_settings_updated_at
    BEFORE UPDATE ON public.system_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS
-- ============================================================================

ALTER TABLE public.audit_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Audit logs: admin read-only. No client INSERT/UPDATE/DELETE (append-only
-- via trusted service).
CREATE POLICY audit_logs_admin_select ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));

-- System settings: full admin management. No public/user access.
CREATE POLICY system_settings_admin_select ON public.system_settings
    FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));

CREATE POLICY system_settings_admin_insert ON public.system_settings
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY system_settings_admin_update ON public.system_settings
    FOR UPDATE
    TO authenticated
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY system_settings_admin_delete ON public.system_settings
    FOR DELETE
    TO authenticated
    USING (public.is_admin(auth.uid()));

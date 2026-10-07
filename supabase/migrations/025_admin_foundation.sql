-- ============================================================================
-- 025_admin_foundation.sql
-- Admin Database Foundation (STEP 2)
--
-- Scope: admin RBAC foundation ONLY. No Admin APIs, no Admin UI.
--
-- Equivalence audit (do NOT duplicate):
--   requested admin_roles      -> EXISTS as public.roles (001) + public.user_roles
--                                 super_admin/admin/editor/moderator already seeded.
--                                 Provided as VIEW admin_roles (compatibility, no new truth).
--   requested admin_users      -> EXISTS as auth.users + public.profiles + user_roles.
--                                 Supabase Auth remains the identity provider.
--                                 No passwords/credentials stored. Provided as VIEW admin_users.
--   requested admin_audit_logs -> EXISTS as public.audit_logs (015, admin-SELECT-only,
--                                 append-only via service). Provided as VIEW admin_audit_logs.
--   admin_permissions          -> MISSING (zero hits in 001-024). CREATED (real table).
--   admin_role_permissions     -> MISSING. CREATED (real table).
--
-- What this migration creates (and nothing else):
--   TABLES: public.admin_permissions, public.admin_role_permissions
--   VIEWS : public.admin_roles, public.admin_users, public.admin_audit_logs
--   FN    : public.has_admin_permission(uuid, text)
--   SEEDS : permission catalogue (~40 keys) + super_admin/admin full grants,
--           editor/moderator scoped grants (data only, no hardcoded auth logic).
--
-- What it does NOT do:
--   - No changes to the existing 43 tables (no ALTER/DROP/RENAME of them).
--   - No duplicate football tables. No production data modification
--     (seeds are INSERT ... ON CONFLICT DO NOTHING).
--   - No passwords, tokens, or secrets stored anywhere.
--
-- Reversibility (ROLLBACK, run manually in order):
--   DROP VIEW IF EXISTS public.admin_audit_logs;
--   DROP VIEW IF EXISTS public.admin_users;
--   DROP VIEW IF EXISTS public.admin_roles;
--   DROP FUNCTION IF EXISTS public.has_admin_permission(uuid, text);
--   DROP TABLE IF EXISTS public.admin_role_permissions;
--   DROP TABLE IF EXISTS public.admin_permissions;
-- Idempotent: safe to re-run (IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING /
-- DROP POLICY/TRIGGER IF EXISTS before CREATE).
-- ============================================================================

-- ============================================================================
-- 1. ADMIN_PERMISSIONS (new ground truth for granular resource.action)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_permissions (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    key         text        NOT NULL UNIQUE,
    resource    text        NOT NULL,
    action      text        NOT NULL,
    description text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_admin_perm_key_not_empty      CHECK (length(btrim(key)) > 0),
    CONSTRAINT chk_admin_perm_resource_not_empty CHECK (length(btrim(resource)) > 0),
    CONSTRAINT chk_admin_perm_action_not_empty   CHECK (length(btrim(action)) > 0),
    CONSTRAINT chk_admin_perm_key_shape          CHECK (key LIKE '%.%' AND key NOT LIKE '.%' AND key NOT LIKE '%.'),
    CONSTRAINT uq_admin_perm_resource_action    UNIQUE (resource, action),
    CONSTRAINT chk_admin_perm_key_matches        CHECK (key = resource || '.' || action)
);

CREATE INDEX IF NOT EXISTS idx_admin_perm_resource ON public.admin_permissions (resource);

ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_permissions_staff_select ON public.admin_permissions;
CREATE POLICY admin_permissions_staff_select ON public.admin_permissions
    FOR SELECT
    TO authenticated
    USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS admin_permissions_admin_insert ON public.admin_permissions;
CREATE POLICY admin_permissions_admin_insert ON public.admin_permissions
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS admin_permissions_admin_update ON public.admin_permissions;
CREATE POLICY admin_permissions_admin_update ON public.admin_permissions
    FOR UPDATE
    TO authenticated
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS admin_permissions_admin_delete ON public.admin_permissions;
CREATE POLICY admin_permissions_admin_delete ON public.admin_permissions
    FOR DELETE
    TO authenticated
    USING (public.is_admin(auth.uid()));

-- ============================================================================
-- 2. ADMIN_ROLE_PERMISSIONS (role -> permission grants; no role names in code)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
    role_id       smallint    NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
    permission_id uuid        NOT NULL REFERENCES public.admin_permissions(id) ON DELETE CASCADE,
    granted_at    timestamptz NOT NULL DEFAULT now(),
    granted_by    uuid        REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_rp_role ON public.admin_role_permissions (role_id);
CREATE INDEX IF NOT EXISTS idx_admin_rp_perm ON public.admin_role_permissions (permission_id);

ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_rp_admin_select ON public.admin_role_permissions;
CREATE POLICY admin_rp_admin_select ON public.admin_role_permissions
    FOR SELECT
    TO authenticated
    USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS admin_rp_admin_insert ON public.admin_role_permissions;
CREATE POLICY admin_rp_admin_insert ON public.admin_role_permissions
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS admin_rp_admin_update ON public.admin_role_permissions;
CREATE POLICY admin_rp_admin_update ON public.admin_role_permissions
    FOR UPDATE
    TO authenticated
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS admin_rp_admin_delete ON public.admin_role_permissions;
CREATE POLICY admin_rp_admin_delete ON public.admin_role_permissions
    FOR DELETE
    TO authenticated
    USING (public.is_admin(auth.uid()));

-- ============================================================================
-- 3. PERMISSION CATALOGUE SEED (data only; enforcement lives in policies + fn)
-- Only keys required by the Step-1 Admin modules. Idempotent.
-- ============================================================================

INSERT INTO public.admin_permissions (key, resource, action, description) VALUES
    ('dashboard.read',            'dashboard',        'read',   'View admin dashboard aggregates'),
    ('articles.read',             'articles',         'read',   'List/view articles including drafts'),
    ('articles.create',           'articles',         'create', 'Create drafts'),
    ('articles.update',           'articles',         'update', 'Edit drafts/review content and relations'),
    ('articles.delete',           'articles',         'delete', 'Delete or archive articles'),
    ('articles.publish',          'articles',         'publish','Submit/review/publish/schedule/unpublish'),
    ('categories.read',           'categories',       'read',   'View categories'),
    ('categories.manage',         'categories',       'manage', 'Create/update/delete categories'),
    ('tags.read',                 'tags',             'read',   'View tags'),
    ('tags.manage',               'tags',             'manage', 'Create/update/delete tags'),
    ('transfers.read',            'transfers',        'read',   'View transfers including rumours'),
    ('transfers.create',          'transfers',        'create', 'Create transfers'),
    ('transfers.update',          'transfers',        'update', 'Update transfers'),
    ('transfers.delete',          'transfers',        'delete', 'Delete transfers'),
    ('transfer_windows.read',     'transfer_windows', 'read',   'View transfer windows'),
    ('transfer_windows.manage',   'transfer_windows', 'manage', 'Manage transfer windows'),
    ('matches.read',              'matches',          'read',   'View matches'),
    ('matches.create',            'matches',          'create', 'Create matches'),
    ('matches.update',            'matches',          'update', 'Update matches and scores'),
    ('matches.delete',            'matches',          'delete', 'Delete matches'),
    ('match_events.manage',       'match_events',     'manage', 'Manage match events'),
    ('lineups.manage',            'lineups',          'manage', 'Manage lineups and lineup players'),
    ('teams.read',                'teams',            'read',   'View teams'),
    ('teams.create',              'teams',            'create', 'Create teams'),
    ('teams.update',              'teams',            'update', 'Update teams'),
    ('teams.delete',              'teams',            'delete', 'Delete/deactivate teams'),
    ('players.read',              'players',          'read',   'View players'),
    ('players.create',            'players',          'create', 'Create players'),
    ('players.update',            'players',          'update', 'Update players'),
    ('players.delete',            'players',          'delete', 'Delete players'),
    ('competitions.read',         'competitions',     'read',   'View competitions'),
    ('competitions.create',       'competitions',     'create', 'Create competitions'),
    ('competitions.update',       'competitions',     'update', 'Update competitions'),
    ('competitions.delete',       'competitions',     'delete', 'Delete competitions'),
    ('seasons.read',              'seasons',          'read',   'View seasons'),
    ('seasons.manage',            'seasons',          'manage', 'Manage seasons'),
    ('venues.read',               'venues',           'read',   'View venues'),
    ('venues.manage',             'venues',           'manage', 'Manage venues'),
    ('media.read',                'media',            'read',   'View media library'),
    ('media.manage',              'media',            'manage', 'Upload/update/delete media'),
    ('settings.manage',           'settings',         'manage', 'Manage system/site settings'),
    ('users.manage',              'users',            'manage', 'Manage admin users and role assignment'),
    ('roles.read',                'roles',            'read',   'View roles and grants'),
    ('roles.manage',              'roles',            'manage', 'Manage roles and permission grants'),
    ('audit_logs.read',           'audit_logs',       'read',   'Read audit logs')
ON CONFLICT (key) DO NOTHING;

-- Initial grants: super_admin + admin get full catalogue; editor/moderator scoped.
-- Uses role-permission relationships only (no name checks in functions/policies).
INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.admin_permissions p
WHERE r.name IN ('super_admin', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.admin_permissions p ON p.key IN (
    'dashboard.read',
    'articles.read','articles.create','articles.update','articles.publish',
    'categories.read','categories.manage',
    'tags.read','tags.manage',
    'transfers.read',
    'transfer_windows.read',
    'matches.read',
    'teams.read','players.read','competitions.read','seasons.read','venues.read',
    'media.read','media.manage'
)
WHERE r.name = 'editor'
ON CONFLICT DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.admin_permissions p ON p.key IN (
    'dashboard.read',
    'articles.read',
    'categories.read','tags.read',
    'transfers.read','transfer_windows.read',
    'matches.read','teams.read','players.read','competitions.read',
    'seasons.read','venues.read','media.read'
)
WHERE r.name = 'moderator'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. SERVER-SIDE PERMISSION CHECK (no hardcoded role names)
-- Backend calls this via service client after authenticate().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_admin_permission(p_user_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.admin_role_permissions arp ON arp.role_id = ur.role_id
        JOIN public.admin_permissions ap ON ap.id = arp.permission_id
        WHERE ur.user_id = p_user_id
          AND ap.key = p_key
    );
$$;

REVOKE ALL ON FUNCTION public.has_admin_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(uuid, text) TO service_role;

-- ============================================================================
-- 5. COMPATIBILITY VIEWS (names requested in Step 2, zero new ground truth)
-- Locked to service_role: browsers/apps never query them directly.
-- Backend admin reads go through serviceClient() + has_admin_permission().
-- ============================================================================

-- 5a. admin_roles -> public.roles (super_admin/admin/editor/moderator + existing)
CREATE OR REPLACE VIEW public.admin_roles AS
SELECT id, name, description, created_at
FROM public.roles;

REVOKE ALL ON TABLE public.admin_roles FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_roles FROM anon, authenticated;
GRANT SELECT ON TABLE public.admin_roles TO service_role;

-- 5b. admin_users -> profiles + role membership (Auth stays in Supabase Auth).
-- No passwords/credentials. status carries active/suspended/deleted.
-- last_login_at is NULL placeholder: real sign-in telemetry lives in
-- auth.users (service_role only) and is read via Admin API, not stored here.
CREATE OR REPLACE VIEW public.admin_users AS
SELECT
    p.user_id                                           AS id,
    p.user_id                                           AS user_id,
    p.display_name,
    p.username,
    p.avatar_url,
    p.status,
    COALESCE(
        (SELECT jsonb_agg(r.name ORDER BY r.name)
         FROM public.user_roles ur
         JOIN public.roles r ON r.id = ur.role_id
         WHERE ur.user_id = p.user_id),
        '[]'::jsonb
    )                                                   AS roles,
    p.created_at,
    p.updated_at,
    NULL::timestamptz                                   AS last_login_at
FROM public.profiles p;

REVOKE ALL ON TABLE public.admin_users FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_users FROM anon, authenticated;
GRANT SELECT ON TABLE public.admin_users TO service_role;

-- 5c. admin_audit_logs -> public.audit_logs with requested column names.
-- Never stores passwords/tokens/secrets (enforced at API layer; base table
-- has no credential columns by design).
CREATE OR REPLACE VIEW public.admin_audit_logs AS
SELECT
    id,
    user_id                                             AS admin_user_id,
    action,
    entity_type                                         AS resource,
    entity_id                                           AS resource_id,
    old_data                                            AS previous_data,
    new_data,
    ip_address                                          AS ip,
    user_agent                                          AS request_metadata,
    created_at
FROM public.audit_logs;

REVOKE ALL ON TABLE public.admin_audit_logs FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_audit_logs FROM anon, authenticated;
GRANT SELECT ON TABLE public.admin_audit_logs TO service_role;

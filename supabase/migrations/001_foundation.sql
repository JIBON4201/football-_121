-- ============================================================================
-- 001_foundation.sql
-- Supabase Foundation: Extensions, Enums, Profiles, Roles, RBAC, RLS
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================================
-- 2. ENUM TYPES
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
        CREATE TYPE public.user_status AS ENUM ('active', 'suspended', 'deleted');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
        CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'editor', 'author', 'moderator', 'user');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'article_status') THEN
        CREATE TYPE public.article_status AS ENUM ('draft', 'review', 'scheduled', 'published', 'archived');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'article_type') THEN
        CREATE TYPE public.article_type AS ENUM ('news', 'breaking_news', 'transfer', 'match_report', 'analysis', 'opinion');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_status') THEN
        CREATE TYPE public.match_status AS ENUM ('scheduled', 'pre_match', 'live', 'half_time', 'extra_time', 'penalty_shootout', 'finished', 'postponed', 'cancelled', 'abandoned', 'suspended');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_event_type') THEN
        CREATE TYPE public.match_event_type AS ENUM ('goal', 'own_goal', 'penalty_goal', 'missed_penalty', 'yellow_card', 'red_card', 'substitution', 'var');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_type') THEN
        CREATE TYPE public.transfer_type AS ENUM ('permanent', 'loan', 'loan_return', 'free_transfer');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_status') THEN
        CREATE TYPE public.transfer_status AS ENUM ('rumour', 'announced', 'completed', 'cancelled', 'rejected');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_status') THEN
        CREATE TYPE public.sync_status AS ENUM ('queued', 'running', 'completed', 'partial', 'failed');
    END IF;
END
$$;

-- ============================================================================
-- 3. PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name varchar(100),
    username    citext      UNIQUE,
    avatar_url  text,
    status      public.user_status NOT NULL DEFAULT 'active',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. ROLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.roles (
    id          smallint    PRIMARY KEY,
    name        public.app_role NOT NULL UNIQUE,
    description text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.roles (id, name, description) VALUES
    (1, 'super_admin', 'Full system access and control'),
    (2, 'admin',       'Administrative access to manage content and users'),
    (3, 'editor',      'Can create, edit, and publish content'),
    (4, 'author',      'Can create and edit own content'),
    (5, 'moderator',   'Can moderate comments and user-generated content'),
    (6, 'user',        'Standard registered user')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 5. USER_ROLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id    uuid      NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    role_id    smallint  NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

-- ============================================================================
-- 6. UPDATED_AT FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 7. NEW USER PROFILE FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_display_name varchar(100);
BEGIN
    -- Extract display name from metadata only; never trust client-supplied roles
    v_display_name := COALESCE(
        NEW.raw_user_meta_data ->> 'display_name',
        NEW.raw_user_meta_data ->> 'name'
    );

    -- Create the profile
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, v_display_name);

    -- Assign the default 'user' role only
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, 6);

    RETURN NEW;
END;
$$;

-- ============================================================================
-- 8. AUTH TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 9. RBAC HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role public.app_role)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = p_user_id
          AND r.name = p_role
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN public.has_role(p_user_id, 'super_admin')
        OR public.has_role(p_user_id, 'admin');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_editor(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN public.has_role(p_user_id, 'super_admin')
        OR public.has_role(p_user_id, 'admin')
        OR public.has_role(p_user_id, 'editor');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_staff(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN public.has_role(p_user_id, 'super_admin')
        OR public.has_role(p_user_id, 'admin')
        OR public.has_role(p_user_id, 'editor')
        OR public.has_role(p_user_id, 'author')
        OR public.has_role(p_user_id, 'moderator');
END;
$$;

-- ============================================================================
-- 10. RLS
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- --- PROFILES ---

CREATE POLICY profiles_select_own ON public.profiles
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY profiles_update_own ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- --- USER_ROLES ---

CREATE POLICY user_roles_select_own ON public.user_roles
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- --- ROLES ---

CREATE POLICY roles_select_authenticated ON public.roles
    FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================================
-- 12. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_user_id  ON public.profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles (username);
CREATE INDEX IF NOT EXISTS idx_profiles_status   ON public.profiles (status);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON public.user_roles (role_id);

-- ============================================================================
-- 13. UPDATED_AT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

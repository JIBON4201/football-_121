-- ============================================================================
-- 016_hardening.sql
-- Production Hardening & Integrity Audit fixes (Steps 1-15 review)
--
-- A. Remove redundant indexes covered by PK/UNIQUE/composite indexes
-- B. user_roles.role_id FK: CASCADE -> RESTRICT (protect authorization data)
-- C. handle_new_user: make idempotent (ON CONFLICT DO NOTHING)
-- D. profiles: block client modification of status/user_id (trigger)
-- E. media: restrict public read to published-article media + own uploads
-- F. articles: staff-only creation with publish workflow enforcement
-- G. article relation tables: editor management policies
-- H. seo_metadata: editor management policies
-- I. tags: add updated_at column + trigger for timestamp consistency
-- ============================================================================

-- ============================================================================
-- A. REDUNDANT INDEX REMOVAL
-- Each dropped index is fully covered by a PK, UNIQUE, or composite index.
-- ============================================================================

DROP INDEX IF EXISTS public.idx_profiles_user_id;
DROP INDEX IF EXISTS public.idx_profiles_username;
DROP INDEX IF EXISTS public.idx_user_roles_user_id;
DROP INDEX IF EXISTS public.idx_seasons_competition_id;
DROP INDEX IF EXISTS public.idx_tct_team_id;
DROP INDEX IF EXISTS public.idx_matches_slug;
DROP INDEX IF EXISTS public.idx_matches_status;
DROP INDEX IF EXISTS public.idx_matches_competition_id;
DROP INDEX IF EXISTS public.idx_mts_match_id;
DROP INDEX IF EXISTS public.idx_mps_match_id;
DROP INDEX IF EXISTS public.idx_match_lineups_match_id;
DROP INDEX IF EXISTS public.idx_mlp_lineup_id;
DROP INDEX IF EXISTS public.idx_tw_season_id;
DROP INDEX IF EXISTS public.idx_transfers_player_id;
DROP INDEX IF EXISTS public.idx_transfers_from_team_id;
DROP INDEX IF EXISTS public.idx_transfers_to_team_id;
DROP INDEX IF EXISTS public.idx_transfers_season_id;
DROP INDEX IF EXISTS public.idx_seo_entity_type;
DROP INDEX IF EXISTS public.idx_eei_data_source_id;
DROP INDEX IF EXISTS public.idx_sj_status;
DROP INDEX IF EXISTS public.idx_notifications_user_id;
DROP INDEX IF EXISTS public.idx_audit_user_id;
DROP INDEX IF EXISTS public.idx_audit_entity_type;

-- ============================================================================
-- B. USER_ROLES ROLE FK: RESTRICT (never cascade-delete authorization data)
-- ============================================================================

ALTER TABLE public.user_roles
    DROP CONSTRAINT IF EXISTS user_roles_role_id_fkey;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_role_id_fkey'
    ) THEN
        ALTER TABLE public.user_roles
            ADD CONSTRAINT user_roles_role_id_fkey
            FOREIGN KEY (role_id) REFERENCES public.roles(id)
            ON DELETE RESTRICT;
    END IF;
END
$$;

-- ============================================================================
-- C. HANDLE_NEW_USER: IDEMPOTENT (safe retries, no duplicate-key failure)
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
    v_display_name := COALESCE(
        NEW.raw_user_meta_data ->> 'display_name',
        NEW.raw_user_meta_data ->> 'name'
    );

    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, v_display_name)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (NEW.id, 6)
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$;

-- ============================================================================
-- D. PROFILES: PROTECT PRIVILEGED FIELDS FROM CLIENT MODIFICATION
-- Service (no auth.uid) and admins bypass; all others cannot change
-- status or user_id. Editable profile fields remain user-writable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_profile_privileged()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF public.is_admin(auth.uid()) THEN
        RETURN NEW;
    END IF;

    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'user_id is immutable';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'status is managed by administrators';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_protect_privileged ON public.profiles;
CREATE TRIGGER trg_profiles_protect_privileged
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_profile_privileged();

-- ============================================================================
-- E. MEDIA: RESTRICT PUBLIC READ (published-article media only)
-- Authors retain access to their own uploads via separate policy.
-- ============================================================================

DROP POLICY IF EXISTS media_select_public ON public.media;

CREATE POLICY media_select_published ON public.media
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.featured_image_id = media.id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );

CREATE POLICY media_select_own ON public.media
    FOR SELECT
    TO authenticated
    USING (uploaded_by = auth.uid());

-- ============================================================================
-- F. ARTICLES: STAFF-ONLY CREATION + EDITOR PUBLISH WORKFLOW
-- Closes: any authenticated 'user' could INSERT, including status='published'.
-- Authors create draft/review; editors+ may publish and manage all articles.
-- ============================================================================

DROP POLICY IF EXISTS articles_insert_author ON public.articles;
DROP POLICY IF EXISTS articles_insert_staff ON public.articles;
CREATE POLICY articles_insert_staff ON public.articles
    FOR INSERT
    TO authenticated
    WITH CHECK (
        author_id = auth.uid()
        AND public.is_staff(auth.uid())
        AND (status IN ('draft', 'review') OR public.is_editor(auth.uid()))
    );

DROP POLICY IF EXISTS articles_update_staff ON public.articles;
CREATE POLICY articles_update_staff ON public.articles
    FOR UPDATE
    TO authenticated
    USING (public.is_editor(auth.uid()))
    WITH CHECK (public.is_editor(auth.uid()));

DROP POLICY IF EXISTS articles_delete_staff ON public.articles;
CREATE POLICY articles_delete_staff ON public.articles
    FOR DELETE
    TO authenticated
    USING (public.is_editor(auth.uid()));

-- ============================================================================
-- G. ARTICLE RELATION TABLES: EDITOR MANAGEMENT
-- Authors keep own draft/review write; editors manage all relations.
-- ============================================================================

DROP POLICY IF EXISTS article_teams_insert_staff ON public.article_teams;
DROP POLICY IF EXISTS article_teams_delete_staff ON public.article_teams;
DROP POLICY IF EXISTS article_players_insert_staff ON public.article_players;
DROP POLICY IF EXISTS article_players_delete_staff ON public.article_players;
DROP POLICY IF EXISTS article_competitions_insert_staff ON public.article_competitions;
DROP POLICY IF EXISTS article_competitions_delete_staff ON public.article_competitions;
DROP POLICY IF EXISTS article_matches_insert_staff ON public.article_matches;
DROP POLICY IF EXISTS article_matches_delete_staff ON public.article_matches;
DROP POLICY IF EXISTS seo_metadata_insert_staff ON public.seo_metadata;
DROP POLICY IF EXISTS seo_metadata_update_staff ON public.seo_metadata;
DROP POLICY IF EXISTS seo_metadata_delete_staff ON public.seo_metadata;
CREATE POLICY article_teams_insert_staff ON public.article_teams
    FOR INSERT TO authenticated WITH CHECK (public.is_editor(auth.uid()));

CREATE POLICY article_teams_delete_staff ON public.article_teams
    FOR DELETE TO authenticated USING (public.is_editor(auth.uid()));

CREATE POLICY article_players_insert_staff ON public.article_players
    FOR INSERT TO authenticated WITH CHECK (public.is_editor(auth.uid()));

CREATE POLICY article_players_delete_staff ON public.article_players
    FOR DELETE TO authenticated USING (public.is_editor(auth.uid()));

CREATE POLICY article_competitions_insert_staff ON public.article_competitions
    FOR INSERT TO authenticated WITH CHECK (public.is_editor(auth.uid()));

CREATE POLICY article_competitions_delete_staff ON public.article_competitions
    FOR DELETE TO authenticated USING (public.is_editor(auth.uid()));

CREATE POLICY article_matches_insert_staff ON public.article_matches
    FOR INSERT TO authenticated WITH CHECK (public.is_editor(auth.uid()));

CREATE POLICY article_matches_delete_staff ON public.article_matches
    FOR DELETE TO authenticated USING (public.is_editor(auth.uid()));

-- ============================================================================
-- H. SEO_METADATA: EDITOR MANAGEMENT
-- Authors keep own draft/review write; editors manage all SEO records.
-- ============================================================================

CREATE POLICY seo_metadata_insert_staff ON public.seo_metadata
    FOR INSERT TO authenticated WITH CHECK (public.is_editor(auth.uid()));

CREATE POLICY seo_metadata_update_staff ON public.seo_metadata
    FOR UPDATE TO authenticated
    USING (public.is_editor(auth.uid()))
    WITH CHECK (public.is_editor(auth.uid()));

CREATE POLICY seo_metadata_delete_staff ON public.seo_metadata
    FOR DELETE TO authenticated USING (public.is_editor(auth.uid()));

-- ============================================================================
-- I. TAGS: UPDATED_AT CONSISTENCY
-- ============================================================================

ALTER TABLE public.tags
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_tags_updated_at ON public.tags;
CREATE TRIGGER trg_tags_updated_at
    BEFORE UPDATE ON public.tags
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

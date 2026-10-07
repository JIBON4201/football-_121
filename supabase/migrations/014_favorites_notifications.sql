-- ============================================================================
-- 014_favorites_notifications.sql
-- User Favorites & Notifications System
-- ============================================================================

-- ============================================================================
-- 1. USER_FAVORITE_TEAMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_favorite_teams (
    user_id    uuid        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    team_id    uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, team_id)
);

-- ============================================================================
-- 2. USER_FAVORITE_PLAYERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_favorite_players (
    user_id    uuid        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    player_id  uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, player_id)
);

-- ============================================================================
-- 3. USER_FAVORITE_COMPETITIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_favorite_competitions (
    user_id        uuid        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    competition_id uuid        NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, competition_id)
);

-- ============================================================================
-- 4. NOTIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid         NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    type        varchar(100) NOT NULL,
    title       varchar(200) NOT NULL,
    body        text         NOT NULL,
    entity_type varchar(50),
    entity_id   uuid,
    read_at     timestamptz,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_notifications_type_not_empty  CHECK (length(btrim(type)) > 0),
    CONSTRAINT chk_notifications_title_not_empty CHECK (length(btrim(title)) > 0),
    CONSTRAINT chk_notifications_body_not_empty  CHECK (length(btrim(body)) > 0)
);

-- ============================================================================
-- 5. INDEXES
-- ============================================================================

-- Favorites: (user_id) direction already covered by composite PKs;
-- reverse indexes enable "all users who favorite X" lookups.
CREATE INDEX IF NOT EXISTS idx_uft_team_id        ON public.user_favorite_teams (team_id);
CREATE INDEX IF NOT EXISTS idx_ufp_player_id      ON public.user_favorite_players (player_id);
CREATE INDEX IF NOT EXISTS idx_ufc_competition_id ON public.user_favorite_competitions (competition_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id      ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at   ON public.notifications (created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_read_at      ON public.notifications (read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read    ON public.notifications (user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

-- ============================================================================
-- 6. NOTIFICATION CONTENT PROTECTION
-- ============================================================================

-- Users may only change read_at; all other columns are immutable for
-- authenticated users. Service/backend operations (no auth.uid) bypass.
CREATE OR REPLACE FUNCTION public.protect_notification_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.type IS DISTINCT FROM OLD.type
        OR NEW.title IS DISTINCT FROM OLD.title
        OR NEW.body IS DISTINCT FROM OLD.body
        OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
        OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'Only read_at may be modified';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_protect_content ON public.notifications;
CREATE TRIGGER trg_notifications_protect_content
    BEFORE UPDATE ON public.notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_notification_content();

-- ============================================================================
-- 7. RLS
-- ============================================================================

ALTER TABLE public.user_favorite_teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorite_players     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_favorite_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications             ENABLE ROW LEVEL SECURITY;

-- Favorites: own SELECT / INSERT / DELETE only. No UPDATE policy (blocked).
CREATE POLICY uft_select_own ON public.user_favorite_teams
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY uft_insert_own ON public.user_favorite_teams
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY uft_delete_own ON public.user_favorite_teams
    FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY ufp_select_own ON public.user_favorite_players
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY ufp_insert_own ON public.user_favorite_players
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY ufp_delete_own ON public.user_favorite_players
    FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY ufc_select_own ON public.user_favorite_competitions
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY ufc_insert_own ON public.user_favorite_competitions
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY ufc_delete_own ON public.user_favorite_competitions
    FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Notifications: own SELECT + own UPDATE (content protected by trigger).
-- No INSERT / DELETE for normal users; creation/deletion via trusted service.
CREATE POLICY notifications_select_own ON public.notifications
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY notifications_update_own ON public.notifications
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- apply-all.sql — complete database schema for the football website
--
-- HOW TO RUN
--   Supabase Dashboard > SQL Editor > New query > paste this file > Run
--
-- This applies all 29 migrations in order. The SQL Editor runs a pasted
-- script as a single transaction, so it is all-or-nothing: if any statement
-- fails, nothing is created and the reported error is the one to fix.
--
-- Re-running is NOT safe: CREATE TYPE and CREATE TRIGGER have no
-- IF NOT EXISTS in PostgreSQL. Only run this on an empty project.
-- ============================================================================

-- Verify afterwards:
--   SELECT count(*) AS tables FROM information_schema.tables
--     WHERE table_schema = 'public';                    -- expect 45
--   SELECT public.verify_schema_health();              -- full inventory
--
-- The admin RBAC tables (admin_permissions, admin_role_permissions) come from
-- 025-027. Without them the Admin API answers 403 to every authenticated user,
-- because permission resolution has nothing to read.

-- ============================================================================
-- ============================================================================
-- ============================================================================
-- >>> 001_foundation.sql
-- ============================================================================
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

-- ============================================================================
-- >>> 002_football_core.sql
-- ============================================================================
-- ============================================================================
-- 002_football_core.sql
-- Football Core Schema: Countries, Venues, Competitions, Seasons, Teams, Players
-- ============================================================================

-- ============================================================================
-- 1. COUNTRIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.countries (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code       varchar(3)  NOT NULL UNIQUE,
    name       varchar(120) NOT NULL,
    slug       citext      NOT NULL UNIQUE,
    flag_url   text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. VENUES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.venues (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        varchar(200) NOT NULL,
    slug        citext       NOT NULL UNIQUE,
    city        varchar(100),
    country_id  uuid         REFERENCES public.countries(id) ON DELETE SET NULL,
    capacity    integer,
    image_url   text,
    latitude    numeric(9,6),
    longitude   numeric(9,6),
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_venues_capacity   CHECK (capacity IS NULL OR capacity >= 0),
    CONSTRAINT chk_venues_latitude  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
    CONSTRAINT chk_venues_longitude CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))
);

-- ============================================================================
-- 3. COMPETITIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.competitions (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        varchar(150) NOT NULL,
    short_name  varchar(80),
    slug        citext       NOT NULL UNIQUE,
    country_id  uuid         REFERENCES public.countries(id) ON DELETE SET NULL,
    logo_url    text,
    type        varchar(30),
    gender      varchar(20),
    is_active   boolean      NOT NULL DEFAULT true,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. SEASONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.seasons (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid        NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
    name           varchar(50) NOT NULL,
    start_date     date,
    end_date       date,
    is_current     boolean     NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_seasons_competition_name UNIQUE (competition_id, name),
    CONSTRAINT chk_seasons_dates CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);

-- ============================================================================
-- 5. TEAMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.teams (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    name         varchar(150) NOT NULL,
    short_name   varchar(80),
    slug         citext       NOT NULL UNIQUE,
    country_id   uuid         REFERENCES public.countries(id) ON DELETE SET NULL,
    logo_url     text,
    founded_year smallint,
    venue_id     uuid         REFERENCES public.venues(id) ON DELETE SET NULL,
    website_url  text,
    is_active    boolean      NOT NULL DEFAULT true,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_teams_founded_year CHECK (founded_year IS NULL OR (founded_year >= 1800 AND founded_year <= 2100))
);

-- ============================================================================
-- 6. PLAYERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.players (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name     varchar(100),
    last_name      varchar(100),
    display_name   varchar(150) NOT NULL,
    slug           citext       NOT NULL UNIQUE,
    date_of_birth  date,
    nationality_id uuid         REFERENCES public.countries(id) ON DELETE SET NULL,
    position       varchar(40),
    preferred_foot varchar(10),
    height_cm      smallint,
    photo_url      text,
    status         varchar(30),
    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_players_height_cm CHECK (height_cm IS NULL OR (height_cm >= 100 AND height_cm <= 250)),
    CONSTRAINT chk_players_preferred_foot CHECK (preferred_foot IS NULL OR preferred_foot IN ('left', 'right', 'both'))
);

-- ============================================================================
-- 7. TEAM_COMPETITIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.team_competitions (
    team_id        uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    competition_id uuid        NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
    season_id      uuid        NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, competition_id, season_id)
);

-- ============================================================================
-- 8. PLAYER_TEAM_HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.player_team_history (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id   uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    team_id     uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    season_id   uuid        REFERENCES public.seasons(id) ON DELETE SET NULL,
    joined_at   date,
    left_at     date,
    shirt_number smallint,
    is_current  boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_pth_shirt_number CHECK (shirt_number IS NULL OR (shirt_number >= 1 AND shirt_number <= 99)),
    CONSTRAINT chk_pth_dates CHECK (joined_at IS NULL OR left_at IS NULL OR joined_at <= left_at)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_venues_country_id       ON public.venues (country_id);
CREATE INDEX IF NOT EXISTS idx_competitions_country_id ON public.competitions (country_id);
CREATE INDEX IF NOT EXISTS idx_competitions_is_active  ON public.competitions (is_active);
CREATE INDEX IF NOT EXISTS idx_seasons_competition_id ON public.seasons (competition_id);
CREATE INDEX IF NOT EXISTS idx_seasons_is_current     ON public.seasons (is_current);
CREATE INDEX IF NOT EXISTS idx_teams_country_id       ON public.teams (country_id);
CREATE INDEX IF NOT EXISTS idx_teams_venue_id          ON public.teams (venue_id);
CREATE INDEX IF NOT EXISTS idx_teams_is_active        ON public.teams (is_active);
CREATE INDEX IF NOT EXISTS idx_players_nationality_id ON public.players (nationality_id);
CREATE INDEX IF NOT EXISTS idx_players_status         ON public.players (status);
CREATE INDEX IF NOT EXISTS idx_tct_team_id             ON public.team_competitions (team_id);
CREATE INDEX IF NOT EXISTS idx_tct_competition_id     ON public.team_competitions (competition_id);
CREATE INDEX IF NOT EXISTS idx_tct_season_id           ON public.team_competitions (season_id);
CREATE INDEX IF NOT EXISTS idx_pth_player_id          ON public.player_team_history (player_id);
CREATE INDEX IF NOT EXISTS idx_pth_team_id            ON public.player_team_history (team_id);
CREATE INDEX IF NOT EXISTS idx_pth_season_id          ON public.player_team_history (season_id);
CREATE INDEX IF NOT EXISTS idx_pth_is_current         ON public.player_team_history (is_current);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS trg_countries_updated_at ON public.countries;
CREATE TRIGGER trg_countries_updated_at
    BEFORE UPDATE ON public.countries
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_venues_updated_at ON public.venues;
CREATE TRIGGER trg_venues_updated_at
    BEFORE UPDATE ON public.venues
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_competitions_updated_at ON public.competitions;
CREATE TRIGGER trg_competitions_updated_at
    BEFORE UPDATE ON public.competitions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_seasons_updated_at ON public.seasons;
CREATE TRIGGER trg_seasons_updated_at
    BEFORE UPDATE ON public.seasons
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_teams_updated_at ON public.teams;
CREATE TRIGGER trg_teams_updated_at
    BEFORE UPDATE ON public.teams
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_players_updated_at ON public.players;
CREATE TRIGGER trg_players_updated_at
    BEFORE UPDATE ON public.players
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_pth_updated_at ON public.player_team_history;
CREATE TRIGGER trg_pth_updated_at
    BEFORE UPDATE ON public.player_team_history
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.countries            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_competitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_team_history  ENABLE ROW LEVEL SECURITY;

-- Public read access for all football core data
CREATE POLICY countries_select_public ON public.countries
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY venues_select_public ON public.venues
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY competitions_select_public ON public.competitions
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY seasons_select_public ON public.seasons
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY teams_select_public ON public.teams
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY players_select_public ON public.players
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY team_competitions_select_public ON public.team_competitions
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY player_team_history_select_public ON public.player_team_history
    FOR SELECT TO anon, authenticated USING (true);

-- ============================================================================
-- >>> 003_matches.sql
-- ============================================================================
-- ============================================================================
-- 003_matches.sql
-- Matches table: core match data for scheduled and completed fixtures
-- ============================================================================

-- ============================================================================
-- 1. MATCHES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.matches (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            citext        NOT NULL UNIQUE,
    competition_id  uuid          NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
    season_id       uuid          REFERENCES public.seasons(id) ON DELETE SET NULL,
    venue_id        uuid          REFERENCES public.venues(id) ON DELETE SET NULL,
    home_team_id    uuid          NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    away_team_id    uuid          NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    scheduled_at    timestamptz   NOT NULL,
    status          public.match_status NOT NULL DEFAULT 'scheduled',
    home_score      smallint,
    away_score      smallint,
    home_score_ht   smallint,
    away_score_ht   smallint,
    home_score_et   smallint,
    away_score_et   smallint,
    home_score_pen  smallint,
    away_score_pen  smallint,
    round           varchar(100),
    matchday        integer,
    referee_name    varchar(150),
    attendance      integer,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT chk_matches_different_teams   CHECK (home_team_id <> away_team_id),
    CONSTRAINT chk_matches_home_score       CHECK (home_score IS NULL OR home_score >= 0),
    CONSTRAINT chk_matches_away_score       CHECK (away_score IS NULL OR away_score >= 0),
    CONSTRAINT chk_matches_home_score_ht    CHECK (home_score_ht IS NULL OR home_score_ht >= 0),
    CONSTRAINT chk_matches_away_score_ht    CHECK (away_score_ht IS NULL OR away_score_ht >= 0),
    CONSTRAINT chk_matches_home_score_et    CHECK (home_score_et IS NULL OR home_score_et >= 0),
    CONSTRAINT chk_matches_away_score_et    CHECK (away_score_et IS NULL OR away_score_et >= 0),
    CONSTRAINT chk_matches_home_score_pen   CHECK (home_score_pen IS NULL OR home_score_pen >= 0),
    CONSTRAINT chk_matches_away_score_pen   CHECK (away_score_pen IS NULL OR away_score_pen >= 0),
    CONSTRAINT chk_matches_attendance       CHECK (attendance IS NULL OR attendance >= 0),
    CONSTRAINT chk_matches_matchday         CHECK (matchday IS NULL OR matchday >= 0)
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_matches_scheduled_at      ON public.matches (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_matches_status            ON public.matches (status);
CREATE INDEX IF NOT EXISTS idx_matches_competition_id    ON public.matches (competition_id);
CREATE INDEX IF NOT EXISTS idx_matches_competition_sched  ON public.matches (competition_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_matches_home_team_id      ON public.matches (home_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_away_team_id      ON public.matches (away_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_slug              ON public.matches (slug);
CREATE INDEX IF NOT EXISTS idx_matches_status_sched      ON public.matches (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_matches_season_id         ON public.matches (season_id);
CREATE INDEX IF NOT EXISTS idx_matches_venue_id          ON public.matches (venue_id);

-- ============================================================================
-- 3. UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_matches_updated_at ON public.matches;

CREATE TRIGGER trg_matches_updated_at
    BEFORE UPDATE ON public.matches
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY matches_select_public ON public.matches
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- >>> 004_match_events.sql
-- ============================================================================
-- ============================================================================
-- 004_match_events.sql
-- Match events: goals, cards, substitutions, VAR decisions
-- ============================================================================

-- ============================================================================
-- 1. MATCH_EVENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.match_events (
    id              uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        uuid                  NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    team_id         uuid                  REFERENCES public.teams(id) ON DELETE SET NULL,
    player_id       uuid                  REFERENCES public.players(id) ON DELETE SET NULL,
    assist_player_id uuid                  REFERENCES public.players(id) ON DELETE SET NULL,
    type            public.match_event_type NOT NULL,
    minute          smallint,
    extra_minute    smallint,
    description     text,
    metadata        jsonb,
    created_at      timestamptz           NOT NULL DEFAULT now(),
    updated_at      timestamptz           NOT NULL DEFAULT now(),
    CONSTRAINT chk_match_events_minute       CHECK (minute IS NULL OR minute >= 0),
    CONSTRAINT chk_match_events_extra_minute CHECK (extra_minute IS NULL OR extra_minute >= 0)
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_match_events_match_minute ON public.match_events (match_id, minute);
CREATE INDEX IF NOT EXISTS idx_match_events_match_type   ON public.match_events (match_id, type);
CREATE INDEX IF NOT EXISTS idx_match_events_team_id      ON public.match_events (team_id);
CREATE INDEX IF NOT EXISTS idx_match_events_player_id    ON public.match_events (player_id);

-- ============================================================================
-- 3. UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_match_events_updated_at ON public.match_events;

CREATE TRIGGER trg_match_events_updated_at
    BEFORE UPDATE ON public.match_events
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_events_select_public ON public.match_events
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- >>> 005_match_lineups.sql
-- ============================================================================
-- ============================================================================
-- 005_match_lineups.sql
-- Match lineups and lineup player assignments
-- ============================================================================

-- ============================================================================
-- 1. MATCH_LINEUPS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.match_lineups (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    team_id     uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    formation   varchar(30),
    coach_name  varchar(150),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_match_lineups_match_team UNIQUE (match_id, team_id)
);

-- ============================================================================
-- 2. MATCH_LINEUP_PLAYERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.match_lineup_players (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lineup_id     uuid        NOT NULL REFERENCES public.match_lineups(id) ON DELETE CASCADE,
    player_id     uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    position      varchar(30),
    shirt_number  smallint,
    starter       boolean     NOT NULL DEFAULT false,
    captain       boolean     NOT NULL DEFAULT false,
    substitute    boolean     NOT NULL DEFAULT false,
    minutes_played smallint,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_mlp_lineup_player     UNIQUE (lineup_id, player_id),
    CONSTRAINT chk_mlp_shirt_number   CHECK (shirt_number IS NULL OR shirt_number >= 0),
    CONSTRAINT chk_mlp_minutes_played CHECK (minutes_played IS NULL OR minutes_played >= 0)
);

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_match_lineups_match_id ON public.match_lineups (match_id);
CREATE INDEX IF NOT EXISTS idx_match_lineups_team_id  ON public.match_lineups (team_id);
CREATE INDEX IF NOT EXISTS idx_mlp_lineup_id          ON public.match_lineup_players (lineup_id);
CREATE INDEX IF NOT EXISTS idx_mlp_player_id          ON public.match_lineup_players (player_id);

-- ============================================================================
-- 4. UPDATED_AT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS trg_match_lineups_updated_at ON public.match_lineups;
CREATE TRIGGER trg_match_lineups_updated_at
    BEFORE UPDATE ON public.match_lineups
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_mlp_updated_at ON public.match_lineup_players;
CREATE TRIGGER trg_mlp_updated_at
    BEFORE UPDATE ON public.match_lineup_players
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS
-- ============================================================================

ALTER TABLE public.match_lineups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_lineup_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_lineups_select_public ON public.match_lineups
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY match_lineup_players_select_public ON public.match_lineup_players
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- >>> 006_match_statistics.sql
-- ============================================================================
-- ============================================================================
-- 006_match_statistics.sql
-- Match team and player statistics
-- ============================================================================

-- ============================================================================
-- 1. MATCH_TEAM_STATISTICS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.match_team_statistics (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        uuid         NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    team_id         uuid         NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    possession      numeric(5,2),
    shots           smallint,
    shots_on_target smallint,
    corners         smallint,
    fouls           smallint,
    offsides        smallint,
    yellow_cards    smallint,
    red_cards       smallint,
    passes          integer,
    pass_accuracy   numeric(5,2),
    metadata        jsonb,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_mts_match_team       UNIQUE (match_id, team_id),
    CONSTRAINT chk_mts_possession      CHECK (possession IS NULL OR (possession >= 0 AND possession <= 100)),
    CONSTRAINT chk_mts_shots          CHECK (shots IS NULL OR shots >= 0),
    CONSTRAINT chk_mts_shots_on_target CHECK (shots_on_target IS NULL OR shots_on_target >= 0),
    CONSTRAINT chk_mts_corners        CHECK (corners IS NULL OR corners >= 0),
    CONSTRAINT chk_mts_fouls          CHECK (fouls IS NULL OR fouls >= 0),
    CONSTRAINT chk_mts_offsides       CHECK (offsides IS NULL OR offsides >= 0),
    CONSTRAINT chk_mts_yellow_cards   CHECK (yellow_cards IS NULL OR yellow_cards >= 0),
    CONSTRAINT chk_mts_red_cards      CHECK (red_cards IS NULL OR red_cards >= 0),
    CONSTRAINT chk_mts_passes         CHECK (passes IS NULL OR passes >= 0),
    CONSTRAINT chk_mts_pass_accuracy  CHECK (pass_accuracy IS NULL OR (pass_accuracy >= 0 AND pass_accuracy <= 100))
);

-- ============================================================================
-- 2. MATCH_PLAYER_STATISTICS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.match_player_statistics (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        uuid         NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    team_id         uuid         NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    player_id       uuid         NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    minutes         smallint,
    goals           smallint,
    assists         smallint,
    shots           smallint,
    shots_on_target smallint,
    passes          integer,
    pass_accuracy   numeric(5,2),
    tackles         smallint,
    interceptions   smallint,
    clearances      smallint,
    yellow_cards    smallint,
    red_cards       smallint,
    rating          numeric(4,2),
    metadata        jsonb,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_mps_match_player    UNIQUE (match_id, player_id),
    CONSTRAINT chk_mps_minutes        CHECK (minutes IS NULL OR (minutes >= 0 AND minutes <= 150)),
    CONSTRAINT chk_mps_goals          CHECK (goals IS NULL OR goals >= 0),
    CONSTRAINT chk_mps_assists        CHECK (assists IS NULL OR assists >= 0),
    CONSTRAINT chk_mps_shots          CHECK (shots IS NULL OR shots >= 0),
    CONSTRAINT chk_mps_shots_on_target CHECK (shots_on_target IS NULL OR shots_on_target >= 0),
    CONSTRAINT chk_mps_passes         CHECK (passes IS NULL OR passes >= 0),
    CONSTRAINT chk_mps_pass_accuracy  CHECK (pass_accuracy IS NULL OR (pass_accuracy >= 0 AND pass_accuracy <= 100)),
    CONSTRAINT chk_mps_tackles        CHECK (tackles IS NULL OR tackles >= 0),
    CONSTRAINT chk_mps_interceptions  CHECK (interceptions IS NULL OR interceptions >= 0),
    CONSTRAINT chk_mps_clearances     CHECK (clearances IS NULL OR clearances >= 0),
    CONSTRAINT chk_mps_yellow_cards   CHECK (yellow_cards IS NULL OR yellow_cards >= 0),
    CONSTRAINT chk_mps_red_cards      CHECK (red_cards IS NULL OR red_cards >= 0),
    CONSTRAINT chk_mps_rating         CHECK (rating IS NULL OR rating >= 0)
);

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mts_match_id ON public.match_team_statistics (match_id);
CREATE INDEX IF NOT EXISTS idx_mts_team_id  ON public.match_team_statistics (team_id);
CREATE INDEX IF NOT EXISTS idx_mps_match_id ON public.match_player_statistics (match_id);
CREATE INDEX IF NOT EXISTS idx_mps_team_id  ON public.match_player_statistics (team_id);
CREATE INDEX IF NOT EXISTS idx_mps_player_id ON public.match_player_statistics (player_id);

-- ============================================================================
-- 4. UPDATED_AT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS trg_mts_updated_at ON public.match_team_statistics;
CREATE TRIGGER trg_mts_updated_at
    BEFORE UPDATE ON public.match_team_statistics
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_mps_updated_at ON public.match_player_statistics;
CREATE TRIGGER trg_mps_updated_at
    BEFORE UPDATE ON public.match_player_statistics
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS
-- ============================================================================

ALTER TABLE public.match_team_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_player_statistics ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_team_statistics_select_public ON public.match_team_statistics
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY match_player_statistics_select_public ON public.match_player_statistics
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- >>> 007_news_content.sql
-- ============================================================================
-- ============================================================================
-- 007_news_content.sql
-- News & Content core: categories, tags, articles, and relationships
-- ============================================================================

-- ============================================================================
-- 1. CATEGORIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.categories (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        varchar(100) NOT NULL,
    slug        citext      NOT NULL UNIQUE,
    description text,
    parent_id   uuid        REFERENCES public.categories(id) ON DELETE SET NULL,
    image_url   text,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. TAGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tags (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       varchar(80) NOT NULL,
    slug       citext      NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. ARTICLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.articles (
    id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id        uuid              REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    title            varchar(300)      NOT NULL,
    slug             citext            NOT NULL UNIQUE,
    excerpt          text,
    content          text              NOT NULL,
    status           public.article_status NOT NULL DEFAULT 'draft',
    article_type     public.article_type   NOT NULL DEFAULT 'news',
    featured_image_id uuid,
    published_at     timestamptz,
    scheduled_at     timestamptz,
    is_featured      boolean           NOT NULL DEFAULT false,
    is_breaking      boolean           NOT NULL DEFAULT false,
    view_count       bigint            NOT NULL DEFAULT 0,
    created_at       timestamptz       NOT NULL DEFAULT now(),
    updated_at       timestamptz       NOT NULL DEFAULT now(),
    CONSTRAINT chk_articles_view_count CHECK (view_count >= 0)
);

-- ============================================================================
-- 4. ARTICLE_CATEGORIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.article_categories (
    article_id  uuid        NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    category_id uuid        NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, category_id)
);

-- ============================================================================
-- 5. ARTICLE_TAGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.article_tags (
    article_id uuid        NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    tag_id     uuid        NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, tag_id)
);

-- ============================================================================
-- 6. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_is_active ON public.categories (is_active);

CREATE INDEX IF NOT EXISTS idx_articles_author_id      ON public.articles (author_id);
CREATE INDEX IF NOT EXISTS idx_articles_status_pub    ON public.articles (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_type_pub      ON public.articles (article_type, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_breaking_pub   ON public.articles (is_breaking, published_at DESC) WHERE is_breaking = true;
CREATE INDEX IF NOT EXISTS idx_articles_featured_pub  ON public.articles (is_featured, published_at DESC) WHERE is_featured = true;

CREATE INDEX IF NOT EXISTS idx_ac_category_id ON public.article_categories (category_id);
CREATE INDEX IF NOT EXISTS idx_at_tag_id      ON public.article_tags (tag_id);

-- ============================================================================
-- 7. UPDATED_AT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS trg_categories_updated_at ON public.categories;
CREATE TRIGGER trg_categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_articles_updated_at ON public.articles;
CREATE TRIGGER trg_articles_updated_at
    BEFORE UPDATE ON public.articles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 8. RLS
-- ============================================================================

ALTER TABLE public.categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_tags      ENABLE ROW LEVEL SECURITY;

-- Categories: public read for active
CREATE POLICY categories_select_active ON public.categories
    FOR SELECT
    TO anon, authenticated
    USING (is_active = true);

-- Tags: public read
CREATE POLICY tags_select_public ON public.tags
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Articles: public read for published only
CREATE POLICY articles_select_published ON public.articles
    FOR SELECT
    TO anon, authenticated
    USING (status = 'published' AND published_at IS NOT NULL);

-- Articles: authors can create
CREATE POLICY articles_insert_author ON public.articles
    FOR INSERT
    TO authenticated
    WITH CHECK (author_id = auth.uid());

-- Articles: authors can update own draft/review articles
CREATE POLICY articles_update_own ON public.articles
    FOR UPDATE
    TO authenticated
    USING (author_id = auth.uid() AND status IN ('draft', 'review'))
    WITH CHECK (author_id = auth.uid() AND status IN ('draft', 'review'));

-- Article categories: public read for published articles
CREATE POLICY article_categories_select_published ON public.article_categories
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );

-- Article tags: public read for published articles
CREATE POLICY article_tags_select_published ON public.article_tags
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );

-- ============================================================================
-- >>> 008_article_entity_relations.sql
-- ============================================================================
-- ============================================================================
-- 008_article_entity_relations.sql
-- Article <-> Football Entity many-to-many relations
-- ============================================================================

-- ============================================================================
-- 1. ARTICLE_TEAMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.article_teams (
    article_id uuid        NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    team_id    uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, team_id)
);

-- ============================================================================
-- 2. ARTICLE_PLAYERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.article_players (
    article_id uuid        NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    player_id  uuid        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, player_id)
);

-- ============================================================================
-- 3. ARTICLE_COMPETITIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.article_competitions (
    article_id      uuid        NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    competition_id uuid        NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, competition_id)
);

-- ============================================================================
-- 4. ARTICLE_MATCHES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.article_matches (
    article_id uuid        NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    match_id   uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, match_id)
);

-- ============================================================================
-- 5. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_article_teams_team_id        ON public.article_teams (team_id);
CREATE INDEX IF NOT EXISTS idx_article_players_player_id    ON public.article_players (player_id);
CREATE INDEX IF NOT EXISTS idx_article_competitions_comp_id ON public.article_competitions (competition_id);
CREATE INDEX IF NOT EXISTS idx_article_matches_match_id     ON public.article_matches (match_id);

-- ============================================================================
-- 6. RLS
-- ============================================================================

ALTER TABLE public.article_teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_matches      ENABLE ROW LEVEL SECURITY;

-- Public read: relations for published articles only
CREATE POLICY article_teams_select_published ON public.article_teams
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );

CREATE POLICY article_players_select_published ON public.article_players
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );

CREATE POLICY article_competitions_select_published ON public.article_competitions
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );

CREATE POLICY article_matches_select_published ON public.article_matches
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );

-- Author write: manage relations for own draft/review articles
CREATE POLICY article_teams_insert_own ON public.article_teams
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY article_teams_delete_own ON public.article_teams
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY article_players_insert_own ON public.article_players
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY article_players_delete_own ON public.article_players
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY article_competitions_insert_own ON public.article_competitions
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY article_competitions_delete_own ON public.article_competitions
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY article_matches_insert_own ON public.article_matches
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY article_matches_delete_own ON public.article_matches
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

-- ============================================================================
-- >>> 009_transfers.sql
-- ============================================================================
-- ============================================================================
-- 009_transfers.sql
-- Football Transfer System: transfer_windows and transfers
-- ============================================================================

-- ============================================================================
-- 1. TRANSFER_WINDOWS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.transfer_windows (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       varchar(150) NOT NULL,
    season_id  uuid        NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
    start_date date        NOT NULL,
    end_date   date        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_tw_date_range   CHECK (start_date <= end_date),
    CONSTRAINT chk_tw_name_not_empty CHECK (length(btrim(name)) > 0),
    CONSTRAINT uq_tw_season_name   UNIQUE (season_id, name)
);

-- ============================================================================
-- 2. TRANSFERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.transfers (
    id                uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id         uuid               NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
    from_team_id      uuid               REFERENCES public.teams(id) ON DELETE RESTRICT,
    to_team_id        uuid               REFERENCES public.teams(id) ON DELETE RESTRICT,
    transfer_type     public.transfer_type NOT NULL,
    status            public.transfer_status NOT NULL DEFAULT 'rumour',
    fee               numeric(18,2),
    currency          char(3),
    announcement_date timestamptz,
    effective_date    timestamptz,
    season_id         uuid               NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
    window_id         uuid               REFERENCES public.transfer_windows(id) ON DELETE SET NULL,
    metadata          jsonb              NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz        NOT NULL DEFAULT now(),
    updated_at        timestamptz        NOT NULL DEFAULT now(),
    CONSTRAINT chk_transfers_fee           CHECK (fee IS NULL OR fee >= 0),
    CONSTRAINT chk_transfers_currency      CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_transfers_dates         CHECK (announcement_date IS NULL OR effective_date IS NULL OR effective_date >= announcement_date),
    CONSTRAINT chk_transfers_different_teams CHECK (from_team_id IS NULL OR to_team_id IS NULL OR from_team_id <> to_team_id)
);

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tw_season_id    ON public.transfer_windows (season_id);
CREATE INDEX IF NOT EXISTS idx_tw_start_date   ON public.transfer_windows (start_date);
CREATE INDEX IF NOT EXISTS idx_tw_end_date     ON public.transfer_windows (end_date);
CREATE INDEX IF NOT EXISTS idx_tw_season_start ON public.transfer_windows (season_id, start_date);

CREATE INDEX IF NOT EXISTS idx_transfers_player_id      ON public.transfers (player_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from_team_id   ON public.transfers (from_team_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_team_id     ON public.transfers (to_team_id);
CREATE INDEX IF NOT EXISTS idx_transfers_season_id      ON public.transfers (season_id);
CREATE INDEX IF NOT EXISTS idx_transfers_window_id      ON public.transfers (window_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status         ON public.transfers (status);
CREATE INDEX IF NOT EXISTS idx_transfers_transfer_type  ON public.transfers (transfer_type);
CREATE INDEX IF NOT EXISTS idx_transfers_announce_date  ON public.transfers (announcement_date);
CREATE INDEX IF NOT EXISTS idx_transfers_effective_date ON public.transfers (effective_date);
CREATE INDEX IF NOT EXISTS idx_transfers_season_status  ON public.transfers (season_id, status);
CREATE INDEX IF NOT EXISTS idx_transfers_to_effective   ON public.transfers (to_team_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_transfers_from_effective ON public.transfers (from_team_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_transfers_player_effective ON public.transfers (player_id, effective_date);

-- ============================================================================
-- 4. UPDATED_AT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS trg_tw_updated_at ON public.transfer_windows;
CREATE TRIGGER trg_tw_updated_at
    BEFORE UPDATE ON public.transfer_windows
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_transfers_updated_at ON public.transfers;
CREATE TRIGGER trg_transfers_updated_at
    BEFORE UPDATE ON public.transfers
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS
-- ============================================================================

ALTER TABLE public.transfer_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers        ENABLE ROW LEVEL SECURITY;

-- Transfer windows: public read
CREATE POLICY transfer_windows_select_public ON public.transfer_windows
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Transfers: public read for announced/completed
CREATE POLICY transfers_select_public ON public.transfers
    FOR SELECT
    TO anon, authenticated
    USING (status IN ('announced', 'completed'));

-- ============================================================================
-- >>> 010_media.sql
-- ============================================================================
-- ============================================================================
-- 010_media.sql
-- Production Media System: media metadata table and article FK
-- ============================================================================

-- ============================================================================
-- 1. MEDIA TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.media (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_path text        NOT NULL,
    public_url   text,
    file_name    varchar(255) NOT NULL,
    mime_type    varchar(100) NOT NULL,
    width        integer,
    height       integer,
    file_size    bigint,
    alt_text     varchar(500),
    caption      text,
    credit       varchar(255),
    uploaded_by  uuid        REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_media_storage_path     UNIQUE (storage_path),
    CONSTRAINT chk_media_file_name_empty  CHECK (length(btrim(file_name)) > 0),
    CONSTRAINT chk_media_storage_path_empty CHECK (length(btrim(storage_path)) > 0),
    CONSTRAINT chk_media_mime_type_empty  CHECK (length(btrim(mime_type)) > 0),
    CONSTRAINT chk_media_width           CHECK (width IS NULL OR width >= 0),
    CONSTRAINT chk_media_height          CHECK (height IS NULL OR height >= 0),
    CONSTRAINT chk_media_file_size       CHECK (file_size IS NULL OR file_size >= 0),
    CONSTRAINT chk_media_alt_text_length CHECK (alt_text IS NULL OR length(alt_text) <= 500)
);

-- ============================================================================
-- 2. ARTICLE FEATURED IMAGE FK
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_articles_featured_image'
          AND conrelid = 'public.articles'::regclass
    ) THEN
        ALTER TABLE public.articles
            ADD CONSTRAINT fk_articles_featured_image
            FOREIGN KEY (featured_image_id)
            REFERENCES public.media(id)
            ON DELETE SET NULL;
    END IF;
END
$$;

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_media_uploaded_by ON public.media (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_media_mime_type   ON public.media (mime_type);
CREATE INDEX IF NOT EXISTS idx_media_created_at  ON public.media (created_at);

-- ============================================================================
-- 4. UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_media_updated_at ON public.media;
CREATE TRIGGER trg_media_updated_at
    BEFORE UPDATE ON public.media
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS
-- ============================================================================

ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;

-- Public read: media referenced by published articles or uploaded by active users
CREATE POLICY media_select_public ON public.media
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.featured_image_id = media.id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
        OR uploaded_by IS NOT NULL
    );

-- Authors: insert own media
CREATE POLICY media_insert_own ON public.media
    FOR INSERT
    TO authenticated
    WITH CHECK (uploaded_by = auth.uid());

-- Authors: update own media
CREATE POLICY media_update_own ON public.media
    FOR UPDATE
    TO authenticated
    USING (uploaded_by = auth.uid())
    WITH CHECK (uploaded_by = auth.uid());

-- Authors: delete own media
CREATE POLICY media_delete_own ON public.media
    FOR DELETE
    TO authenticated
    USING (uploaded_by = auth.uid());

-- ============================================================================
-- >>> 011_seo_metadata.sql
-- ============================================================================
-- ============================================================================
-- 011_seo_metadata.sql
-- Production SEO Metadata System
-- ============================================================================

-- ============================================================================
-- 1. SEO_METADATA TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.seo_metadata (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type       varchar(50)  NOT NULL,
    entity_id         uuid         NOT NULL,
    meta_title        varchar(70),
    meta_description  varchar(160),
    canonical_url     text,
    robots_index      boolean      NOT NULL DEFAULT true,
    robots_follow     boolean      NOT NULL DEFAULT true,
    og_title          varchar(200),
    og_description    text,
    og_image          text,
    twitter_title     varchar(200),
    twitter_description text,
    twitter_image     text,
    schema_type       varchar(100),
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_seo_entity           UNIQUE (entity_type, entity_id),
    CONSTRAINT chk_seo_entity_type_not_empty CHECK (length(btrim(entity_type)) > 0),
    CONSTRAINT chk_seo_meta_title_length     CHECK (meta_title IS NULL OR length(meta_title) <= 70),
    CONSTRAINT chk_seo_meta_desc_length      CHECK (meta_description IS NULL OR length(meta_description) <= 160),
    CONSTRAINT chk_seo_og_title_length       CHECK (og_title IS NULL OR length(og_title) <= 200),
    CONSTRAINT chk_seo_twitter_title_length  CHECK (twitter_title IS NULL OR length(twitter_title) <= 200)
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_seo_entity_type ON public.seo_metadata (entity_type);
CREATE INDEX IF NOT EXISTS idx_seo_entity_id   ON public.seo_metadata (entity_id);

-- ============================================================================
-- 3. UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_seo_metadata_updated_at ON public.seo_metadata;
CREATE TRIGGER trg_seo_metadata_updated_at
    BEFORE UPDATE ON public.seo_metadata
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE public.seo_metadata ENABLE ROW LEVEL SECURITY;

-- Public read: SEO metadata for published articles
CREATE POLICY seo_metadata_select_published ON public.seo_metadata
    FOR SELECT
    TO anon, authenticated
    USING (
        (entity_type = 'article' AND EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = entity_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        ))
        OR entity_type IN ('match', 'team', 'player', 'competition', 'category', 'tag')
    );

-- Authors: manage SEO for own draft/review articles
CREATE POLICY seo_metadata_insert_own ON public.seo_metadata
    FOR INSERT
    TO authenticated
    WITH CHECK (
        entity_type = 'article'
        AND EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = entity_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY seo_metadata_update_own ON public.seo_metadata
    FOR UPDATE
    TO authenticated
    USING (
        entity_type = 'article'
        AND EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = entity_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    )
    WITH CHECK (
        entity_type = 'article'
        AND EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = entity_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY seo_metadata_delete_own ON public.seo_metadata
    FOR DELETE
    TO authenticated
    USING (
        entity_type = 'article'
        AND EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = entity_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

-- ============================================================================
-- >>> 012_redirects.sql
-- ============================================================================
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

-- ============================================================================
-- >>> 013_provider_foundation.sql
-- ============================================================================
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

-- ============================================================================
-- >>> 014_favorites_notifications.sql
-- ============================================================================
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

-- ============================================================================
-- >>> 015_audit_settings.sql
-- ============================================================================
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

-- ============================================================================
-- >>> 016_hardening.sql
-- ============================================================================
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

-- ============================================================================
-- >>> 017_search.sql
-- ============================================================================
-- ============================================================================
-- 017_search.sql
-- Global Search & Discovery: trigram support + search performance indexes
--
-- The API issues parameterized ILIKE '%token%' searches through PostgREST.
-- pg_trgm GIN indexes make those patterns index-accelerated instead of
-- sequential scans. One index per searched column keeps bitmap-OR plans
-- efficient without over-indexing.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Teams: name / short_name / slug
CREATE INDEX IF NOT EXISTS idx_search_teams_name
    ON public.teams USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_teams_short_name
    ON public.teams USING gin (short_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_teams_slug
    ON public.teams USING gin (slug gin_trgm_ops);

-- Players: display_name / first_name / last_name
CREATE INDEX IF NOT EXISTS idx_search_players_display_name
    ON public.players USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_players_first_name
    ON public.players USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_players_last_name
    ON public.players USING gin (last_name gin_trgm_ops);

-- Competitions: name / short_name
CREATE INDEX IF NOT EXISTS idx_search_competitions_name
    ON public.competitions USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_competitions_short_name
    ON public.competitions USING gin (short_name gin_trgm_ops);

-- Articles: title / excerpt (content is intentionally NOT indexed for search)
CREATE INDEX IF NOT EXISTS idx_search_articles_title
    ON public.articles USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_search_articles_excerpt
    ON public.articles USING gin (excerpt gin_trgm_ops);

-- Matches: slug (entity-name matching resolves through team/competition IDs)
CREATE INDEX IF NOT EXISTS idx_search_matches_slug
    ON public.matches USING gin (slug gin_trgm_ops);

-- ============================================================================
-- >>> 018_seed_provider.sql
-- ============================================================================
-- ============================================================================
-- 018_seed_provider.sql
-- Register the bundled deterministic seed provider (lowest precedence).
-- No football data is inserted here; rows arrive through the import pipeline.
-- ============================================================================

INSERT INTO public.data_sources (name, provider, api_version, is_active, priority)
VALUES ('Seed Provider', 'seed', 'v1', true, 1000)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- >>> 019_sync_queue.sql
-- ============================================================================
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

-- ============================================================================
-- >>> 020_sync_schedules.sql
-- ============================================================================
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

-- ============================================================================
-- >>> 021_news_publishing.sql
-- ============================================================================
-- ============================================================================
-- 021_news_publishing.sql
-- News Management & Publishing Pipeline (Step 26) support
-- No new content models: reuses articles/categories/tags/relations/media/seo.
-- Adds scheduled-publishing index and publish timestamp guardrails.
-- ============================================================================

-- Due scheduled articles lookup: status + scheduled_at (used by publisher).
CREATE INDEX IF NOT EXISTS idx_articles_scheduled_due
    ON public.articles (status, scheduled_at)
    WHERE status = 'scheduled';

-- Published recency lookup for sitemap/news-sitemap eligibility.
CREATE INDEX IF NOT EXISTS idx_articles_published_recent
    ON public.articles (published_at DESC)
    WHERE status = 'published';

-- Guardrail: scheduled articles must carry a scheduled_at timestamp.
-- Enforced as a CHECK so invalid scheduled rows fail fast at the DB layer.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_articles_scheduled_at'
    ) THEN
        ALTER TABLE public.articles
            ADD CONSTRAINT chk_articles_scheduled_at
            CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL);
    END IF;
END
$$;

-- Guardrail: published articles must carry a published_at timestamp.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_articles_published_at'
    ) THEN
        ALTER TABLE public.articles
            ADD CONSTRAINT chk_articles_published_at
            CHECK (status <> 'published' OR published_at IS NOT NULL);
    END IF;
END
$$;

-- ============================================================================
-- >>> 022_media_variants.sql
-- ============================================================================
-- ============================================================================
-- 022_media_variants.sql
-- Production Image/Media Processing (Step 27) support.
-- Backward compatible: existing media table untouched except an optional
-- idempotency key; canonical originals stay in media, generated renditions
-- live in media_variants. No changes to articles/SEO/news pipeline.
-- ============================================================================

-- Idempotency key for safe upload retries (nullable; unique when present).
ALTER TABLE public.media
    ADD COLUMN IF NOT EXISTS idempotency_key text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'uq_media_idempotency_key'
    ) THEN
        CREATE UNIQUE INDEX uq_media_idempotency_key
            ON public.media (idempotency_key)
            WHERE idempotency_key IS NOT NULL;
    END IF;
END
$$;

-- Generated renditions. Canonical original remains the parent media row.
CREATE TABLE IF NOT EXISTS public.media_variants (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id     uuid        NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
    variant      varchar(32) NOT NULL,
    width        integer,
    height       integer,
    mime_type    varchar(100) NOT NULL,
    storage_path text        NOT NULL,
    public_url   text,
    file_size    bigint,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_media_variant UNIQUE (media_id, variant),
    CONSTRAINT chk_media_variant_name_empty CHECK (length(btrim(variant)) > 0),
    CONSTRAINT chk_media_variant_path_empty CHECK (length(btrim(storage_path)) > 0),
    CONSTRAINT chk_media_variant_width CHECK (width IS NULL OR width >= 0),
    CONSTRAINT chk_media_variant_height CHECK (height IS NULL OR height >= 0),
    CONSTRAINT chk_media_variant_file_size CHECK (file_size IS NULL OR file_size >= 0)
);

CREATE INDEX IF NOT EXISTS idx_media_variants_media_id ON public.media_variants (media_id);

ALTER TABLE public.media_variants ENABLE ROW LEVEL SECURITY;

-- Public read: variants of media visible to the public (published-article
-- featured images). Mirrors the parent media policy without duplicating logic.
DROP POLICY IF EXISTS media_variants_select_published ON public.media_variants;
CREATE POLICY media_variants_select_published ON public.media_variants
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.media m
            JOIN public.articles a ON a.featured_image_id = m.id
            WHERE m.id = media_variants.media_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );

-- Authors manage variants only through the Media Service (service role);
-- editor-facing variant writes go through the same service path.
-- No direct client INSERT/UPDATE/DELETE policies by design.

-- ============================================================================
-- >>> 023_step40_verification.sql
-- ============================================================================
-- ============================================================================
-- 023_step40_verification.sql
-- Step 40: Production Integration & Real-Data Verification support.
--
-- Adds two read-only, SECURITY DEFINER functions that the Step 40 verification
-- CLI calls over PostgREST (which cannot reach pg_catalog directly):
--
--   * public.verify_schema_health()  — observed schema inventory
--     (extensions, enums, tables, indexes, functions, triggers, RLS state).
--   * public.verify_canonical_data() — canonical-data audit
--     (duplicate entities, duplicate/fan-out external IDs, broken
--     relationships, and data-freshness signals).
--
-- These are diagnostics only: they mutate nothing. They are restricted to
-- service_role so schema metadata is never exposed to anon/authenticated
-- browser traffic.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- verify_schema_health()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_schema_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    payload jsonb;
BEGIN
    SELECT jsonb_build_object(
        'extensions', COALESCE((
            SELECT jsonb_agg(extname ORDER BY extname)
            FROM pg_extension
            WHERE extname IN ('citext', 'pg_trgm', 'pgcrypto')
        ), '[]'::jsonb),

        'enums', COALESCE((
            SELECT jsonb_agg(t.typname ORDER BY t.typname)
            FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public'
              AND t.typtype = 'e'
        ), '[]'::jsonb),

        'tables', COALESCE((
            SELECT jsonb_agg(c.relname ORDER BY c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
        ), '[]'::jsonb),

        'indexes', COALESCE((
            SELECT jsonb_agg(c.relname ORDER BY c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'i'
        ), '[]'::jsonb),

        'functions', COALESCE((
            SELECT jsonb_agg(p.proname ORDER BY p.proname)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
        ), '[]'::jsonb),

        'triggers', COALESCE((
            SELECT jsonb_agg(t.tgname ORDER BY t.tgname)
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND NOT t.tgisinternal
        ), '[]'::jsonb),

        -- Tables where RLS is enabled but no policy exists: silently wide open
        -- for a role that bypasses nothing, or accidentally locked shut.
        'tables_without_rls', COALESCE((
            SELECT jsonb_agg(c.relname ORDER BY c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND NOT c.relrowsecurity
        ), '[]'::jsonb),

        'policy_count', (
            SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
        ),

        'table_row_counts', COALESCE((
            SELECT jsonb_object_agg(u.table_name, u.row_count)
            FROM (
                SELECT 'teams' AS table_name, count(*)::bigint AS row_count FROM public.teams
                UNION ALL SELECT 'players', count(*)::bigint FROM public.players
                UNION ALL SELECT 'competitions', count(*)::bigint FROM public.competitions
                UNION ALL SELECT 'seasons', count(*)::bigint FROM public.seasons
                UNION ALL SELECT 'countries', count(*)::bigint FROM public.countries
                UNION ALL SELECT 'venues', count(*)::bigint FROM public.venues
                UNION ALL SELECT 'matches', count(*)::bigint FROM public.matches
                UNION ALL SELECT 'match_events', count(*)::bigint FROM public.match_events
                UNION ALL SELECT 'articles', count(*)::bigint FROM public.articles
                UNION ALL SELECT 'transfers', count(*)::bigint FROM public.transfers
                UNION ALL SELECT 'external_entity_ids', count(*)::bigint FROM public.external_entity_ids
                UNION ALL SELECT 'sync_jobs', count(*)::bigint FROM public.sync_jobs
                UNION ALL SELECT 'data_sources', count(*)::bigint FROM public.data_sources
            ) u
        ), '{}'::jsonb)
    )
    INTO payload;

    RETURN payload;
END;
$$;

COMMENT ON FUNCTION public.verify_schema_health() IS
    'Step 40 diagnostics: observed schema inventory. Read-only; service_role only.';

-- ---------------------------------------------------------------------------
-- verify_canonical_data()
--
-- Duplicate detection normalizes names the way a human would: diacritics
-- removed, punctuation stripped, and common club-name tokens (FC, CF, SC…)
-- ignored, so "FC Barcelona" and "Barcelona FC" collapse to one group.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._step40_norm_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT btrim(regexp_replace(
        -- Lowercase, fold diacritics, drop common club-name tokens (whole words
        -- only), then strip everything non-alphanumeric.
        regexp_replace(
            translate(
                lower(coalesce(input, '')),
                'áàâäãåéèêëíìîïóòôöõúùûüñçýÿšžđčć',
                'aaaaaaeeeeiiiiooooouuuuncyyszdcc'
            ),
            '\m(fc|cf|afc|sc|ac|as|ss|ssc|us|ud|cd|sd|bc|if|sv|vfl|vfb|tsg|fk|sk)\M',
            ' ', 'g'),
        '[^a-z0-9]+', '', 'g'));
$$;

COMMENT ON FUNCTION public._step40_norm_name(text) IS
    'Step 40 helper: normalization key for duplicate canonical entity detection.';

CREATE OR REPLACE FUNCTION public.verify_canonical_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    payload jsonb;
BEGIN
    SELECT jsonb_build_object(
        -- Duplicate canonical teams / competitions: same normalized name.
        'duplicate_teams', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'normalized_name', n.nm,
                'count', n.cnt,
                'ids', n.ids,
                'names', n.names
            ))
            FROM (
                SELECT public._step40_norm_name(name) AS nm,
                       count(*)::int AS cnt,
                       jsonb_agg(id) AS ids,
                       jsonb_agg(name) AS names
                FROM public.teams
                WHERE name IS NOT NULL
                GROUP BY 1
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        'duplicate_competitions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'normalized_name', n.nm, 'count', n.cnt, 'ids', n.ids, 'names', n.names
            ))
            FROM (
                SELECT public._step40_norm_name(name) AS nm,
                       count(*)::int AS cnt, jsonb_agg(id) AS ids, jsonb_agg(name) AS names
                FROM public.competitions
                WHERE name IS NOT NULL
                GROUP BY 1
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- Players: normalized display name is only a *candidate* duplicate when
        -- two players also share a birth date. Different people legitimately
        -- share a name; this avoids flagging them.
        'duplicate_players', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'normalized_name', n.nm, 'date_of_birth', n.dob,
                'count', n.cnt, 'ids', n.ids, 'names', n.names
            ))
            FROM (
                SELECT public._step40_norm_name(display_name) AS nm,
                       date_of_birth AS dob,
                       count(*)::int AS cnt,
                       jsonb_agg(id) AS ids,
                       jsonb_agg(display_name) AS names
                FROM public.players
                WHERE display_name IS NOT NULL
                GROUP BY 1, 2
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- Duplicate matches: same kickoff and same home team. Away side is
        -- included in the grouping so reversed fixtures are not flagged.
        'duplicate_matches', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'kickoff_at', n.scheduled_at, 'home_team_id', n.home_team_id,
                'away_team_id', n.away_team_id, 'count', n.cnt, 'ids', n.ids
            ))
            FROM (
                SELECT scheduled_at, home_team_id, away_team_id,
                       count(*)::int AS cnt, jsonb_agg(id) AS ids
                FROM public.matches
                GROUP BY 1, 2, 3
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- One external record resolving to more than one canonical entity is
        -- an entity-resolution defect even though the unique constraint allows it.
        'external_id_fanout', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'data_source_id', n.ds, 'entity_type', n.et,
                'external_id', n.ext, 'entity_count', n.cnt, 'entity_ids', n.ids
            ))
            FROM (
                SELECT data_source_id AS ds, entity_type AS et, external_id AS ext,
                       count(DISTINCT entity_id)::int AS cnt,
                       jsonb_agg(DISTINCT entity_id) AS ids
                FROM public.external_entity_ids
                GROUP BY 1, 2, 3
                HAVING count(DISTINCT entity_id) > 1
            ) n
        ), '[]'::jsonb),

        -- One canonical entity mapped to several external ids for one source.
        'entity_multi_mapping', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'data_source_id', n.ds, 'entity_type', n.et,
                'entity_id', n.eid, 'external_ids', n.exts
            ))
            FROM (
                SELECT data_source_id AS ds, entity_type AS et, entity_id AS eid,
                       count(*)::int AS cnt, jsonb_agg(external_id) AS exts
                FROM public.external_entity_ids
                GROUP BY 1, 2, 3
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- Broken relationships (orphan FK targets).
        'broken_relationships', jsonb_build_object(
            'match_home_team', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.home_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = m.home_team_id)
            ),
            'match_away_team', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.away_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = m.away_team_id)
            ),
            'match_competition', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.competition_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.competitions c WHERE c.id = m.competition_id)
            ),
            'match_season', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.season_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id)
            ),
            'match_venue', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.venue_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = m.venue_id)
            ),
            'transfer_player', (
                SELECT count(*)::int FROM public.transfers tr
                WHERE tr.player_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = tr.player_id)
            ),
            'transfer_from_team', (
                SELECT count(*)::int FROM public.transfers tr
                WHERE tr.from_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = tr.from_team_id)
            ),
            'transfer_to_team', (
                SELECT count(*)::int FROM public.transfers tr
                WHERE tr.to_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = tr.to_team_id)
            ),
            'match_events_orphan_match', (
                SELECT count(*)::int FROM public.match_events e
                WHERE NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = e.match_id)
            ),
            'external_ids_orphan_source', (
                SELECT count(*)::int FROM public.external_entity_ids x
                WHERE NOT EXISTS (SELECT 1 FROM public.data_sources d WHERE d.id = x.data_source_id)
            )
        ),

        -- Data freshness: signals that stale content is being served as current.
        'freshness', jsonb_build_object(
            'live_matches', (
                SELECT count(*)::int FROM public.matches
                WHERE status IN ('live', 'half_time', 'extra_time', 'penalty_shootout')
            ),
            'live_matches_stale', (
                -- Live now but untouched for over 15 minutes: the sync worker is
                -- not refreshing, so the score is being presented as current.
                SELECT count(*)::int FROM public.matches
                WHERE status IN ('live', 'half_time', 'extra_time', 'penalty_shootout')
                  AND updated_at < now() - interval '15 minutes'
            ),
            'finished_without_score', (
                SELECT count(*)::int FROM public.matches
                WHERE status = 'finished'
                  AND (home_score IS NULL OR away_score IS NULL)
            ),
            'finished_future_kickoff', (
                SELECT count(*)::int FROM public.matches
                WHERE status = 'finished' AND scheduled_at > now()
            ),
            'scheduled_past_kickoff', (
                -- Still "scheduled" well after kickoff: missed by the scheduler.
                SELECT count(*)::int FROM public.matches
                WHERE status IN ('scheduled', 'pre_match')
                  AND scheduled_at < now() - interval '3 hours'
            ),
            'latest_live_update', (
                SELECT max(updated_at)::text FROM public.matches
                WHERE status IN ('live', 'half_time', 'extra_time', 'penalty_shootout')
            ),
            'latest_article_published', (
                SELECT max(published_at)::text FROM public.articles WHERE status = 'published'
            ),
            'latest_transfer_at', (
                SELECT max(created_at)::text FROM public.transfers
            ),
            'failed_sync_jobs', (
                SELECT count(*)::int FROM public.sync_jobs WHERE status = 'failed'
            ),
            'stuck_running_sync_jobs', (
                -- 'running' but not progressed: a worker died mid-claim. The
                -- queue models liveness with lease_expires_at (019_sync_queue.sql);
                -- sync_jobs has no updated_at column.
                SELECT count(*)::int FROM public.sync_jobs
                WHERE status = 'running'
                  AND lease_expires_at IS NOT NULL
                  AND lease_expires_at < now() - interval '30 minutes'
            )
        )
    )
    INTO payload;

    RETURN payload;
END;
$$;

COMMENT ON FUNCTION public.verify_canonical_data() IS
    'Step 40 diagnostics: canonical duplicate, relationship-integrity and freshness audit. Read-only.';

-- ---------------------------------------------------------------------------
-- Restrict both diagnostics to service_role. The public site never needs them.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.verify_schema_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_canonical_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._step40_norm_name(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.verify_schema_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_canonical_data() TO service_role;
GRANT EXECUTE ON FUNCTION public._step40_norm_name(text) TO service_role;

-- ============================================================================
-- >>> 024_step40_verification_fixes.sql
-- ============================================================================
-- ---------------------------------------------------------------------------
-- 024_step40_verification_fixes.sql
--
-- Corrective, forward-only migration. Safe to run more than once: it contains
-- only CREATE OR REPLACE FUNCTION and REVOKE/GRANT, all of which are idempotent.
-- It creates, alters and drops nothing.
--
-- Migration 023 is already applied in production and cannot be re-run as a
-- whole (CREATE TYPE and CREATE TRIGGER have no IF NOT EXISTS in PostgreSQL).
-- This migration therefore re-publishes only the three Step 40 diagnostics with
-- the defects below corrected.
--
-- 1. verify_schema_health()
--    023 selected jsonb_agg(name ORDER BY name) FROM pg_extension. pg_extension
--    has no "name" column, so every call failed with:
--        ERROR 42703 column "name" does not exist
--    Corrected to extname, the actual column.
--
-- 2. verify_canonical_data()
--    The external_id_fanout and entity_multi_mapping sub-queries selected
--    data_source_id / entity_type / external_id / entity_id without aliases,
--    but the enclosing jsonb_build_object referenced them as n.ds, n.et, n.ext
--    and n.eid. Every call failed with:
--        ERROR 42703 column n.ds does not exist
--    The inner projections now alias the columns they are addressed by.
--
-- Both defects were invisible at deploy time: PostgreSQL does not validate
-- plpgsql bodies at CREATE FUNCTION, so 023 applied cleanly and failed only on
-- first call. That is why these are fixed by re-publishing the functions rather
-- than by editing 023 alone.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_schema_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    payload jsonb;
BEGIN
    SELECT jsonb_build_object(
        'extensions', COALESCE((
            SELECT jsonb_agg(extname ORDER BY extname)
            FROM pg_extension
            WHERE extname IN ('citext', 'pg_trgm', 'pgcrypto')
        ), '[]'::jsonb),

        'enums', COALESCE((
            SELECT jsonb_agg(t.typname ORDER BY t.typname)
            FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public'
              AND t.typtype = 'e'
        ), '[]'::jsonb),

        'tables', COALESCE((
            SELECT jsonb_agg(c.relname ORDER BY c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
        ), '[]'::jsonb),

        'indexes', COALESCE((
            SELECT jsonb_agg(c.relname ORDER BY c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'i'
        ), '[]'::jsonb),

        'functions', COALESCE((
            SELECT jsonb_agg(p.proname ORDER BY p.proname)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
        ), '[]'::jsonb),

        'triggers', COALESCE((
            SELECT jsonb_agg(t.tgname ORDER BY t.tgname)
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND NOT t.tgisinternal
        ), '[]'::jsonb),

        -- Tables where RLS is enabled but no policy exists: silently wide open
        -- for a role that bypasses nothing, or accidentally locked shut.
        'tables_without_rls', COALESCE((
            SELECT jsonb_agg(c.relname ORDER BY c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND NOT c.relrowsecurity
        ), '[]'::jsonb),

        'policy_count', (
            SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
        ),

        'table_row_counts', COALESCE((
            SELECT jsonb_object_agg(u.table_name, u.row_count)
            FROM (
                SELECT 'teams' AS table_name, count(*)::bigint AS row_count FROM public.teams
                UNION ALL SELECT 'players', count(*)::bigint FROM public.players
                UNION ALL SELECT 'competitions', count(*)::bigint FROM public.competitions
                UNION ALL SELECT 'seasons', count(*)::bigint FROM public.seasons
                UNION ALL SELECT 'countries', count(*)::bigint FROM public.countries
                UNION ALL SELECT 'venues', count(*)::bigint FROM public.venues
                UNION ALL SELECT 'matches', count(*)::bigint FROM public.matches
                UNION ALL SELECT 'match_events', count(*)::bigint FROM public.match_events
                UNION ALL SELECT 'articles', count(*)::bigint FROM public.articles
                UNION ALL SELECT 'transfers', count(*)::bigint FROM public.transfers
                UNION ALL SELECT 'external_entity_ids', count(*)::bigint FROM public.external_entity_ids
                UNION ALL SELECT 'sync_jobs', count(*)::bigint FROM public.sync_jobs
                UNION ALL SELECT 'data_sources', count(*)::bigint FROM public.data_sources
            ) u
        ), '{}'::jsonb)
    )
    INTO payload;

    RETURN payload;
END;
$$;

CREATE OR REPLACE FUNCTION public._step40_norm_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT btrim(regexp_replace(
        -- Lowercase, fold diacritics, drop common club-name tokens (whole words
        -- only), then strip everything non-alphanumeric.
        regexp_replace(
            translate(
                lower(coalesce(input, '')),
                'áàâäãåéèêëíìîïóòôöõúùûüñçýÿšžđčć',
                'aaaaaaeeeeiiiiooooouuuuncyyszdcc'
            ),
            '\m(fc|cf|afc|sc|ac|as|ss|ssc|us|ud|cd|sd|bc|if|sv|vfl|vfb|tsg|fk|sk)\M',
            ' ', 'g'),
        '[^a-z0-9]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.verify_canonical_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    payload jsonb;
BEGIN
    SELECT jsonb_build_object(
        -- Duplicate canonical teams / competitions: same normalized name.
        'duplicate_teams', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'normalized_name', n.nm,
                'count', n.cnt,
                'ids', n.ids,
                'names', n.names
            ))
            FROM (
                SELECT public._step40_norm_name(name) AS nm,
                       count(*)::int AS cnt,
                       jsonb_agg(id) AS ids,
                       jsonb_agg(name) AS names
                FROM public.teams
                WHERE name IS NOT NULL
                GROUP BY 1
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        'duplicate_competitions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'normalized_name', n.nm, 'count', n.cnt, 'ids', n.ids, 'names', n.names
            ))
            FROM (
                SELECT public._step40_norm_name(name) AS nm,
                       count(*)::int AS cnt, jsonb_agg(id) AS ids, jsonb_agg(name) AS names
                FROM public.competitions
                WHERE name IS NOT NULL
                GROUP BY 1
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- Players: normalized display name is only a *candidate* duplicate when
        -- two players also share a birth date. Different people legitimately
        -- share a name; this avoids flagging them.
        'duplicate_players', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'normalized_name', n.nm, 'date_of_birth', n.dob,
                'count', n.cnt, 'ids', n.ids, 'names', n.names
            ))
            FROM (
                SELECT public._step40_norm_name(display_name) AS nm,
                       date_of_birth AS dob,
                       count(*)::int AS cnt,
                       jsonb_agg(id) AS ids,
                       jsonb_agg(display_name) AS names
                FROM public.players
                WHERE display_name IS NOT NULL
                GROUP BY 1, 2
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- Duplicate matches: same kickoff and same home team. Away side is
        -- included in the grouping so reversed fixtures are not flagged.
        'duplicate_matches', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'kickoff_at', n.scheduled_at, 'home_team_id', n.home_team_id,
                'away_team_id', n.away_team_id, 'count', n.cnt, 'ids', n.ids
            ))
            FROM (
                SELECT scheduled_at, home_team_id, away_team_id,
                       count(*)::int AS cnt, jsonb_agg(id) AS ids
                FROM public.matches
                GROUP BY 1, 2, 3
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- One external record resolving to more than one canonical entity is
        -- an entity-resolution defect even though the unique constraint allows it.
        'external_id_fanout', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'data_source_id', n.ds, 'entity_type', n.et,
                'external_id', n.ext, 'entity_count', n.cnt, 'entity_ids', n.ids
            ))
            FROM (
                SELECT data_source_id AS ds, entity_type AS et, external_id AS ext,
                       count(DISTINCT entity_id)::int AS cnt,
                       jsonb_agg(DISTINCT entity_id) AS ids
                FROM public.external_entity_ids
                GROUP BY 1, 2, 3
                HAVING count(DISTINCT entity_id) > 1
            ) n
        ), '[]'::jsonb),

        -- One canonical entity mapped to several external ids for one source.
        'entity_multi_mapping', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'data_source_id', n.ds, 'entity_type', n.et,
                'entity_id', n.eid, 'external_ids', n.exts
            ))
            FROM (
                SELECT data_source_id AS ds, entity_type AS et, entity_id AS eid,
                       count(*)::int AS cnt, jsonb_agg(external_id) AS exts
                FROM public.external_entity_ids
                GROUP BY 1, 2, 3
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- Broken relationships (orphan FK targets).
        'broken_relationships', jsonb_build_object(
            'match_home_team', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.home_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = m.home_team_id)
            ),
            'match_away_team', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.away_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = m.away_team_id)
            ),
            'match_competition', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.competition_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.competitions c WHERE c.id = m.competition_id)
            ),
            'match_season', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.season_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id)
            ),
            'match_venue', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.venue_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = m.venue_id)
            ),
            'transfer_player', (
                SELECT count(*)::int FROM public.transfers tr
                WHERE tr.player_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = tr.player_id)
            ),
            'transfer_from_team', (
                SELECT count(*)::int FROM public.transfers tr
                WHERE tr.from_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = tr.from_team_id)
            ),
            'transfer_to_team', (
                SELECT count(*)::int FROM public.transfers tr
                WHERE tr.to_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = tr.to_team_id)
            ),
            'match_events_orphan_match', (
                SELECT count(*)::int FROM public.match_events e
                WHERE NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = e.match_id)
            ),
            'external_ids_orphan_source', (
                SELECT count(*)::int FROM public.external_entity_ids x
                WHERE NOT EXISTS (SELECT 1 FROM public.data_sources d WHERE d.id = x.data_source_id)
            )
        ),

        -- Data freshness: signals that stale content is being served as current.
        'freshness', jsonb_build_object(
            'live_matches', (
                SELECT count(*)::int FROM public.matches
                WHERE status IN ('live', 'half_time', 'extra_time', 'penalty_shootout')
            ),
            'live_matches_stale', (
                -- Live now but untouched for over 15 minutes: the sync worker is
                -- not refreshing, so the score is being presented as current.
                SELECT count(*)::int FROM public.matches
                WHERE status IN ('live', 'half_time', 'extra_time', 'penalty_shootout')
                  AND updated_at < now() - interval '15 minutes'
            ),
            'finished_without_score', (
                SELECT count(*)::int FROM public.matches
                WHERE status = 'finished'
                  AND (home_score IS NULL OR away_score IS NULL)
            ),
            'finished_future_kickoff', (
                SELECT count(*)::int FROM public.matches
                WHERE status = 'finished' AND scheduled_at > now()
            ),
            'scheduled_past_kickoff', (
                -- Still "scheduled" well after kickoff: missed by the scheduler.
                SELECT count(*)::int FROM public.matches
                WHERE status IN ('scheduled', 'pre_match')
                  AND scheduled_at < now() - interval '3 hours'
            ),
            'latest_live_update', (
                SELECT max(updated_at)::text FROM public.matches
                WHERE status IN ('live', 'half_time', 'extra_time', 'penalty_shootout')
            ),
            'latest_article_published', (
                SELECT max(published_at)::text FROM public.articles WHERE status = 'published'
            ),
            'latest_transfer_at', (
                SELECT max(created_at)::text FROM public.transfers
            ),
            'failed_sync_jobs', (
                SELECT count(*)::int FROM public.sync_jobs WHERE status = 'failed'
            ),
            'stuck_running_sync_jobs', (
                -- 'running' but not progressed: a worker died mid-claim. The
                -- queue models liveness with lease_expires_at (019_sync_queue.sql);
                -- sync_jobs has no updated_at column.
                SELECT count(*)::int FROM public.sync_jobs
                WHERE status = 'running'
                  AND lease_expires_at IS NOT NULL
                  AND lease_expires_at < now() - interval '30 minutes'
            )
        )
    )
    INTO payload;

    RETURN payload;
END;
$$;

-- ---------------------------------------------------------------------------
-- Restrict both diagnostics to service_role. The public site never needs them.
-- Re-issued here so the privilege posture travels with the corrected bodies.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.verify_schema_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_canonical_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._step40_norm_name(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.verify_schema_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_canonical_data() TO service_role;
GRANT EXECUTE ON FUNCTION public._step40_norm_name(text) TO service_role;


-- ============================================================================
-- >>> 025_admin_foundation.sql
-- ============================================================================
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


-- ============================================================================
-- >>> 026_admin_settings_catalogue.sql
-- ============================================================================
-- ============================================================================
-- 026_admin_settings_catalogue.sql
-- Admin Site Settings catalogue (STEP 12)
--
-- Context: public.system_settings exists (015, admin-only RLS) but nothing
-- reads it yet â€” there is deliberately NO public consumer to rewire, so this
-- migration changes no public behavior. It seeds the minimal catalogue the
-- Admin Settings API manages. Infrastructure secrets (DB/Supabase/API keys)
-- must NEVER be stored here; they stay in environment/server config
-- (see backend/src/providers/config.ts).
--
-- Contents:
--   1. settings.read permission (025 shipped only settings.manage) + grants
--      to super_admin/admin (editor/moderator intentionally excluded).
--   2. Curated catalogue rows (INSERT ... ON CONFLICT DO NOTHING â€” no data
--      overwritten, safe to re-run).
--
-- Reversibility (ROLLBACK, manual):
--   DELETE FROM public.admin_role_permissions WHERE permission_id IN
--     (SELECT id FROM public.admin_permissions WHERE key = 'settings.read');
--   DELETE FROM public.admin_permissions WHERE key = 'settings.read';
--   DELETE FROM public.system_settings WHERE key IN (<catalogue keys below>);
-- ============================================================================

-- ============================================================================
-- 1. settings.read permission (read/manage split per Admin API contract)
-- ============================================================================

INSERT INTO public.admin_permissions (key, resource, action, description) VALUES
    ('settings.read', 'settings', 'read', 'View site settings')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.admin_permissions p
WHERE r.name IN ('super_admin', 'admin')
  AND p.key = 'settings.read'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. Catalogue (namespaced keys; category = first segment)
--   site.*      General / Website identity
--   seo.*       SEO defaults
--   news.*      News module
--   football.*  Football/Data module
--   social.*    Social links (URL)
--   contact.*   Contact (no secrets)
--   features.*  Feature flags (boolean)
-- ============================================================================

INSERT INTO public.system_settings (key, value, type, description) VALUES
    ('site.name',            to_jsonb('Football'::text),              'string',  'Public site name'),
    ('site.tagline',         to_jsonb('Global football coverage'::text), 'string', 'Public site tagline'),
    ('site.logo_url',        to_jsonb('/logo.svg'::text),            'url',     'Site logo (http(s) URL or site path)'),
    ('seo.default_title',    to_jsonb('Football â€” News, Scores, Transfers'::text), 'string', 'Fallback meta title'),
    ('seo.default_description', to_jsonb('Latest football news and scores.'::text), 'string', 'Fallback meta description'),
    ('news.page_size',       to_jsonb(20),                           'number',  'News list page size'),
    ('football.data_refresh_minutes', to_jsonb(15),                  'number',  'Data freshness target in minutes'),
    ('social.twitter',       to_jsonb('https://twitter.com'::text),  'url',     'Official X/Twitter URL'),
    ('social.facebook',      to_jsonb('https://facebook.com'::text), 'url',     'Official Facebook URL'),
    ('contact.email',        to_jsonb('info@example.com'::text),     'string',  'Public contact email'),
    ('features.breaking_news', to_jsonb(true),                       'boolean', 'Breaking-news module enabled'),
    ('features.live_scores',   to_jsonb(false),                      'boolean', 'Live-scores module enabled')
ON CONFLICT (key) DO NOTHING;


-- ============================================================================
-- >>> 027_admin_identity_permissions.sql
-- ============================================================================
-- ============================================================================
-- 027_admin_identity_permissions.sql
-- Admin identity read split (STEP 13)
--
-- Context: 025 seeded users.manage / roles.read / roles.manage but no
-- read-only keys for users or the permission catalogue. This migration adds
-- exactly two keys (no tables, no columns, no data changes):
--   users.read        View admin users (GETs)
--   permissions.read  View permission catalogue (GET /permissions)
-- Writes stay on users.manage / roles.manage. The permission catalogue
-- itself is immutable (no POST/DELETE /permissions); grant changes go
-- through roles.manage (PUT /roles/:id/permissions).
-- All INSERTs are ON CONFLICT DO NOTHING (safe to re-run).
--
-- Reversibility (ROLLBACK, manual):
--   DELETE FROM public.admin_role_permissions WHERE permission_id IN
--     (SELECT id FROM public.admin_permissions WHERE key IN ('users.read','permissions.read'));
--   DELETE FROM public.admin_permissions WHERE key IN ('users.read','permissions.read');
-- ============================================================================

INSERT INTO public.admin_permissions (key, resource, action, description) VALUES
    ('users.read',       'users',       'read', 'View admin users'),
    ('permissions.read', 'permissions', 'read', 'View permission catalogue')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.admin_permissions p
WHERE r.name IN ('super_admin', 'admin')
  AND p.key IN ('users.read', 'permissions.read')
ON CONFLICT DO NOTHING;


-- ============================================================================
-- >>> 028_index_optimizations.sql
-- ============================================================================
-- ============================================================================
-- 028_index_optimizations.sql
-- Production Database Index Optimizations
--
-- Based on audit of repository query patterns across:
--   standings.repo.ts, team-stats.repo.ts, news.repo.ts, search.service.ts,
--   search.repo.ts, matches.repo.ts, transfers.repo.ts, players.repo.ts,
--   teams.repo.ts, competitions.repo.ts, related.ts
--
-- Only adds missing indexes. No duplicates, no table rewrites, no data deletion.
-- ============================================================================

-- ============================================================================
-- 1. SEASONS
-- ============================================================================
-- Query pattern: standings.repo.ts loadSeason() - WHERE competition_id = ? AND is_current = true
-- Existing: idx_seasons_competition_id, idx_seasons_is_current
-- Missing: composite for the combined filter
CREATE INDEX IF NOT EXISTS idx_seasons_competition_id_is_current
    ON public.seasons (competition_id, is_current);

-- ============================================================================
-- 2. PLAYERS
-- ============================================================================
-- Query pattern: players.repo.ts listPlayers() - WHERE position = ?
-- Existing: idx_players_nationality_id, idx_players_status, pg_trgm indexes on names
-- Missing: position filter
CREATE INDEX IF NOT EXISTS idx_players_position
    ON public.players (position);

-- ============================================================================
-- 3. TRANSFERS
-- ============================================================================
-- Query pattern: transfers.repo.ts listTransfers() - WHERE status IN (...) ORDER BY effective_date
-- Existing: idx_transfers_status, idx_transfers_effective_date, idx_transfers_season_status
-- Missing: composite for status filter + effective_date ordering
CREATE INDEX IF NOT EXISTS idx_transfers_status_effective_date
    ON public.transfers (status, effective_date);

-- ============================================================================
-- 4. MATCHES
-- ============================================================================
-- Query pattern: standings.repo.ts getCompetitionStandings() - WHERE competition_id = ? AND season_id = ? ORDER BY scheduled_at
-- Existing: idx_matches_competition_sched (competition_id, scheduled_at), idx_matches_season_id, idx_matches_status_sched
-- Missing: composite for season filter + scheduled_at ordering (used with season_id filter)
CREATE INDEX IF NOT EXISTS idx_matches_season_id_scheduled_at
    ON public.matches (season_id, scheduled_at);

-- Also useful for team-stats.repo.ts with season filter
-- and matches.repo.ts listMatches() with season + ordering

-- ============================================================================
-- 5. PLAYER_TEAM_HISTORY
-- ============================================================================
-- Query pattern: search.service.ts + players.repo.ts - WHERE player_id = ? AND is_current = true
-- Existing: idx_pth_player_id, idx_pth_team_id, idx_pth_season_id, idx_pth_is_current
-- Missing: composite for current team lookup by player
CREATE INDEX IF NOT EXISTS idx_pth_player_id_is_current
    ON public.player_team_history (player_id, is_current);

-- Query pattern: teams.repo.ts getTeamDetails() - WHERE team_id = ? AND is_current = true (for squad)
-- Missing: composite for current player lookup by team
CREATE INDEX IF NOT EXISTS idx_pth_team_id_is_current
    ON public.player_team_history (team_id, is_current);

-- ============================================================================
-- 6. ADDITIONAL COMPOSITE FOR SEASONS
-- ============================================================================
-- Query pattern: standings.repo.ts - competition_id + is_current already covered above
-- But also: competition_id + start_date for season ordering in competition details
-- Existing: idx_seasons_competition_id
CREATE INDEX IF NOT EXISTS idx_seasons_competition_id_start_date
    ON public.seasons (competition_id, start_date DESC);

-- ============================================================================
-- 7. MATCHES - COMPETITION + SEASON + SCHEDULED_AT
-- ============================================================================
-- Query pattern: standings.repo.ts - WHERE competition_id = ? AND season_id = ? ORDER BY scheduled_at
-- The idx_matches_competition_sched covers competition + scheduled_at
-- The idx_matches_season_id_scheduled_at covers season + scheduled_at
-- For the combination of all three, Postgres can use bitmap index scan
-- No additional index needed - existing + new composites cover it.

-- ============================================================================
-- 8. ARTICLES - CATEGORY/TAG/ENTITY RELATIONS
-- ============================================================================
-- Query pattern: news.repo.ts listNews() - article_teams.team_id, article_players.player_id, etc.
-- Existing: idx_article_teams_team_id, idx_article_players_player_id, idx_article_competitions_comp_id, idx_article_matches_match_id
-- All relation table indexes exist. No missing indexes needed.

-- ============================================================================
-- VERIFICATION NOTES
-- ============================================================================
-- All indexes use CREATE INDEX IF NOT EXISTS - safe to re-run
-- No table rewrites, no data deletion, no destructive changes
-- Index order follows actual query predicates (equality first, then range/order)
-- No duplicates of existing indexes


-- ============================================================================
-- >>> 030_standings_team_stats_rpc.sql
-- ============================================================================
-- ============================================================================
-- 030_standings_team_stats_rpc.sql
-- PostgreSQL RPC Functions for Standings & Team Statistics Aggregation
--
-- These functions perform the full aggregation in PostgreSQL, returning
-- pre-aggregated data that matches the exact JavaScript calculation output.
-- Cache keys remain unchanged (competition+season / team+season).
-- ============================================================================

-- ============================================================================
-- 1. STANDINGS AGGREGATION FUNCTION
-- ============================================================================
-- Replaces: standings.repo.ts getCompetitionStandings() JS aggregation
-- Returns: JSONB with aggregated team stats ready for calculateStandings()
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_standings_aggregated(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_standings_aggregated(
    p_competition_id uuid,
    p_season_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    -- Aggregate team stats for the competition/season
    RETURN (
        SELECT jsonb_build_object(
            'teams', COALESCE(jsonb_agg(team_stats ORDER BY team_stats.team_name), '[]'::jsonb),
            'matches_considered', COALESCE(SUM(team_stats.played) / 2, 0)::int,
            'matches_skipped', (
                SELECT COUNT(*)::int
                FROM public.matches
                WHERE competition_id = p_competition_id
                  AND status = 'finished'
                  AND (p_season_id IS NULL OR season_id = p_season_id)
                  AND (home_score IS NULL OR away_score IS NULL)
            ),
            'total_finished', (
                SELECT COUNT(*)::int
                FROM public.matches
                WHERE competition_id = p_competition_id
                  AND status = 'finished'
                  AND (p_season_id IS NULL OR season_id = p_season_id)
            ),
            'total_matches', (
                SELECT COUNT(*)::int
                FROM public.matches
                WHERE competition_id = p_competition_id
                  AND (p_season_id IS NULL OR season_id = p_season_id)
            )
        )
        FROM (
            SELECT
                t.id AS team_id,
                t.name AS team_name,
                t.short_name,
                t.slug,
                t.logo_url,
                COUNT(m.id)::int AS played,
                SUM(CASE WHEN (m.home_team_id = t.id AND m.home_score > m.away_score)
                      OR (m.away_team_id = t.id AND m.away_score > m.home_score) THEN 1 ELSE 0 END)::int AS won,
                SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END)::int AS drawn,
                SUM(CASE WHEN (m.home_team_id = t.id AND m.home_score < m.away_score)
                      OR (m.away_team_id = t.id AND m.away_score < m.home_score) THEN 1 ELSE 0 END)::int AS lost,
                SUM(CASE WHEN t.id = m.home_team_id THEN m.home_score ELSE m.away_score END)::int AS goals_for,
                SUM(CASE WHEN t.id = m.home_team_id THEN m.away_score ELSE m.home_score END)::int AS goals_against,
                SUM(CASE
                    WHEN (t.id = m.home_team_id AND m.home_score > m.away_score)
                      OR (t.id = m.away_team_id AND m.away_score > m.home_score) THEN 3
                    WHEN m.home_score = m.away_score THEN 1
                    ELSE 0
                END)::int AS points
            FROM public.matches m
            JOIN public.teams t ON t.id = m.home_team_id OR t.id = m.away_team_id
            WHERE m.competition_id = p_competition_id
              AND m.status = 'finished'
              AND m.home_score IS NOT NULL
              AND m.away_score IS NOT NULL
              AND (p_season_id IS NULL OR m.season_id = p_season_id)
            GROUP BY t.id, t.name, t.short_name, t.slug, t.logo_url
        ) team_stats);
END;
$$;

-- ============================================================================
-- 2. STANDINGS HEAD-TO-HEAD DATA FUNCTION
-- ============================================================================
-- Returns a FLAT map keyed by team id:
--     { "<team uuid>": { "points": <int>, "gd": <int> }, ... }
--
-- Contract with standings.repo.ts loadHeadToHead(): it reads the top-level keys
-- as team ids. The previous shape keyed the outer object by a
-- "<home>_<away>" pair string and nested the teams one level deeper, which the
-- caller could not read, so head-to-head silently contributed nothing.
--
-- Points and goal difference are accumulated per team across every settled
-- meeting, in either venue orientation. Grouping by the home/away pair (as the
-- previous version did) lost one leg whenever the same two teams met at both
-- venues, because each orientation produced a separate row under the same
-- normalised key and jsonb_object_agg kept only the last.
--
-- Only meetings where BOTH sides are participants are counted, matching
-- buildHeadToHead() in backend/src/lib/standings.ts.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_standings_h2h(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_standings_h2h(
    p_competition_id uuid,
    p_season_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    WITH participants AS (
        -- Registered sides, plus any side that appears in a settled match but
        -- was never added to team_competitions. Mirrors the `teamIds` set the
        -- TypeScript calculator ranks over.
        SELECT tc.team_id
        FROM public.team_competitions tc
        WHERE tc.competition_id = p_competition_id
          AND (p_season_id IS NULL OR tc.season_id = p_season_id)
        UNION
        SELECT m.home_team_id
        FROM public.matches m
        WHERE m.competition_id = p_competition_id
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND (p_season_id IS NULL OR m.season_id = p_season_id)
        UNION
        SELECT m.away_team_id
        FROM public.matches m
        WHERE m.competition_id = p_competition_id
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND (p_season_id IS NULL OR m.season_id = p_season_id)
    ),
    settled AS (
        SELECT m.home_team_id, m.away_team_id, m.home_score, m.away_score
        FROM public.matches m
        JOIN participants hp ON hp.team_id = m.home_team_id
        JOIN participants ap ON ap.team_id = m.away_team_id
        WHERE m.competition_id = p_competition_id
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND (p_season_id IS NULL OR m.season_id = p_season_id)
    ),
    -- One row per team, so a side that was home in some meetings and away in
    -- others is summed once rather than emitted as two rows.
    per_team AS (
        SELECT team_id,
               SUM(points)::int AS points,
               SUM(gd)::int     AS gd
        FROM (
            SELECT home_team_id AS team_id,
                   CASE WHEN home_score > away_score THEN 3
                        WHEN home_score = away_score THEN 1
                        ELSE 0 END AS points,
                   (home_score - away_score) AS gd
            FROM settled
            UNION ALL
            SELECT away_team_id AS team_id,
                   CASE WHEN away_score > home_score THEN 3
                        WHEN home_score = away_score THEN 1
                        ELSE 0 END AS points,
                   (away_score - home_score) AS gd
            FROM settled
        ) perspective
        GROUP BY team_id
    )
    SELECT COALESCE(
        jsonb_object_agg(
            per_team.team_id::text,
            jsonb_build_object('points', per_team.points, 'gd', per_team.gd)
        ),
        '{}'::jsonb
    )
    FROM per_team;
$$;

-- ============================================================================
-- 3. TEAM STATISTICS AGGREGATION FUNCTION
-- ============================================================================
-- Replaces: team-stats.repo.ts getTeamStatistics() JS aggregation
-- Returns: Complete team statistics payload
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_team_statistics(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_team_statistics(
    p_team_id uuid,
    p_season_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_totals jsonb;
    v_form jsonb;
    v_skipped int;
    v_played int;
BEGIN
    -- Get aggregated totals
    SELECT jsonb_build_object(
        'played', COALESCE(t.played, 0),
        'won', COALESCE(t.won, 0),
        'drawn', COALESCE(t.drawn, 0),
        'lost', COALESCE(t.lost, 0),
        'goals_for', COALESCE(t.goals_for, 0),
        'goals_against', COALESCE(t.goals_against, 0),
        'goal_difference', COALESCE(t.goals_for, 0) - COALESCE(t.goals_against, 0),
        'clean_sheets', COALESCE(t.clean_sheets, 0)
    ) INTO v_totals
    FROM (
        SELECT
            COUNT(*)::int AS played,
            SUM(CASE WHEN (m.home_team_id = p_team_id AND m.home_score > m.away_score)
                  OR (m.away_team_id = p_team_id AND m.away_score > m.home_score) THEN 1 ELSE 0 END)::int AS won,
            SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END)::int AS drawn,
            SUM(CASE WHEN (m.home_team_id = p_team_id AND m.home_score < m.away_score)
                  OR (m.away_team_id = p_team_id AND m.away_score < m.home_score) THEN 1 ELSE 0 END)::int AS lost,
            SUM(CASE WHEN p_team_id = m.home_team_id THEN m.home_score ELSE m.away_score END)::int AS goals_for,
            SUM(CASE WHEN p_team_id = m.home_team_id THEN m.away_score ELSE m.home_score END)::int AS goals_against,
            SUM(CASE WHEN (p_team_id = m.home_team_id AND m.away_score = 0)
                  OR (p_team_id = m.away_team_id AND m.home_score = 0) THEN 1 ELSE 0 END)::int AS clean_sheets
        FROM public.matches m
        WHERE (m.home_team_id = p_team_id OR m.away_team_id = p_team_id)
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND (p_season_id IS NULL OR m.season_id = p_season_id)
    ) t;

    -- Get form (last 5 matches, newest first)
    SELECT jsonb_agg(f ORDER BY f.scheduled_at DESC) INTO v_form
    FROM (
        SELECT
            m.id,
            m.home_team_id,
            m.away_team_id,
            m.home_score,
            m.away_score,
            m.scheduled_at
        FROM public.matches m
        WHERE (m.home_team_id = p_team_id OR m.away_team_id = p_team_id)
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND (p_season_id IS NULL OR m.season_id = p_season_id)
        ORDER BY m.scheduled_at DESC
        LIMIT 5
    ) f;

    -- Count skipped matches (finished but missing scores)
    SELECT COUNT(*)::int INTO v_skipped
    FROM public.matches
    WHERE (home_team_id = p_team_id OR away_team_id = p_team_id)
      AND status = 'finished'
      AND (home_score IS NULL OR away_score IS NULL)
      AND (p_season_id IS NULL OR season_id = p_season_id);

    SELECT COALESCE((SELECT played FROM (
        SELECT COUNT(*)::int AS played
        FROM public.matches m
        WHERE (m.home_team_id = p_team_id OR m.away_team_id = p_team_id)
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND (p_season_id IS NULL OR m.season_id = p_season_id)
    ) t), 0) INTO v_played;

    RETURN jsonb_build_object(
        'totals', v_totals,
        'form', COALESCE(v_form, '[]'::jsonb),
        'matches_considered', v_played,
        'matches_skipped', v_skipped,
        'state', CASE
            WHEN v_played = 0 THEN 'empty'
            WHEN v_skipped > 0 THEN 'incomplete'
            ELSE 'ready'
        END
    );
END;
$$;

-- ============================================================================
-- 4. GRANT EXECUTE PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_standings_aggregated(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_standings_h2h(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_statistics(uuid, uuid) TO anon, authenticated;


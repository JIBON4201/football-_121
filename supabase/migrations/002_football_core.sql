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

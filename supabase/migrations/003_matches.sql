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

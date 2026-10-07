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

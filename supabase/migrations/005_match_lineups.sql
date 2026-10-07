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

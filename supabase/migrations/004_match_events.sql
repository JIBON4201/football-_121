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

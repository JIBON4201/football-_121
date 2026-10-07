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

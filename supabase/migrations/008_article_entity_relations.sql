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

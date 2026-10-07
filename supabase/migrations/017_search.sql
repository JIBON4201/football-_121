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

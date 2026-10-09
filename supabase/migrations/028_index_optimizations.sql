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
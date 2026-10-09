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
DECLARE
    v_result jsonb;
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
        ) team_stats;
END;
$$;

-- ============================================================================
-- 2. STANDINGS HEAD-TO-HEAD DATA FUNCTION
-- ============================================================================
-- Returns head-to-head data for tiebreaker calculations
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
    SELECT jsonb_object_agg(h2h_key, h2h_value)
    FROM (
        SELECT
            CONCAT(LEAST(m.home_team_id, m.away_team_id), '_', GREATEST(m.home_team_id, m.away_team_id)) AS h2h_key,
            jsonb_build_object(
                m.home_team_id::text, jsonb_build_object(
                    'points', SUM(CASE
                        WHEN m.home_team_id = m.home_team_id AND m.home_score > m.away_score THEN 3
                        WHEN m.home_score = m.away_score THEN 1
                        ELSE 0
                    END)::int,
                    'gd', SUM(m.home_score - m.away_score)::int
                ),
                m.away_team_id::text, jsonb_build_object(
                    'points', SUM(CASE
                        WHEN m.away_team_id = m.away_team_id AND m.away_score > m.home_score THEN 3
                        WHEN m.home_score = m.away_score THEN 1
                        ELSE 0
                    END)::int,
                    'gd', SUM(m.away_score - m.home_score)::int
                )
            ) AS h2h_value
        FROM public.matches m
        WHERE m.competition_id = $1
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND ($2 IS NULL OR m.season_id = $2)
        GROUP BY m.home_team_id, m.away_team_id
    ) sub;
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
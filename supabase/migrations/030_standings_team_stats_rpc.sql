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
        ) team_stats);
END;
$$;

-- ============================================================================
-- 2. STANDINGS HEAD-TO-HEAD DATA FUNCTION
-- ============================================================================
-- Returns a FLAT map keyed by team id:
--     { "<team uuid>": { "points": <int>, "gd": <int> }, ... }
--
-- Contract with standings.repo.ts loadHeadToHead(): it reads the top-level keys
-- as team ids. The previous shape keyed the outer object by a
-- "<home>_<away>" pair string and nested the teams one level deeper, which the
-- caller could not read, so head-to-head silently contributed nothing.
--
-- Points and goal difference are accumulated per team across every settled
-- meeting, in either venue orientation. Grouping by the home/away pair (as the
-- previous version did) lost one leg whenever the same two teams met at both
-- venues, because each orientation produced a separate row under the same
-- normalised key and jsonb_object_agg kept only the last.
--
-- Only meetings where BOTH sides are participants are counted, matching
-- buildHeadToHead() in backend/src/lib/standings.ts.
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
    WITH participants AS (
        -- Registered sides, plus any side that appears in a settled match but
        -- was never added to team_competitions. Mirrors the `teamIds` set the
        -- TypeScript calculator ranks over.
        SELECT tc.team_id
        FROM public.team_competitions tc
        WHERE tc.competition_id = p_competition_id
          AND (p_season_id IS NULL OR tc.season_id = p_season_id)
        UNION
        SELECT m.home_team_id
        FROM public.matches m
        WHERE m.competition_id = p_competition_id
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND (p_season_id IS NULL OR m.season_id = p_season_id)
        UNION
        SELECT m.away_team_id
        FROM public.matches m
        WHERE m.competition_id = p_competition_id
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND (p_season_id IS NULL OR m.season_id = p_season_id)
    ),
    settled AS (
        SELECT m.home_team_id, m.away_team_id, m.home_score, m.away_score
        FROM public.matches m
        JOIN participants hp ON hp.team_id = m.home_team_id
        JOIN participants ap ON ap.team_id = m.away_team_id
        WHERE m.competition_id = p_competition_id
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
          AND (p_season_id IS NULL OR m.season_id = p_season_id)
    ),
    -- One row per team, so a side that was home in some meetings and away in
    -- others is summed once rather than emitted as two rows.
    per_team AS (
        SELECT team_id,
               SUM(points)::int AS points,
               SUM(gd)::int     AS gd
        FROM (
            SELECT home_team_id AS team_id,
                   CASE WHEN home_score > away_score THEN 3
                        WHEN home_score = away_score THEN 1
                        ELSE 0 END AS points,
                   (home_score - away_score) AS gd
            FROM settled
            UNION ALL
            SELECT away_team_id AS team_id,
                   CASE WHEN away_score > home_score THEN 3
                        WHEN home_score = away_score THEN 1
                        ELSE 0 END AS points,
                   (away_score - home_score) AS gd
            FROM settled
        ) perspective
        GROUP BY team_id
    )
    SELECT COALESCE(
        jsonb_object_agg(
            per_team.team_id::text,
            jsonb_build_object('points', per_team.points, 'gd', per_team.gd)
        ),
        '{}'::jsonb
    )
    FROM per_team;
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
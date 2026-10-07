-- ---------------------------------------------------------------------------
-- 024_step40_verification_fixes.sql
--
-- Corrective, forward-only migration. Safe to run more than once: it contains
-- only CREATE OR REPLACE FUNCTION and REVOKE/GRANT, all of which are idempotent.
-- It creates, alters and drops nothing.
--
-- Migration 023 is already applied in production and cannot be re-run as a
-- whole (CREATE TYPE and CREATE TRIGGER have no IF NOT EXISTS in PostgreSQL).
-- This migration therefore re-publishes only the three Step 40 diagnostics with
-- the defects below corrected.
--
-- 1. verify_schema_health()
--    023 selected jsonb_agg(name ORDER BY name) FROM pg_extension. pg_extension
--    has no "name" column, so every call failed with:
--        ERROR 42703 column "name" does not exist
--    Corrected to extname, the actual column.
--
-- 2. verify_canonical_data()
--    The external_id_fanout and entity_multi_mapping sub-queries selected
--    data_source_id / entity_type / external_id / entity_id without aliases,
--    but the enclosing jsonb_build_object referenced them as n.ds, n.et, n.ext
--    and n.eid. Every call failed with:
--        ERROR 42703 column n.ds does not exist
--    The inner projections now alias the columns they are addressed by.
--
-- Both defects were invisible at deploy time: PostgreSQL does not validate
-- plpgsql bodies at CREATE FUNCTION, so 023 applied cleanly and failed only on
-- first call. That is why these are fixed by re-publishing the functions rather
-- than by editing 023 alone.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_schema_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    payload jsonb;
BEGIN
    SELECT jsonb_build_object(
        'extensions', COALESCE((
            SELECT jsonb_agg(extname ORDER BY extname)
            FROM pg_extension
            WHERE extname IN ('citext', 'pg_trgm', 'pgcrypto')
        ), '[]'::jsonb),

        'enums', COALESCE((
            SELECT jsonb_agg(t.typname ORDER BY t.typname)
            FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public'
              AND t.typtype = 'e'
        ), '[]'::jsonb),

        'tables', COALESCE((
            SELECT jsonb_agg(c.relname ORDER BY c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
        ), '[]'::jsonb),

        'indexes', COALESCE((
            SELECT jsonb_agg(c.relname ORDER BY c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'i'
        ), '[]'::jsonb),

        'functions', COALESCE((
            SELECT jsonb_agg(p.proname ORDER BY p.proname)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
        ), '[]'::jsonb),

        'triggers', COALESCE((
            SELECT jsonb_agg(t.tgname ORDER BY t.tgname)
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND NOT t.tgisinternal
        ), '[]'::jsonb),

        -- Tables where RLS is enabled but no policy exists: silently wide open
        -- for a role that bypasses nothing, or accidentally locked shut.
        'tables_without_rls', COALESCE((
            SELECT jsonb_agg(c.relname ORDER BY c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND NOT c.relrowsecurity
        ), '[]'::jsonb),

        'policy_count', (
            SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
        ),

        'table_row_counts', COALESCE((
            SELECT jsonb_object_agg(u.table_name, u.row_count)
            FROM (
                SELECT 'teams' AS table_name, count(*)::bigint AS row_count FROM public.teams
                UNION ALL SELECT 'players', count(*)::bigint FROM public.players
                UNION ALL SELECT 'competitions', count(*)::bigint FROM public.competitions
                UNION ALL SELECT 'seasons', count(*)::bigint FROM public.seasons
                UNION ALL SELECT 'countries', count(*)::bigint FROM public.countries
                UNION ALL SELECT 'venues', count(*)::bigint FROM public.venues
                UNION ALL SELECT 'matches', count(*)::bigint FROM public.matches
                UNION ALL SELECT 'match_events', count(*)::bigint FROM public.match_events
                UNION ALL SELECT 'articles', count(*)::bigint FROM public.articles
                UNION ALL SELECT 'transfers', count(*)::bigint FROM public.transfers
                UNION ALL SELECT 'external_entity_ids', count(*)::bigint FROM public.external_entity_ids
                UNION ALL SELECT 'sync_jobs', count(*)::bigint FROM public.sync_jobs
                UNION ALL SELECT 'data_sources', count(*)::bigint FROM public.data_sources
            ) u
        ), '{}'::jsonb)
    )
    INTO payload;

    RETURN payload;
END;
$$;

CREATE OR REPLACE FUNCTION public._step40_norm_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT btrim(regexp_replace(
        -- Lowercase, fold diacritics, drop common club-name tokens (whole words
        -- only), then strip everything non-alphanumeric.
        regexp_replace(
            translate(
                lower(coalesce(input, '')),
                'áàâäãåéèêëíìîïóòôöõúùûüñçýÿšžđčć',
                'aaaaaaeeeeiiiiooooouuuuncyyszdcc'
            ),
            '\m(fc|cf|afc|sc|ac|as|ss|ssc|us|ud|cd|sd|bc|if|sv|vfl|vfb|tsg|fk|sk)\M',
            ' ', 'g'),
        '[^a-z0-9]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.verify_canonical_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    payload jsonb;
BEGIN
    SELECT jsonb_build_object(
        -- Duplicate canonical teams / competitions: same normalized name.
        'duplicate_teams', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'normalized_name', n.nm,
                'count', n.cnt,
                'ids', n.ids,
                'names', n.names
            ))
            FROM (
                SELECT public._step40_norm_name(name) AS nm,
                       count(*)::int AS cnt,
                       jsonb_agg(id) AS ids,
                       jsonb_agg(name) AS names
                FROM public.teams
                WHERE name IS NOT NULL
                GROUP BY 1
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        'duplicate_competitions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'normalized_name', n.nm, 'count', n.cnt, 'ids', n.ids, 'names', n.names
            ))
            FROM (
                SELECT public._step40_norm_name(name) AS nm,
                       count(*)::int AS cnt, jsonb_agg(id) AS ids, jsonb_agg(name) AS names
                FROM public.competitions
                WHERE name IS NOT NULL
                GROUP BY 1
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- Players: normalized display name is only a *candidate* duplicate when
        -- two players also share a birth date. Different people legitimately
        -- share a name; this avoids flagging them.
        'duplicate_players', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'normalized_name', n.nm, 'date_of_birth', n.dob,
                'count', n.cnt, 'ids', n.ids, 'names', n.names
            ))
            FROM (
                SELECT public._step40_norm_name(display_name) AS nm,
                       date_of_birth AS dob,
                       count(*)::int AS cnt,
                       jsonb_agg(id) AS ids,
                       jsonb_agg(display_name) AS names
                FROM public.players
                WHERE display_name IS NOT NULL
                GROUP BY 1, 2
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- Duplicate matches: same kickoff and same home team. Away side is
        -- included in the grouping so reversed fixtures are not flagged.
        'duplicate_matches', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'kickoff_at', n.scheduled_at, 'home_team_id', n.home_team_id,
                'away_team_id', n.away_team_id, 'count', n.cnt, 'ids', n.ids
            ))
            FROM (
                SELECT scheduled_at, home_team_id, away_team_id,
                       count(*)::int AS cnt, jsonb_agg(id) AS ids
                FROM public.matches
                GROUP BY 1, 2, 3
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- One external record resolving to more than one canonical entity is
        -- an entity-resolution defect even though the unique constraint allows it.
        'external_id_fanout', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'data_source_id', n.ds, 'entity_type', n.et,
                'external_id', n.ext, 'entity_count', n.cnt, 'entity_ids', n.ids
            ))
            FROM (
                SELECT data_source_id AS ds, entity_type AS et, external_id AS ext,
                       count(DISTINCT entity_id)::int AS cnt,
                       jsonb_agg(DISTINCT entity_id) AS ids
                FROM public.external_entity_ids
                GROUP BY 1, 2, 3
                HAVING count(DISTINCT entity_id) > 1
            ) n
        ), '[]'::jsonb),

        -- One canonical entity mapped to several external ids for one source.
        'entity_multi_mapping', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'data_source_id', n.ds, 'entity_type', n.et,
                'entity_id', n.eid, 'external_ids', n.exts
            ))
            FROM (
                SELECT data_source_id AS ds, entity_type AS et, entity_id AS eid,
                       count(*)::int AS cnt, jsonb_agg(external_id) AS exts
                FROM public.external_entity_ids
                GROUP BY 1, 2, 3
                HAVING count(*) > 1
            ) n
        ), '[]'::jsonb),

        -- Broken relationships (orphan FK targets).
        'broken_relationships', jsonb_build_object(
            'match_home_team', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.home_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = m.home_team_id)
            ),
            'match_away_team', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.away_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = m.away_team_id)
            ),
            'match_competition', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.competition_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.competitions c WHERE c.id = m.competition_id)
            ),
            'match_season', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.season_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = m.season_id)
            ),
            'match_venue', (
                SELECT count(*)::int FROM public.matches m
                WHERE m.venue_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = m.venue_id)
            ),
            'transfer_player', (
                SELECT count(*)::int FROM public.transfers tr
                WHERE tr.player_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = tr.player_id)
            ),
            'transfer_from_team', (
                SELECT count(*)::int FROM public.transfers tr
                WHERE tr.from_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = tr.from_team_id)
            ),
            'transfer_to_team', (
                SELECT count(*)::int FROM public.transfers tr
                WHERE tr.to_team_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = tr.to_team_id)
            ),
            'match_events_orphan_match', (
                SELECT count(*)::int FROM public.match_events e
                WHERE NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = e.match_id)
            ),
            'external_ids_orphan_source', (
                SELECT count(*)::int FROM public.external_entity_ids x
                WHERE NOT EXISTS (SELECT 1 FROM public.data_sources d WHERE d.id = x.data_source_id)
            )
        ),

        -- Data freshness: signals that stale content is being served as current.
        'freshness', jsonb_build_object(
            'live_matches', (
                SELECT count(*)::int FROM public.matches
                WHERE status IN ('live', 'half_time', 'extra_time', 'penalty_shootout')
            ),
            'live_matches_stale', (
                -- Live now but untouched for over 15 minutes: the sync worker is
                -- not refreshing, so the score is being presented as current.
                SELECT count(*)::int FROM public.matches
                WHERE status IN ('live', 'half_time', 'extra_time', 'penalty_shootout')
                  AND updated_at < now() - interval '15 minutes'
            ),
            'finished_without_score', (
                SELECT count(*)::int FROM public.matches
                WHERE status = 'finished'
                  AND (home_score IS NULL OR away_score IS NULL)
            ),
            'finished_future_kickoff', (
                SELECT count(*)::int FROM public.matches
                WHERE status = 'finished' AND scheduled_at > now()
            ),
            'scheduled_past_kickoff', (
                -- Still "scheduled" well after kickoff: missed by the scheduler.
                SELECT count(*)::int FROM public.matches
                WHERE status IN ('scheduled', 'pre_match')
                  AND scheduled_at < now() - interval '3 hours'
            ),
            'latest_live_update', (
                SELECT max(updated_at)::text FROM public.matches
                WHERE status IN ('live', 'half_time', 'extra_time', 'penalty_shootout')
            ),
            'latest_article_published', (
                SELECT max(published_at)::text FROM public.articles WHERE status = 'published'
            ),
            'latest_transfer_at', (
                SELECT max(created_at)::text FROM public.transfers
            ),
            'failed_sync_jobs', (
                SELECT count(*)::int FROM public.sync_jobs WHERE status = 'failed'
            ),
            'stuck_running_sync_jobs', (
                -- 'running' but not progressed: a worker died mid-claim. The
                -- queue models liveness with lease_expires_at (019_sync_queue.sql);
                -- sync_jobs has no updated_at column.
                SELECT count(*)::int FROM public.sync_jobs
                WHERE status = 'running'
                  AND lease_expires_at IS NOT NULL
                  AND lease_expires_at < now() - interval '30 minutes'
            )
        )
    )
    INTO payload;

    RETURN payload;
END;
$$;

-- ---------------------------------------------------------------------------
-- Restrict both diagnostics to service_role. The public site never needs them.
-- Re-issued here so the privilege posture travels with the corrected bodies.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.verify_schema_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_canonical_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._step40_norm_name(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.verify_schema_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_canonical_data() TO service_role;
GRANT EXECUTE ON FUNCTION public._step40_norm_name(text) TO service_role;

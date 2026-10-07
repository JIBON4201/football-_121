-- ============================================================================
-- 018_seed_provider.sql
-- Register the bundled deterministic seed provider (lowest precedence).
-- No football data is inserted here; rows arrive through the import pipeline.
-- ============================================================================

INSERT INTO public.data_sources (name, provider, api_version, is_active, priority)
VALUES ('Seed Provider', 'seed', 'v1', true, 1000)
ON CONFLICT (name) DO NOTHING;

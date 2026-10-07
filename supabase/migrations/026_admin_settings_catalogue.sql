-- ============================================================================
-- 026_admin_settings_catalogue.sql
-- Admin Site Settings catalogue (STEP 12)
--
-- Context: public.system_settings exists (015, admin-only RLS) but nothing
-- reads it yet — there is deliberately NO public consumer to rewire, so this
-- migration changes no public behavior. It seeds the minimal catalogue the
-- Admin Settings API manages. Infrastructure secrets (DB/Supabase/API keys)
-- must NEVER be stored here; they stay in environment/server config
-- (see backend/src/providers/config.ts).
--
-- Contents:
--   1. settings.read permission (025 shipped only settings.manage) + grants
--      to super_admin/admin (editor/moderator intentionally excluded).
--   2. Curated catalogue rows (INSERT ... ON CONFLICT DO NOTHING — no data
--      overwritten, safe to re-run).
--
-- Reversibility (ROLLBACK, manual):
--   DELETE FROM public.admin_role_permissions WHERE permission_id IN
--     (SELECT id FROM public.admin_permissions WHERE key = 'settings.read');
--   DELETE FROM public.admin_permissions WHERE key = 'settings.read';
--   DELETE FROM public.system_settings WHERE key IN (<catalogue keys below>);
-- ============================================================================

-- ============================================================================
-- 1. settings.read permission (read/manage split per Admin API contract)
-- ============================================================================

INSERT INTO public.admin_permissions (key, resource, action, description) VALUES
    ('settings.read', 'settings', 'read', 'View site settings')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.admin_permissions p
WHERE r.name IN ('super_admin', 'admin')
  AND p.key = 'settings.read'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. Catalogue (namespaced keys; category = first segment)
--   site.*      General / Website identity
--   seo.*       SEO defaults
--   news.*      News module
--   football.*  Football/Data module
--   social.*    Social links (URL)
--   contact.*   Contact (no secrets)
--   features.*  Feature flags (boolean)
-- ============================================================================

INSERT INTO public.system_settings (key, value, type, description) VALUES
    ('site.name',            to_jsonb('Football'::text),              'string',  'Public site name'),
    ('site.tagline',         to_jsonb('Global football coverage'::text), 'string', 'Public site tagline'),
    ('site.logo_url',        to_jsonb('/logo.svg'::text),            'url',     'Site logo (http(s) URL or site path)'),
    ('seo.default_title',    to_jsonb('Football — News, Scores, Transfers'::text), 'string', 'Fallback meta title'),
    ('seo.default_description', to_jsonb('Latest football news and scores.'::text), 'string', 'Fallback meta description'),
    ('news.page_size',       to_jsonb(20),                           'number',  'News list page size'),
    ('football.data_refresh_minutes', to_jsonb(15),                  'number',  'Data freshness target in minutes'),
    ('social.twitter',       to_jsonb('https://twitter.com'::text),  'url',     'Official X/Twitter URL'),
    ('social.facebook',      to_jsonb('https://facebook.com'::text), 'url',     'Official Facebook URL'),
    ('contact.email',        to_jsonb('info@example.com'::text),     'string',  'Public contact email'),
    ('features.breaking_news', to_jsonb(true),                       'boolean', 'Breaking-news module enabled'),
    ('features.live_scores',   to_jsonb(false),                      'boolean', 'Live-scores module enabled')
ON CONFLICT (key) DO NOTHING;

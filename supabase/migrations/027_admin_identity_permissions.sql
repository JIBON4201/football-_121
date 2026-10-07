-- ============================================================================
-- 027_admin_identity_permissions.sql
-- Admin identity read split (STEP 13)
--
-- Context: 025 seeded users.manage / roles.read / roles.manage but no
-- read-only keys for users or the permission catalogue. This migration adds
-- exactly two keys (no tables, no columns, no data changes):
--   users.read        View admin users (GETs)
--   permissions.read  View permission catalogue (GET /permissions)
-- Writes stay on users.manage / roles.manage. The permission catalogue
-- itself is immutable (no POST/DELETE /permissions); grant changes go
-- through roles.manage (PUT /roles/:id/permissions).
-- All INSERTs are ON CONFLICT DO NOTHING (safe to re-run).
--
-- Reversibility (ROLLBACK, manual):
--   DELETE FROM public.admin_role_permissions WHERE permission_id IN
--     (SELECT id FROM public.admin_permissions WHERE key IN ('users.read','permissions.read'));
--   DELETE FROM public.admin_permissions WHERE key IN ('users.read','permissions.read');
-- ============================================================================

INSERT INTO public.admin_permissions (key, resource, action, description) VALUES
    ('users.read',       'users',       'read', 'View admin users'),
    ('permissions.read', 'permissions', 'read', 'View permission catalogue')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.admin_permissions p
WHERE r.name IN ('super_admin', 'admin')
  AND p.key IN ('users.read', 'permissions.read')
ON CONFLICT DO NOTHING;

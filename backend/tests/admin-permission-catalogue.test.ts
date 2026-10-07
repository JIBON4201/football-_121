import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Permission-catalogue consistency.
 *
 * Two defects shipped because nothing cross-checked the three places a
 * permission key can be named:
 *   1. the seed catalogue (supabase/migrations/025-027)
 *   2. the backend guard (`requirePermission('x.y')`)
 *   3. the Admin UI gate (`permissions.includes('x.y')`)
 *
 * `venues.create` / `venues.update` were checked by the UI but never seeded,
 * so the create and edit pages rendered AccessDenied forever. And
 * `competitions.delete` was required by the route but absent from the
 * catalogue, so the delete button could never succeed. Both were invisible to
 * every existing test because each layer was tested only against itself.
 *
 * These tests read the source of truth and assert the three agree.
 */

const BACKEND_ROOT = join(__dirname, '..', 'src');
const FRONTEND_ROOT = join(__dirname, '..', '..', 'frontend', 'src');
const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function readAll(files: string[]): string {
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

/** Permission keys seeded by migrations 025-027 (the catalogue of record). */
function seededKeys(): string[] {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /^02[567]_.*\.sql$/.test(f))
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');
  const keys = new Set<string>();
  // INSERT INTO public.admin_permissions (key, ...) VALUES ('a.b', ...), ...
  for (const m of files.matchAll(/\('([a-z_]+\.[a-z_]+)',\s*'[a-z_]+',\s*'[a-z_]+'/g)) keys.add(m[1]);
  return [...keys].sort();
}

/** Keys the backend guards with requirePermission(...). */
function requiredByBackend(): string[] {
  const files = walk(join(BACKEND_ROOT, 'routes'));
  const text = readAll(files);
  const keys = new Set<string>();
  for (const m of text.matchAll(/requirePermission\(\s*'([a-z_]+\.[a-z_]+)'/g)) keys.add(m[1]);
  for (const m of text.matchAll(/requirePermission\(\s*`([a-z_]+\.[a-z_]+)`/g)) keys.add(m[1]);
  return [...keys].sort();
}

/** Keys the Admin UI gates on. */
function requiredByFrontend(): string[] {
  const files = walk(join(FRONTEND_ROOT, 'app', 'control-center'));
  const text = readAll(files);
  const keys = new Set<string>();
  for (const m of text.matchAll(/permissions\.includes\(\s*'([a-z_]+\.[a-z_]+)'/g)) keys.add(m[1]);
  return [...keys].sort();
}

describe('permission catalogue consistency', () => {
  const catalogue = seededKeys();

  it('the seed catalogue is non-empty and well-formed', () => {
    expect(catalogue.length).toBeGreaterThanOrEqual(45);
    for (const key of catalogue) expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('every permission the backend requires is seeded', () => {
    const missing = requiredByBackend().filter((k) => !catalogue.includes(k));
    expect(missing).toEqual([]);
  });

  it('every permission the Admin UI checks is seeded', () => {
    const missing = requiredByFrontend().filter((k) => !catalogue.includes(k));
    expect(missing).toEqual([]);
  });

  it('the dev bypass grant set matches the catalogue exactly', async () => {
    const { ADMIN_BYPASS_PERMISSIONS } = await import('../src/admin/bypass');
    const bypass = [...ADMIN_BYPASS_PERMISSIONS];
    // A duplicate would mean the list drifted from a hand-edit.
    expect(new Set(bypass).size).toBe(bypass.length);
    const missing = catalogue.filter((k) => !bypass.includes(k));
    const extra = bypass.filter((k) => !catalogue.includes(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('the verifier requires the admin RBAC tables to exist', async () => {
    const { REQUIRED_TABLES } = await import('../src/verify/schemaCheck');
    // Without these the verifier reports PASS on a database that can never
    // authorize anyone — the exact failure that left the Admin API 403ing
    // every authenticated user while the checks stayed green.
    expect(REQUIRED_TABLES).toContain('admin_permissions');
    expect(REQUIRED_TABLES).toContain('admin_role_permissions');
  });
});

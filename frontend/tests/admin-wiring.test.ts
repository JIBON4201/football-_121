import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_ITEMS } from '@/lib/admin-navigation';

/**
 * Admin UI wiring regressions.
 *
 * Each test here pins a defect that shipped silently because the UI was only
 * ever checked against itself:
 *
 *  - `venues/new` and `venues/[id]/edit` gated on `venues.create` /
 *    `venues.update`, which do not exist in the permission catalogue (only
 *    `venues.manage` does). Both pages rendered AccessDenied permanently.
 *  - the venues list sent `country_id`, but the backend zod schema expects
 *    `countryId`, so the Country filter was silently dropped and always
 *    returned the unfiltered list.
 *  - the audit-log toolbar offered a free-text search, but the endpoint has no
 *    `q` parameter, so typing did nothing.
 *  - seasons and venues had full list/new/edit pages and CRUD actions but no
 *    sidebar entry, so they were reachable only by typing the URL.
 */

const SRC = join(__dirname, '..', 'src');

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8');
}

describe('admin navigation completeness', () => {
  it('exposes every implemented admin section', () => {
    const hrefs = ADMIN_NAV_ITEMS.map((item) => item.href);
    for (const expected of [
      '/control-center/dashboard',
      '/control-center/articles',
      '/control-center/media',
      '/control-center/matches',
      '/control-center/teams',
      '/control-center/players',
      '/control-center/competitions',
      '/control-center/seasons',
      '/control-center/venues',
      '/control-center/transfers',
      '/control-center/settings',
      '/control-center/users',
      '/control-center/roles',
      '/control-center/audit-logs',
    ]) {
      expect(hrefs, expected).toContain(expected);
    }
  });

  it('gives seasons and venues a read permission that exists in the catalogue', () => {
    const byKey = new Map(ADMIN_NAV_ITEMS.map((item) => [item.key, item.permission]));
    // Both modules are read-gated on these; they must be real seeded keys.
    expect(byKey.get('seasons')).toBe('seasons.read');
    expect(byKey.get('venues')).toBe('venues.read');
  });
});

describe('venues module wiring', () => {
  const newPage = read('app', 'control-center', '(protected)', 'venues', 'new', 'page.tsx');
  const editPage = read('app', 'control-center', '(protected)', 'venues', '[id]', 'edit', 'page.tsx');
  const listPage = read('app', 'control-center', '(protected)', 'venues', 'page.tsx');

  it('gates create and edit on the seeded write grant, not invented keys', () => {
    // The catalogue seeds venues.read + venues.manage only. Gating on
    // venues.create/venues.update made both pages permanently AccessDenied.
    expect(newPage).toContain('venues.manage');
    expect(newPage).not.toContain('venues.create');
    expect(editPage).toContain('venues.manage');
    expect(editPage).not.toContain('venues.update');
  });

  it('sends the country filter under the name the backend schema accepts', () => {
    // Backend: z.object({ countryId: uuidSchema.optional() }). The UI sent
    // `country_id`, which zod strips, so the filter never applied.
    expect(listPage).toMatch(/listQuery\.countryId\s*=/);
    expect(listPage).not.toMatch(/listQuery\.country_id\s*=/);
  });
});

describe('audit log wiring', () => {
  const page = read('app', 'control-center', '(protected)', 'audit-logs', 'page.tsx');

  it('does not send a free-text q the endpoint does not accept', () => {
    // GET /admin/audit-logs accepts page/limit/action/entity_type/user_id only.
    expect(page).not.toMatch(/listQuery\.q\s*=/);
  });

  it('offers a real actor filter driven by the admin users API', () => {
    expect(page).toContain('user_id');
    expect(page).toContain('adminUsers');
  });
});

describe('permission gate consistency with the seeded catalogue', () => {
  /**
   * Every key the UI gates on must exist in the seed catalogue, otherwise the
   * control is permanently invisible/denied. This is the frontend half of the
   * cross-layer check the backend test performs for requirePermission().
   */
  it('checks only seeded permission keys', () => {
    const migrations = join(__dirname, '..', '..', 'supabase', 'migrations');
    const seeded = new Set<string>();
    for (const file of ['025_admin_foundation.sql', '026_admin_settings_catalogue.sql', '027_admin_identity_permissions.sql']) {
      const text = readFileSync(join(migrations, file), 'utf8');
      for (const m of text.matchAll(/\('([a-z_]+\.[a-z_]+)',\s*'[a-z_]+',\s*'[a-z_]+'/g)) seeded.add(m[1]);
    }
    expect(seeded.size).toBeGreaterThanOrEqual(45);

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.tsx')) files.push(full);
      }
    };
    walk(join(SRC, 'app', 'control-center'));

    const checked = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/permissions\.includes\(\s*'([a-z_]+\.[a-z_]+)'/g)) checked.add(m[1]);
    }
    expect(checked.size).toBeGreaterThan(10);

    const missing = [...checked].filter((key) => !seeded.has(key)).sort();
    expect(missing).toEqual([]);
  });
});

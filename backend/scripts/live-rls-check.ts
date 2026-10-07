/**
 * Live RLS + write-path verification against real Supabase.
 *
 * Read-only except for a self-cleaning round trip on `system_settings`
 * (a config table, not football data). Every write is deleted and the
 * deletion is verified.
 */
import { anonClient, serviceClient } from '../src/lib/supabase';

const anon = anonClient();
const svc = serviceClient();
const pass: string[] = [];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  (ok ? pass : fail).push(label);
  console.log(`  ${ok ? 'ok  ' : '!!  '}${label}${detail ? '  — ' + detail : ''}`);
};

async function main() {
  console.log('='.repeat(72));
  console.log('RLS + WRITE-PATH VERIFICATION (live)');
  console.log('='.repeat(72));

  // ── 0. Integrity: did anything get damaged by earlier probes? ────────────
  console.log('\n--- 0. SEEDED DATA INTEGRITY ---');
  const roles = await svc.from('roles').select('id,name').order('id');
  const roleNames = (roles.data ?? []).map((r: { name: string }) => r.name).join(',');
  check(
    (roles.data?.length ?? 0) === 6 && roleNames.includes('super_admin') && !roleNames.includes('probe'),
    'roles table intact (6 rows, no "probe" residue)',
    roleNames,
  );
  const ds = await svc.from('data_sources').select('provider,is_active');
  check((ds.data?.length ?? 0) === 1, 'data_sources intact (1 seed row)', JSON.stringify(ds.data));

  // ── 1. RLS write protection, tested correctly ────────────────────────────
  // PostgREST returns success for a zero-row match, so "no error" alone proves
  // nothing. Instead: confirm via service role that the target row EXISTS, let
  // anon try to change it, then confirm via service role that it did NOT change.
  console.log('\n--- 1. RLS WRITE PROTECTION (method: mutate-then-verify) ---');

  async function mutationBlocked(table: string, pk: string, apply: () => Promise<unknown>, readBack: () => Promise<string | null>, label: string) {
    const before = await readBack();
    if (before === null) { check(false, `${label} (target row missing — inconclusive)`); return; }
    await apply();
    const after = await readBack();
    check(after === before, label, `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }

  await mutationBlocked(
    'roles', '1',
    async () => { await anon.from('roles').update({ name: 'probe' }).eq('id', 1); },
    async () => (await svc.from('roles').select('name').eq('id', 1).single()).data?.name ?? null,
    'anon UPDATE roles(id=1) blocked (row exists, unchanged)',
  );

  await mutationBlocked(
    'data_sources', 'name=Seed Provider',
    async () => { await anon.from('data_sources').update({ is_active: false }).eq('name', 'Seed Provider'); },
    async () => {
      const r = await svc.from('data_sources').select('is_active').eq('name', 'Seed Provider').single();
      return r.data ? String(r.data.is_active) : null;
    },
    'anon UPDATE data_sources blocked (row exists, unchanged)',
  );

  // anon INSERT is unambiguous — a denied INSERT returns 42501.
  for (const [t, row] of [
    ['teams', { slug: 'probe-team', name: 'probe' }],
    ['matches', { slug: 'probe-match', competition_id: '00000000-0000-0000-0000-000000000000', home_team_id: '00000000-0000-0000-0000-000000000000', away_team_id: '00000000-0000-0000-0000-000000000000', scheduled_at: new Date().toISOString() }],
    ['data_sources', { name: 'probe', provider: 'probe' }],
  ] as [string, Record<string, unknown>][]) {
    const r = await anon.from(t).insert(row as never);
    if (!r.error) await svc.from(t).delete().eq('slug', String(row.slug)).eq('name', 'probe');
    check(!!r.error, `anon INSERT ${t} rejected`, r.error ? String(r.error.code) : 'SUCCEEDED — RLS HOLE');
  }

  // ── 2. RLS read posture ──────────────────────────────────────────────────
  console.log('\n--- 2. RLS READ POSTURE ---');
  const rls = await svc.rpc('verify_schema_health');
  const health = rls.data as Record<string, unknown> | null;
  if (health) {
    const noRls = (health.tables_without_rls as string[]) ?? [];
    check(noRls.length === 0, 'every table has RLS enabled', noRls.length ? noRls.join(', ') : '0 tables without RLS');
  } else {
    check(false, 'verify_schema_health()', `ERROR ${rls.error?.code} ${rls.error?.message}`);
  }

  // A table that must be invisible to anon but visible to service role.
  for (const t of ['sync_jobs', 'audit_logs', 'system_settings', 'external_entity_ids', 'user_roles']) {
    const a = await anon.from(t).select('*', { count: 'exact', head: true });
    const s = await svc.from(t).select('*', { count: 'exact', head: true });
    const anonOk = !a.error;
    const svcOk = !s.error;
    check(!anonOk || ((a.data as { count: number })?.count ?? 0) <= ((s.data as { count: number })?.count ?? 0),
      `anon read of ${t} is no broader than service read`,
      `anon=${anonOk ? (a.data as { count: number })?.count : 'BLOCKED'} svc=${svcOk ? (s.data as { count: number })?.count : 'ERR'}`);
  }

  // ── 3. Write path: zero-residue constraint round trip ────────────────────
  console.log('\n--- 3. WRITE / UPSERT PATH (real round trip, self-cleaning) ---');
  // (a) constraint violation proves the write path reaches Postgres' constraint
  //     engine, and leaves nothing behind.
  const bad = await svc.from('teams').insert({ slug: 'probe-no-name' } as never);
  check(!!bad.error && String(bad.error.code) === '23502',
    'INSERT violating NOT NULL returns 23502 (not a 500)',
    bad.error ? `${bad.error.code} ${bad.error.message}` : 'UNEXPECTED SUCCESS');
  const residueA = await svc.from('teams').select('id').eq('slug', 'probe-no-name');
  check((residueA.data?.length ?? 0) === 0, 'failed INSERT left no residue');

  // (b) full insert -> upsert -> update -> delete round trip on a config table
  const KEY = '__integration_probe_delete_me__';
  await svc.from('system_settings').delete().eq('key', KEY);
  const ins = await svc.from('system_settings').insert({ key: KEY, value: { n: 1 }, type: 'probe' } as never);
  check(!ins.error, 'INSERT succeeds', ins.error ? String(ins.error.message) : '');

  // system_settings keys on `id`, so upsert MUST name the conflict target —
  // both production call sites already do (externalIds.ts, articles.repo.ts).
  const upd = await svc
    .from('system_settings')
    .upsert({ key: KEY, value: { n: 2 }, type: 'probe' } as never, { onConflict: 'key' });
  check(!upd.error, 'UPSERT succeeds (onConflict: key)', upd.error ? String(upd.error.message) : '');
  const afterUpsert = await svc.from('system_settings').select('value').eq('key', KEY).single();
  check((afterUpsert.data as { value: { n: number } } | null)?.value?.n === 2,
    'UPSERT actually updated the row', JSON.stringify((afterUpsert.data as { value: unknown })?.value));
  const dup = await svc.from('system_settings').insert({ key: KEY, value: { n: 3 }, type: 'probe' } as never);
  check(!!dup.error, 'duplicate INSERT rejected by UNIQUE constraint', dup.error ? String(dup.error.code) : 'accepted — no unique index');

  const del = await svc.from('system_settings').delete().eq('key', KEY).select('key');
  check(!del.error && (del.data?.length ?? 0) === 1, 'DELETE removes the row', `deleted ${del.data?.length ?? 0}`);
  const gone = await svc.from('system_settings').select('key').eq('key', KEY);
  check((gone.data?.length ?? 0) === 0, 'probe row fully removed — no residue');

  // ── 4. Diagnostics still broken? ─────────────────────────────────────────
  console.log('\n--- 4. STEP 40 DIAGNOSTICS (023 / 024) ---');
  const h = await svc.rpc('verify_schema_health');
  if (h.error) console.log(`  !! verify_schema_health   : ${h.error.code} ${h.error.message}`);
  else console.log('  ok  verify_schema_health   : returned payload');
  const c = await svc.rpc('verify_canonical_data');
  if (c.error) console.log(`  !! verify_canonical_data : ${c.error.code} ${c.error.message}`);
  else console.log('  ok  verify_canonical_data : returned payload');
  const n = await svc.rpc('_step40_norm_name', { input: 'FC Barcelona' });
  check(n.data === 'barcelona', '_step40_norm_name works', JSON.stringify(n.data));

  console.log('\n' + '='.repeat(72));
  console.log(`RESULT: ${pass.length} passed, ${fail.length} failed`);
  if (fail.length) console.log(`FAILED: ${fail.join(' | ')}`);
  console.log('='.repeat(72));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });

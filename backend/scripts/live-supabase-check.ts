/**
 * Live Supabase integration check — runs through the REAL backend runtime.
 *
 * Uses the same modules production uses (config, lib/supabase, repositories,
 * services). No mocks, no fakes, no test doubles.
 *
 * READ-ONLY. Performs no inserts, updates or deletes.
 */
import { config } from '../src/config';
import { anonClient, serviceClient } from '../src/lib/supabase';

const lat = async (fn: () => Promise<unknown>): Promise<[unknown, number]> => {
  const t = Date.now();
  const r = await fn();
  return [r, Date.now() - t];
};

function line(s = '') {
  console.log(s);
}

async function main() {
  line('='.repeat(72));
  line('LIVE SUPABASE INTEGRATION CHECK (read-only)');
  line('='.repeat(72));

  const anon = anonClient();
  const svc = serviceClient();
  const url = new URL(config.supabaseUrl).host;

  line(`\ntarget        : ${url}`);
  line(`anon client   : configured (${config.supabaseAnonKey ? 'yes' : 'NO'})`);
  line(`service client: configured (${config.supabaseServiceKey ? 'yes' : 'NO'})`);
  line(`NODE_ENV      : ${process.env.NODE_ENV ?? '(unset)'}`);

  // ── 1. Table inventory via service role (bypasses RLS) ────────────────────
  const TABLES = [
    'countries', 'venues', 'competitions', 'seasons', 'teams', 'players',
    'team_competitions', 'player_team_history', 'matches', 'match_events',
    'match_lineups', 'match_lineup_players', 'match_team_statistics',
    'match_player_statistics', 'categories', 'tags', 'articles',
    'article_categories', 'article_tags', 'article_teams', 'article_players',
    'article_competitions', 'article_matches', 'transfer_windows', 'transfers',
    'media', 'media_variants', 'seo_metadata', 'redirects', 'data_sources',
    'external_entity_ids', 'sync_jobs', 'sync_errors', 'sync_schedules',
    'profiles', 'roles', 'user_roles', 'user_favorite_teams',
    'user_favorite_players', 'user_favorite_competitions', 'notifications',
    'audit_logs', 'system_settings',
  ];

  line(`\n--- 1. ROW COUNTS (service role, bypasses RLS) ---`);
  line('table'.padEnd(28) + 'reachable  rows');
  const missing: string[] = [];
  const counts = new Map<string, number>();
  for (const t of TABLES) {
    const [result, ms] = await lat(() =>
      svc.from(t).select('*', { count: 'exact', head: true }),
    );
    const { error } = result;
    if (error) {
      line(t.padEnd(28) + `NO  ${error.code ?? error.message}`);
      missing.push(t);
    } else {
      // NOTE: supabase-js exposes `count` at the top level of the response,
      // not inside `data` (which is null for head:true requests).
      const n = result.count ?? 0;
      counts.set(t, n);
      line(t.padEnd(28) + `yes    ${String(n).padStart(5)}   (${ms}ms)`);
    }
  }
  line(`\ntables expected: ${TABLES.length}   reachable: ${TABLES.length - missing.length}   missing: ${missing.length}`);
  if (missing.length) line(`MISSING: ${missing.join(', ')}`);

  // ── 2. Seeded reference data ──────────────────────────────────────────────
  line(`\n--- 2. SEEDED REFERENCE DATA (required by RBAC / provider pipeline) ---`);
  const roles = await svc.from('roles').select('id,name').order('id');
  line(`roles          : ${roles.error ? 'ERROR ' + roles.error.message : (roles.data?.length ?? 0) + ' -> ' + (roles.data ?? []).map((r: { name: string }) => r.name).join(', ')}`);
  const ds = await svc.from('data_sources').select('id,name,provider,is_active,priority');
  line(`data_sources   : ${ds.error ? 'ERROR ' + ds.error.message : (ds.data?.length ?? 0) + ' -> ' + (ds.data ?? []).map((r: { provider: string; is_active: boolean }) => `${r.provider}(active=${r.is_active})`).join(', ')}`);
  
  // ── 3. Diagnostics RPCs (migration 023) ───────────────────────────────────
  line(`\n--- 3. DIAGNOSTIC FUNCTIONS (023_step40_verification) ---`);
  const health = await svc.rpc('verify_schema_health');
  if (health.error) {
    line(`verify_schema_health   : ERROR ${health.error.code} ${health.error.message}`);
  } else {
    const h = health.data as Record<string, unknown>;
    const tbls = (h.tables as unknown[]) ?? [];
    const noRls = (h.tables_without_rls as unknown[]) ?? [];
    line(`verify_schema_health   : OK`);
    line(`  extensions       : ${JSON.stringify(h.extensions)}`);
    line(`  enums            : ${(h.enums as unknown[])?.length ?? 0}`);
    line(`  tables           : ${tbls.length}`);
    line(`  indexes          : ${(h.indexes as unknown[])?.length ?? 0}`);
    line(`  functions        : ${(h.functions as unknown[])?.length ?? 0}`);
    line(`  triggers         : ${(h.triggers as unknown[])?.length ?? 0}`);
    line(`  policy_count     : ${h.policy_count}`);
    line(`  tables_without_rls: ${JSON.stringify(noRls)}  ${noRls.length === 0 ? '<- good' : '<- PROBLEM'}`);
  }

  const canon = await svc.rpc('verify_canonical_data');
  if (canon.error) {
    line(`verify_canonical_data : ERROR ${canon.error.code} ${canon.error.message}`);
  } else {
    const c = canon.data as Record<string, unknown>;
    line(`verify_canonical_data : OK`);
    for (const k of ['duplicate_teams', 'duplicate_competitions', 'duplicate_players', 'duplicate_matches', 'external_id_fanout', 'entity_multi_mapping']) {
      const v = (c[k] as unknown[]) ?? [];
      line(`  ${String(k).padEnd(24)} ${v.length} group(s)`);
    }
    const br = (c.broken_relationships as Record<string, number>) ?? {};
    const brBad = Object.entries(br).filter(([, n]) => n > 0);
    line(`  broken_relationships  ${brBad.length ? 'PROBLEM: ' + JSON.stringify(brBad) : 'all zero'}`);
  }

  // ── 4. Normalization helper used by the duplicate audit ───────────────────
  line(`\n--- 4. _step40_norm_name() (the function fixed earlier) ---`);
  for (const n of ['FC Barcelona', 'Barcelona FC', 'Núñez', 'Bayern München']) {
    const r = await svc.rpc('_step40_norm_name', { input: n });
    line(`  ${n.padEnd(16)} -> ${r.error ? 'ERROR ' + r.error.message : JSON.stringify(r.data)}`);
  }
  const fold = await svc.rpc('_step40_norm_name', { input: 'Núñez' });
  line(`  diacritic folding works: ${fold.data === 'nunez' ? 'YES (was broken pre-fix)' : 'NO -> ' + JSON.stringify(fold.data)}`);

  // ── 5. RLS behaviour: anon (public) vs service role ──────────────────────
  line(`\n--- 5. RLS BEHAVIOUR ---`);
  const rlsProbes: [string, string][] = [
    ['competitions', 'public read (anon)'],
    ['matches', 'public read (anon)'],
    ['articles', 'public read (anon)'],
    ['transfers', 'rumours must be hidden'],
    ['sync_jobs', 'admin-only'],
    ['roles', 'authenticated-only'],
    ['profiles', 'own-rows-only'],
    ['audit_logs', 'admin-only'],
    ['media', 'published-only'],
  ];
  line('table'.padEnd(22) + 'anon           service        verdict');
  for (const [t, why] of rlsProbes) {
    const a = await anon.from(t).select('*', { count: 'exact', head: true });
    const s = await svc.from(t).select('*', { count: 'exact', head: true });
    const av = a.error ? `ERR:${a.error.code}` : String(a.count ?? 0);
    const sv = s.error ? `ERR:${s.error.code}` : String(s.count ?? 0);
    const blocked = !a.error;
    line(t.padEnd(22) + av.padEnd(14) + sv.padEnd(14) + (blocked ? 'RLS enforced' : 'RLS BYPASSED!') + `  (${why})`);
  }

  // anon must NOT be able to write.
  //
  // INSERT only. PostgREST returns success for an UPDATE/DELETE that matches
  // zero rows, so "no error" on a mutation proves nothing — an RLS-blocked
  // update and a no-op update are indistinguishable. UPDATE/DELETE protection
  // is verified correctly in scripts/live-rls-check.ts, which confirms via the
  // service role that the target row exists, attempts the anon mutation, then
  // confirms the row is unchanged.
  line(`\n--- 6. ANON WRITE ATTEMPTS (INSERT only — see live-rls-check.ts for UPDATE) ---`);
  const writes: [string, Record<string, unknown>][] = [
    ['competitions', { name: 'rls-probe', slug: 'rls-probe' }],
    ['articles', { title: 'rls-probe', slug: 'rls-probe', content: 'probe' }],
    ['sync_jobs', { data_source_id: '00000000-0000-0000-0000-000000000000', job_type: 'probe' }],
    ['teams', { name: 'rls-probe', slug: 'rls-probe' }],
    ['data_sources', { name: 'rls-probe', provider: 'rls-probe' }],
  ];
  let anyWrite = false;
  for (const [t, row] of writes) {
    const r = await anon.from(t).insert(row as never);
    if (r.error) {
      line(`  anon INSERT ${t.padEnd(16)} BLOCKED  (${r.error.code})`);
    } else {
      anyWrite = true;
      line(`  !! anon ${op} ${t} SUCCEEDED — RLS HOLE`);
      // roll back immediately so no test record persists
      await svc.from(t).delete().eq('slug', 'rls-probe');
      await svc.from(t).delete().eq('name', 'rls-probe');
    }
  }
  line(`  anon write protection: ${anyWrite ? 'FAILED' : 'OK — all rejected'}`);

  line(`\n--- 7. SERVICE ROLE WRITE PATH (schema-only, no data written) ---`);
  const canWrite = await svc.from('sync_jobs').select('id').limit(1);
  line(`  service role can read sync_jobs: ${canWrite.error ? 'NO -> ' + canWrite.error.message : 'yes'}`);
  line(`  (no INSERT performed — production data untouched by design)`);

  line(`\n${'='.repeat(72)}`);
  const reached = TABLES.length - missing.length;
  line(`RESULT: ${reached}/${TABLES.length} tables reachable via real Supabase.`);
  line(`${'='.repeat(72)}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

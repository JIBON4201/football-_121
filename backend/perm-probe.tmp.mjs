const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(base + '/rest/v1/', { headers: { apikey: key, Authorization: 'Bearer ' + key } });
const spec = await res.json();
const paths = Object.keys(spec.paths || {});
const tables = paths.map((p) => p.replace(/^\//, '')).sort();
console.log('PostgREST status: ' + res.status);
console.log('table-ish paths exposed: ' + tables.length);
for (const t of tables) {
  if (!t.startsWith('rpc/')) console.log('  ' + t);
}
console.log('--- RPCs ---');
for (const t of tables) if (t.startsWith('rpc/')) console.log('  ' + t);
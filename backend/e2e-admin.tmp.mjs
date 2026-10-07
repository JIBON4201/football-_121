import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const API = 'http://localhost:4000/api/v1';
async function api(m,p,b){const r=await fetch(API+p,{method:m,headers:b?{'content-type':'application/json'}:{},body:b?JSON.stringify(b):undefined});let j=null;try{j=await r.json()}catch{}return{status:r.status,body:j};}
async function main(){
  const t = await api('POST','/admin/teams',{name:'ZZ Audit '+Date.now(),short_name:'ZAU'});
  console.log('create -> ' + t.status);
  const id = t.body?.data?.id;
  await api('PATCH','/admin/teams/'+id,{name:'ZZ Audit Renamed'});
  await api('DELETE','/admin/teams/'+id);
  const rows = await db.from('audit_logs').select('action,entity_type,entity_id,user_id,ip_address,user_agent').order('created_at',{ascending:false}).limit(6);
  console.log('audit rows now: ' + (rows.data||[]).length);
  for (const r of rows.data||[]) console.log('  ' + JSON.stringify(r));
  const bad = await db.from('audit_logs').insert({user_id:null,action:'probe.badip',entity_type:'probe',ip_address:'not-an-ip'}).select();
  console.log('bad ip insert -> ' + (bad.error ? 'ERROR '+bad.error.code : 'OK (should have been rejected by DB)'));
  if(!bad.error){ await db.from('audit_logs').delete().eq('action','probe.badip'); }
}
main();

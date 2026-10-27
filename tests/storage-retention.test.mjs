import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {getSetting,setSetting,settingStatements} from '../lib/settings-json.mjs';
import {runRetention,retainedIssues} from '../lib/retention.mjs';
import {modelJSON} from '../lib/pipeline-model.mjs';

function database(){
 const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 const db={prepare(query){let values=[];const p={bind(...v){values=v;return p;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:sql.prepare(query).run(...values).changes}};}};return p;},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};return {db,sql};
}
test('large Unicode publications fit bounded rows, survive rollback and replace old chunks atomically',async()=>{
 const {db,sql}=database();try{
  const publication={stories:[{title:'数据🧭'.repeat(400000)}],hot:['a','b']};
  await setSetting(db,'news_publication_v3',publication);
  assert.deepEqual(await getSetting(db,'news_publication_v3',null),publication);
  assert.ok(sql.prepare('SELECT MAX(length(CAST(value AS BLOB))) bytes FROM settings').get().bytes<300000);
  await assert.rejects(db.batch([...settingStatements(db,'news_publication_v3',{changed:true}),db.prepare('INSERT INTO nonexistent VALUES(1)')]));
  assert.deepEqual(await getSetting(db,'news_publication_v3',null),publication);
  sql.prepare("DELETE FROM settings WHERE key='__json_chunk__:news_publication_v3:0000'").run();
  await assert.rejects(getSetting(db,'news_publication_v3',null),/Incomplete/);
  await setSetting(db,'news_publication_v3',{fresh:true});
  assert.deepEqual(await getSetting(db,'news_publication_v3',null),{fresh:true});assert.equal(sql.prepare('SELECT COUNT(*) n FROM settings').get().n,1);
 }finally{sql.close();}
});
test('retention is opt-in, bounded and preserves future activities, active work and ambiguous receipts',async()=>{
 const {db,sql}=database(),now=Date.parse('2026-10-28T13:00:00Z'),old='2026-01-01T00:00:00Z';
 try{
  const insert=sql.prepare('INSERT INTO pipeline_items(id,source_id,published_at,raw,content_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  for(let i=0;i<501;i++)insert.run('old-'+i,'source',old,JSON.stringify({title:'old',summary:'raw excerpt'}),'hash','archived',old,old);
  insert.run('future','source',old,JSON.stringify({activityListing:true,activityCandidate:{date:'2027-01-01'}}),'hash','grouped',old,old);
  insert.run('unknown-date','source',old,JSON.stringify({activityListing:true}),'hash','grouped',old,old);
  insert.run('pending','source',old,JSON.stringify({summary:'needed input'}),'hash','collected',old,old);
  insert.run('ended','source',old,JSON.stringify({activityListing:true,activityCandidate:{date:'2026-01-02'}}),'hash','grouped',old,old);
  sql.prepare('INSERT INTO notices VALUES(?,?,?,?,?,?)').run('sent','reader','daily','sent',old,'delivered');
  sql.prepare('INSERT INTO notices VALUES(?,?,?,?,?,?)').run('unknown','reader','daily','unknown',old,'must reconcile');
  sql.prepare('INSERT INTO pipeline_calls VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('ambiguous','2026-01-01','analyze','model','uncertain',3,3,null,null,'unknown charge',old);
  assert.equal((await runRetention(db,now)).enabled,false);assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_items').get().n,505);
  await setSetting(db,'retention_enabled',true);
  let result;for(let i=0;i<5;i++){result=await runRetention(db,now);if(result.complete)break;}
  assert.equal(result.complete,true);assert.equal(result.allocatedBytes,null);assert.equal(result.capacityWarning,null);
  assert.deepEqual(sql.prepare('SELECT id FROM pipeline_items ORDER BY id').all().map(x=>x.id),['future','pending','unknown-date']);
  assert.equal(sql.prepare("SELECT message FROM notices WHERE id='sent'").get().message,'');
  assert.equal(sql.prepare("SELECT message FROM notices WHERE id='unknown'").get().message,'must reconcile');
  assert.equal(sql.prepare("SELECT status FROM pipeline_calls WHERE id='ambiguous'").get().status,'uncertain');
  assert.deepEqual(retainedIssues([{date:'2026-01-01'},{date:'2026-10-27'}],now),[{date:'2026-10-27'}]);
 }finally{sql.close();}
});
test('compacting an old model response never allows a second paid request',async()=>{
 const {db,sql}=database();let calls=0;const now=Date.parse('2026-01-01T00:00:00Z');
 const options={now,fetcher:async()=>{calls++;return Response.json({choices:[{message:{content:'{"items":[]}'}}],usage:{prompt_tokens:1,completion_tokens:1}});}};
 try{await modelJSON(db,'test-only','analyze','system',[],options);await setSetting(db,'retention_enabled',true);await runRetention(db,now+100*86400000);
  await assert.rejects(modelJSON(db,'test-only','analyze','system',[],options));assert.equal(calls,1);
 }finally{sql.close();}
});

test('D1 runtime stores a multi-megabyte publication without oversized rows',async()=>{
 const {Miniflare}=await import('miniflare');const {fileURLToPath}=await import('node:url');const root=fileURLToPath(new URL('../',import.meta.url));
 const mf=new Miniflare({compatibilityDate:'2026-05-15',modulesRoot:root,d1Databases:['DB'],modules:[{type:'ESModule',path:root+'bounded-settings-test.mjs',contents:`import {getSetting,setSetting} from './lib/settings-json.mjs';export default {async fetch(r,env){await env.DB.prepare('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)').run();const data={text:'新闻🧭'.repeat(350000)};await setSetting(env.DB,'snapshot',data);const result=await getSetting(env.DB,'snapshot',null);return Response.json({equal:result.text===data.text,maxBytes:(await env.DB.prepare('SELECT MAX(length(CAST(value AS BLOB))) bytes FROM settings').first()).bytes});}};`},{type:'ESModule',path:root+'lib/settings-json.mjs',contents:readFileSync(root+'lib/settings-json.mjs','utf8')}]});
 try{const response=await mf.dispatchFetch('https://test.example/');assert.equal(response.status,200);const result=await response.json();assert.equal(result.equal,true);assert.ok(result.maxBytes<300000);}finally{await mf.dispose();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {scheduledJob,validJob} from '../lib/scheduler-contract.mjs';
import {schedulerStep,schedulerStatus,setSchedulerOwner} from '../lib/scheduler-store.mjs';
import {advanceWorkflow} from '../scheduler/runner.mjs';
const at='2026-10-27T13:00:00.000Z',now=Date.parse(at);
const job=(kind='daily',mode='active')=>({...scheduledJob(kind,at),trigger:'cron',mode});
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE notices(id TEXT PRIMARY KEY,kind TEXT,status TEXT,created_at TEXT)');
 const db={prepare(query){let values=[];const p={bind(...v){values=v;return p;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};return p;},batch:queries=>Promise.all(queries.map(x=>x.run()))};return {db,sql};
}
test('business slots use Shanghai date, reject off-schedule, future and stale work',()=>{
 assert.equal(job().id,'daily-2026-10-27');
 assert.equal(scheduledJob('episodes','2026-10-27T16:00:00Z').runId,'2026-10-27T16:00:00.000Z');
 for(const x of [{...job(),kind:'other'},{...job(),scheduledAt:'2026-10-27T12:00:00Z'},{...job(),runId:'wrong'}])assert.throws(()=>validJob(x,now));
 assert.throws(()=>validJob(job(),now-120000));assert.throws(()=>validJob(job(),now+5*3600000));
});
test('probe records authenticated Cron evidence without processing or changing ownership',async()=>{
 const {db,sql}=database();let calls=0;
 try{const result=await schedulerStep(db,job('daily','probe'),{daily:async()=>calls++},now);assert.equal(result.outcome,'probe');assert.equal(calls,0);const state=await schedulerStatus(db);assert.equal(state.owners.daily,'legacy');assert.equal(state.probes.daily.trigger,'cron');assert.equal(state.daily,null);}
 finally{sql.close();}
});
test('owner switch, continuation, receipt failures and completed-response replay are durable',async()=>{
 const {db,sql}=database();let calls=0;
 const actions={daily:async()=>({complete:++calls===2,phase:calls===2?'complete':'models',pending:3})};
 try{
  assert.equal((await schedulerStep(db,job(),actions,now)).outcome,'inactive');assert.equal(calls,0);
  await setSchedulerOwner(db,'daily','cloudflare');
  assert.equal((await schedulerStep(db,job(),actions,now)).complete,false);
  sql.prepare('INSERT INTO notices VALUES(?,?,?,?)').run('sent','daily','sent',at);
  sql.prepare('INSERT INTO notices VALUES(?,?,?,?)').run('unknown','daily','unknown',at);
  const result=await schedulerStep(db,job(),actions,now);assert.equal(result.outcome,'attention');assert.equal(result.receipts.sent,1);assert.equal(result.receipts.unknown,1);
  // A dropped final HTTP response must not rerun any business action.
  assert.deepEqual(await schedulerStep(db,job(),actions,now),JSON.parse(JSON.stringify(result)));assert.equal(calls,2);
  await setSchedulerOwner(db,'daily','legacy');assert.equal((await schedulerStatus(db)).owners.daily,'legacy');
 }finally{sql.close();}
});
test('batch exceptions and busy leases retain progress; unfinished runs never claim success',async()=>{
 const {db,sql}=database();
 try{
  await setSchedulerOwner(db,'episodes','cloudflare');
  await assert.rejects(schedulerStep(db,job('episodes'),{episodes:async()=>{throw Error('private upstream');}},now),/progress retained/);
  assert.equal((await schedulerStatus(db)).episodes.complete,false);
  assert.equal((await schedulerStatus(db)).episodes.lastError,'backend_error');
  const result=await schedulerStep(db,job('episodes'),{episodes:async()=>({busy:true})},now);assert.equal(result.busy,true);
  assert.equal(sql.prepare("SELECT value FROM settings WHERE key='scheduler_lock_episodes'").get(),undefined);
 }finally{sql.close();}
});
const env={SITE_ORIGIN:'https://example.org',SCHEDULER_TOKEN:'s'.repeat(64)};
class Fatal extends Error{}
const fatal=message=>new Fatal(message);
test('workflow immediately advances work, checkpoints each batch and ends without polling',async()=>{
 const cache=new Map();let calls=0;
 const step={async do(name,config,run){if(cache.has(name))return cache.get(name);const value=await run();cache.set(name,value);return value;}};
 const fetcher=async(url,options)=>{assert.equal(url.href,'https://example.org/api/scheduler');assert.equal(options.redirect,'manual');assert.equal(options.headers['OAI-Sites-Authorization'],undefined);assert.equal(JSON.parse(options.body).runId,job().runId);calls++;return Response.json({runId:job().runId,complete:calls===3,outcome:'complete'});};
 await advanceWorkflow(job(),step,env,{fetcher,now:()=>now,fatal});assert.equal(calls,3);
 await advanceWorkflow(job(),step,env,{fetcher,now:()=>now,fatal});assert.equal(calls,3,'checkpoint replay must not repeat paid or delivery requests');
});
test('workflow retries transient errors only and rejects authentication, redirect, blocked or wrong-run responses',async()=>{
 const step={do:(_name,_config,run)=>run()};
 for(const status of [401,403,302,422])await assert.rejects(advanceWorkflow(job(),step,env,{now:()=>now,fatal,fetcher:async()=>new Response('',{status})}),Fatal);
 for(const status of [429,503])await assert.rejects(advanceWorkflow(job(),step,env,{now:()=>now,fatal,fetcher:async()=>new Response('',{status})}),error=>!(error instanceof Fatal));
 for(const body of [{complete:false,blocked:true},{complete:true,runId:'other'}])await assert.rejects(advanceWorkflow(job(),step,env,{now:()=>now,fatal,fetcher:async()=>Response.json(body)}),Fatal);
 await assert.rejects(advanceWorkflow(job(),step,env,{now:()=>now+5*3600000,fatal,fetcher:()=>assert.fail('expired job must not fetch')}),Fatal);
});
test('scheduler credential cannot control ownership; admin cannot impersonate the scheduled executor',async()=>{
 const {db,sql}=database();globalThis.__schedulerRouteTest={DB:db,SCHEDULER_TOKEN:'s'.repeat(64)};
 let source=await readFile(new URL('../app/api/scheduler/route.ts',import.meta.url),'utf8');
 source=source.replace("import {env} from 'cloudflare:workers';","const env=globalThis.__schedulerRouteTest;")
 .replace("import {authorizedUpdater,refreshNews,publicState} from '../../../lib/news-store';","const authorizedUpdater=r=>r.headers.get('authorization')==='Bearer '+ 'a'.repeat(64);const refreshNews=()=>{throw Error('unexpected');};const publicState=refreshNews;")
 .replace("import {refreshModelRankings} from '../../../lib/model-ranking-store';","const refreshModelRankings=refreshNews;")
 .replace("import {runEpisodeJob,runSubscriptionJob} from '../../../lib/subscription-store';","const runEpisodeJob=refreshNews,runSubscriptionJob=refreshNews;")
 .replace(/from '(\.\.\/\.\.\/\.\.\/lib\/[^']+)'/g,(_,p)=>`from '${new URL('../lib/'+p.split('/').at(-1),import.meta.url).href}'`);
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const route=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const request=(key,body)=>new Request('https://example.org/api/scheduler',{method:body?'POST':'GET',headers:{authorization:'Bearer '+key},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await route.GET(request('bad'))).status,401);
  assert.equal((await route.GET(request('s'.repeat(64)))).status,200);
  assert.equal((await route.POST(request('s'.repeat(64),{action:'owner',kind:'daily',owner:'cloudflare'}))).status,403);
  assert.equal((await route.POST(request('a'.repeat(64),{action:'step',...job()}))).status,403);
  assert.equal((await route.POST(request('a'.repeat(64),{action:'owner',kind:'daily',owner:'cloudflare'}))).status,200);
 }finally{delete globalThis.__schedulerRouteTest;sql.close();}
});

test('Cron starts only its business kind and duplicate delivery never restarts an instance',async()=>{
 let source=await readFile(new URL('../scheduler/worker.ts',import.meta.url),'utf8');
 source=source.replace("import {WorkflowEntrypoint,WorkflowEvent,WorkflowStep} from 'cloudflare:workers';","class WorkflowEntrypoint {}")
 .replace("import {NonRetryableError} from 'cloudflare:workflows';","class NonRetryableError extends Error {}")
 .replace("from './runner.mjs'",`from '${new URL('../scheduler/runner.mjs',import.meta.url).href}'`)
 .replace("from '../lib/scheduler-contract.mjs'",`from '${new URL('../lib/scheduler-contract.mjs',import.meta.url).href}'`);
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const worker=(await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))).default;
 const created=[],promises=[],ctx={waitUntil:p=>promises.push(p)},bindings={SCHEDULER_MODE:'probe',UPDATES:{create:async args=>created.push(args)}};
 await worker.scheduled({cron:'0 13 * * *',scheduledTime:now},bindings,ctx);await worker.scheduled({cron:'0 * * * *',scheduledTime:now},bindings,ctx);await Promise.all(promises);
 assert.deepEqual(created.map(x=>x.params.kind),['daily','episodes']);assert.ok(created.every(x=>x.params.trigger==='cron'&&x.id.endsWith('-probe')));
 // Regression: the real 2026-10-28 01:00 Cron carried 16.392 seconds of jitter.
 promises.length=0;
 await worker.scheduled({cron:'0 * * * *',scheduledTime:1793120416392},bindings,ctx);
 await worker.scheduled({cron:'0 * * * *',scheduledTime:1793120416392+60000},bindings,ctx);
 await worker.scheduled({cron:'0 13 * * *',scheduledTime:now+16392},bindings,ctx);
 await Promise.all(promises);
 assert.equal(created[2].params.scheduledAt,'2026-10-27T17:00:00.000Z');
 assert.equal(created[2].id,created[3].id,'delivery jitter must not create a second hourly run');
 assert.equal(created[0].id,created[4].id,'daily remains the Beijing 21:00 business slot');
 await assert.rejects(worker.scheduled({cron:'0 13 * * *',scheduledTime:now+3600000},bindings,ctx),/Invalid scheduled time/);
 let inspected=0;promises.length=0;
 bindings.UPDATES={create:async()=>{throw Error('already exists');},get:async()=>({status:async()=>{inspected++;return {status:'complete'};}})};
 await worker.scheduled({cron:'0 * * * *',scheduledTime:now},bindings,ctx);await Promise.all(promises);assert.equal(inspected,1);
 await assert.rejects(worker.scheduled({cron:'*/5 * * * *',scheduledTime:now},bindings,ctx),/Unexpected cron/);
});

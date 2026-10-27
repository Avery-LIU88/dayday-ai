import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runNightlyUpdate,nightlyClock} from '../lib/nightly-update.mjs';
import {getSetting,settingStatement} from '../lib/news-pipeline.mjs';
import {validateActivity,upcomingActivities,deliveryParts,dailyNoticeId,dailyDeliveryItems,dailyDeliveryParts} from '../lib/delivery-content.mjs';
import {deliveryPolicy} from '../config/delivery.mjs';
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
 const db={prepare(query){let values=[];const p={bind(...v){values=v;return p;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:sql.prepare(query).run(...values).changes}};}};return p;},batch:queries=>Promise.all(queries.map(x=>x.run()))};
 return {db,sql};
}
test('daily items have independent cards; activity reminders are only for upcoming live events',()=>{
 const at=Date.parse('2026-10-27T13:00:00Z');
 const item={id:'event',title:'发布会',source:'Official',activity:{date:'2026-10-28',startAt:'2026-10-28T10:00:00+08:00',url:'https://example.org/event'}};
 assert.equal(dailyNoticeId('activities',item,at),'activities:event:upcoming');
 assert.equal(dailyNoticeId('activities',item,at-86400000),'activities:event');
 const publication={hot:[{id:'hot',title:'新闻',url:'https://example.org/news'}],activities:[item,{...item,id:'cancelled',activity:{...item.activity,status:'cancelled'}},{...item,id:'ended',activity:{...item.activity,date:'2026-10-26',startAt:'2026-10-26T10:00:00+08:00'}}]};
 const groups=dailyDeliveryItems(publication,at);assert.equal(groups.activities.length,1);
 const parts=dailyDeliveryParts(groups,at);assert.equal(parts.length,2);
 assert.deepEqual(parts.map(p=>p.ids),[['hot:hot'],['activities:event:upcoming']]);assert.match(parts[0].text,/今日热点/);assert.match(parts[1].text,/活动提醒/);
 assert.deepEqual(dailyDeliveryParts({hot:[],activities:[]},at),[]);
});
test('large daily digests preserve category order and all IDs within the message byte limit',()=>{
 const hot=Array.from({length:80},(_,i)=>({id:'hot-'+i,title:'热点'+i+'长'.repeat(180),url:'https://example.org/'+i}));
 const parts=dailyDeliveryParts({hot,activities:[]});assert.ok(parts.length>1);
 assert.deepEqual(parts.flatMap(x=>x.ids),hot.map(x=>'hot:'+x.id));
 for(const part of parts)assert.ok(new TextEncoder().encode(JSON.stringify(part.message)).length<=deliveryPolicy.maxMessageBytes);
});
test('only 21:00 starts a run; publication, models, subscriptions run in order and retries do not recollect',async()=>{
 const {db,sql}=database(),calls=[],at='2026-10-24T13:05:00Z';let ready=false,dispatches=0;
 const actions={news:async options=>{assert.equal(options.windowEnd,'2026-10-24T13:00:00.000Z');calls.push('news');return {complete:ready,publishedAt:at,pending:0};},read:async()=>({processedAt:at,hot:[{id:'one'}],activities:[]}),models:async()=>calls.push('models'),subscriptions:async()=>{calls.push('send');return {complete:++dispatches===2};}};
 try{
  for(const hour of ['00','12']){const result=await runNightlyUpdate(db,actions,new Date(`2026-10-24T${hour}:00:00Z`));assert.equal(result.skipped,true);}
  assert.deepEqual(calls,[]);const time=new Date('2026-10-24T13:00:00Z');
  assert.deepEqual(nightlyClock(time),{day:'2026-10-24',hour:21});
  assert.equal((await runNightlyUpdate(db,actions,time)).complete,false);assert.deepEqual(calls,['news']);
  assert.equal(await getSetting(db,'nightly_publication',null),null,'partial publication must not unlock delivery');
  ready=true;await runNightlyUpdate(db,actions,time);assert.equal((await getSetting(db,'nightly_publication',null)).hot[0].id,'one');
  await runNightlyUpdate(db,actions,time);await runNightlyUpdate(db,actions,time);
  assert.equal((await runNightlyUpdate(db,actions,time)).complete,true);assert.deepEqual(calls,['news','news','models','send','send']);
  assert.equal((await runNightlyUpdate(db,actions,time)).alreadyCompleted,true);assert.equal(calls.length,5);
  assert.equal((await runNightlyUpdate(db,actions,new Date('2026-10-25T00:00:00Z'))).skipped,true);assert.equal(calls.length,5);
 }finally{sql.close();}
});
test('failed or stale publication never enables notifications, cursor survives failure',async()=>{
 const {db,sql}=database(),time=new Date('2026-10-24T13:00:00Z');let failed=true,delivered=0;
 const actions={news:async()=>{if(failed)throw Error('upstream failed');return {complete:true,publishedAt:'2026-10-24T13:01:00Z'};},read:async()=>({processedAt:'2026-10-23T13:00:00Z'}),models:async()=>{},subscriptions:async()=>{delivered++;}};
 try{
  await assert.rejects(runNightlyUpdate(db,actions,time),/upstream/);assert.equal((await getSetting(db,'nightly_update',null)).phase,'news');
  failed=false;await assert.rejects(runNightlyUpdate(db,actions,time),/本轮/);assert.equal(delivered,0);assert.equal(await getSetting(db,'nightly_publication',null),null);
  assert.equal(await getSetting(db,'nightly_update_lock',null),null);
  await db.prepare("INSERT INTO settings(key,value) VALUES('nightly_update_lock',?)").bind(String(Date.now()+60000)).run();assert.equal((await runNightlyUpdate(db,actions,time)).busy,true);
 }finally{sql.close();}
});
test('activity date needs verbatim full-date evidence; expired activities and rumours are excluded',()=>{
 const input={title:'AI 线上发布会',excerpt:'邀请参加 2026年10月25日 在直播平台举行的发布会。',url:'https://example.org/launch'};
 const valid={date:'2026-10-25',evidence:input.excerpt,location:'直播平台'};
 const a=validateActivity(valid,input);assert.equal(a.date,'2026-10-25');assert.equal(a.url,input.url);
 assert.equal(validateActivity({...valid,date:'2026-10-26'},input),null);
 assert.equal(validateActivity({...valid,evidence:'想象中的 2026年10月25日'},input),null);
 assert.equal(validateActivity({...valid,location:'北京'},input),null);
 const story={id:'a',activity:a,priority:{quality:{newFact:true,uncertain:false,insufficientEvidence:false}}};
 assert.equal(upcomingActivities([story],Date.parse('2026-10-24T13:00Z')).length,1);
 assert.equal(upcomingActivities([story],Date.parse('2026-10-26T13:00Z')).length,0);
 assert.equal(upcomingActivities([{...story,priority:{quality:{newFact:true,uncertain:true}}}],Date.parse('2026-10-24T13:00Z')).length,0);
});
test('message splitting preserves all items and order without a daily part cap',()=>{
 const items=Array.from({length:200},(_,i)=>({id:String(i),title:'标题 '+i,takeaway:'摘要'.repeat(120),source:'Official',url:'https://example.org/'+i}));
 const parts=deliveryParts(items,'hot');assert.ok(parts.length>3);
 assert.deepEqual(parts.flatMap(x=>x.ids),items.map(x=>x.id));
 for(const part of parts)assert.ok(new TextEncoder().encode(JSON.stringify(part.message)).length<=deliveryPolicy.maxMessageBytes);
 assert.deepEqual(deliveryParts([],'hot'),[]);
});

test('daily ownership and pinned date prevent overlap or opening a new day on replay',async()=>{
 const {db,sql}=database(),at=new Date('2026-10-27T13:00:00Z');let calls=0;
 const actions={news:async()=>{calls++;return {complete:false};}};
 try{
  await settingStatement(db,'scheduler_owner_daily','cloudflare').run();
  assert.equal((await runNightlyUpdate(db,actions,at)).skipped,true);assert.equal(calls,0);
  await settingStatement(db,'nightly_update',{day:'2026-10-27',phase:'complete'}).run();
  assert.equal((await runNightlyUpdate(db,actions,at,{owner:'cloudflare',expectedRunId:'2026-10-27'})).alreadyCompleted,true);
  assert.equal((await runNightlyUpdate(db,actions,new Date('2026-10-26T13:00:00Z'),{owner:'cloudflare',expectedRunId:'2026-10-26'})).reason,'superseded');
  await settingStatement(db,'nightly_update',{day:'2026-10-26',phase:'news'}).run();
  assert.equal((await runNightlyUpdate(db,actions,at,{owner:'cloudflare',expectedRunId:'2026-10-27'})).reason,'previous_run_pending');
  assert.equal(calls,0);
 }finally{sql.close();}
});
test('manual acceptance runs at real time, resumes once, and leaves the same-day 21:00 run available',async()=>{
 const {db,sql}=database(),time=new Date('2026-10-27T18:25:16.392Z');let sends=0,news=0;
 const options={owner:'cloudflare',expectedRunId:'manual-'+time.toISOString(),manual:true};
 const published='2026-10-27T18:26:00Z';
 const actions={news:async()=>{news++;return {complete:true,publishedAt:published};},read:async()=>({processedAt:published,hot:[],activities:[]}),models:async()=>{},subscriptions:async()=>{sends++;return {complete:true};}};
 try{
  await settingStatement(db,'scheduler_owner_daily','cloudflare').run();
  await runNightlyUpdate(db,actions,time,options);await runNightlyUpdate(db,actions,time,options);
  assert.equal((await runNightlyUpdate(db,actions,time,options)).complete,true);
  assert.equal((await runNightlyUpdate(db,actions,time,options)).alreadyCompleted,true);
  assert.equal(news,1);assert.equal(sends,1);
  assert.equal((await getSetting(db,'nightly_publication',null)).runId,options.expectedRunId);
  const night=new Date('2026-10-28T13:00:00Z');
  const result=await runNightlyUpdate(db,{news:async()=>{news++;return {complete:false};}},night,{owner:'cloudflare',expectedRunId:'2026-10-28'});
  assert.equal(result.complete,false);assert.equal(news,2);
  assert.equal((await getSetting(db,'nightly_update',null)).day,'2026-10-28');
  assert.equal((await runNightlyUpdate(db,actions,time,options)).reason,'previous_run_pending');
 }finally{sql.close();}
});
test('manual acceptance finishes only after a source sweep and preserves backlog for a fresh nightly collection',async()=>{
 const {db,sql}=database(),time=new Date('2026-10-27T18:25:00Z');let swept=false,sends=0;
 const options={owner:'cloudflare',expectedRunId:'manual-'+time.toISOString(),manual:true};
 const at='2026-10-27T18:26:00Z';
 const actions={news:async()=>({complete:false,nextStage:swept?'analyze':'collect',pending:1300,publishedAt:at}),read:async()=>({processedAt:at,hot:[{id:'real-new-item'}],activities:[]}),models:async()=>{},subscriptions:async()=>{sends++;return {complete:true};}};
 try{
  await settingStatement(db,'scheduler_owner_daily','cloudflare').run();
  assert.equal((await runNightlyUpdate(db,actions,time,options)).phase,'news');
  assert.equal(await getSetting(db,'nightly_publication',null),null);
  swept=true;await settingStatement(db,'pipeline_phase','analyze').run();
  assert.equal((await runNightlyUpdate(db,actions,time,options)).phase,'models');
  assert.equal(await getSetting(db,'pipeline_phase',''), 'collect');
  assert.equal((await getSetting(db,'nightly_update',null)).pending,1300);
  await runNightlyUpdate(db,actions,time,options);
  const result=await runNightlyUpdate(db,actions,time,options);assert.equal(result.complete,true);assert.equal(result.pending,1300);assert.equal(sends,1);
  const night=new Date('2026-10-28T13:00:00Z');
  assert.equal((await runNightlyUpdate(db,actions,night,{owner:'cloudflare',expectedRunId:'2026-10-28'})).phase,'news','scheduled run must not use the manual shortcut');
 }finally{sql.close();}
});

test('opt-in maintenance resumes after delivery without collecting or sending again',async()=>{
 const {db,sql}=database(),time=new Date('2026-10-28T13:00:00Z');let news=0,sent=0,cleaned=0;
 try{
  await settingStatement(db,'retention_enabled',true).run();
  const actions={news:async()=>{news++;return {complete:true,publishedAt:time.toISOString()};},read:async()=>({processedAt:time.toISOString(),hot:[],activities:[]}),models:async()=>{},subscriptions:async()=>{sent++;return {complete:true};},maintenance:async()=>({complete:++cleaned===2})};
  await runNightlyUpdate(db,actions,time);await runNightlyUpdate(db,actions,time);
  assert.equal((await runNightlyUpdate(db,actions,time)).phase,'maintenance');
  assert.equal((await runNightlyUpdate(db,actions,time)).complete,false);
  assert.equal((await runNightlyUpdate(db,actions,time)).complete,true);
  assert.deepEqual({news,sent,cleaned},{news:1,sent:1,cleaned:2});
 }finally{sql.close();}
});

import {policy,analysisPrompt,groupingPrompt} from '../config/pipeline.mjs';
import {modelJSON,digest,budgetStatus,PipelinePause} from './pipeline-model.mjs';
import {ruleFilter,validateAnalyses,validateGroups,duplicate,candidateWeight,scoreGroup,selectHot,editions} from './pipeline-editorial.mjs';
import {canonicalUrl,topicNames} from './dayday-core.mjs';
import {collectSource} from './news-collector.mjs';
import {appendSnapshot,trendFor,indexSnapshots} from './event-trends.mjs';

export const stages=['collect','analyze','deduplicate','group','score','publish'];
export async function getSetting(db,key,fallback){const row=await db.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();return row?JSON.parse(row.value):fallback;}
export const settingStatement=(db,key,value)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value));
const set=(db,key,value)=>settingStatement(db,key,value).run();
const iso=()=>new Date().toISOString();
function step(db,id,stage,status,result){return db.prepare('INSERT INTO pipeline_steps(id,item_id,stage,status,result,version,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,result=excluded.result,version=excluded.version,updated_at=excluded.updated_at').bind(id+':'+stage,id,stage,status,JSON.stringify(result),policy.version,iso());}
async function batch(db,statements){for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));}
const sourceMap=sources=>new Map(sources.map(s=>[s.id,s]));
async function rows(db,status,limit){return (await db.prepare('SELECT * FROM pipeline_items WHERE status=? ORDER BY published_at DESC,id LIMIT ?').bind(status,limit).all()).results;}
async function remaining(db,status){return (await db.prepare('SELECT COUNT(*) n FROM pipeline_items WHERE status=?').bind(status).first()).n;}

export async function ingest(db,items){
 const at=iso(),statements=[];
 for(const item of items){
   const url=canonicalUrl(item.url);if(!url)continue;
   const raw={...item,url,title:item.title.slice(0,policy.inputTitleChars),summary:(item.summary||'').slice(0,policy.inputExcerptChars)};
   const hash=await digest(JSON.stringify([raw.title,raw.summary]));
   const old=Date.parse(raw.publishedAt)<Date.now()-policy.processDays*86400000;
   // Unchanged fetches retain all stage results. A revised source edition
   // invalidates downstream results while paid-response receipts remain reusable.
   statements.push(db.prepare(`INSERT INTO pipeline_items(id,source_id,published_at,raw,content_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET raw=excluded.raw,content_hash=excluded.content_hash,published_at=excluded.published_at,status=excluded.status,analysis=NULL,duplicate_of=NULL,event_id=NULL,error=NULL,updated_at=excluded.updated_at
     WHERE pipeline_items.content_hash!=excluded.content_hash`).bind(raw.id,raw.sourceId,raw.publishedAt,JSON.stringify(raw),hash,old?'archived':'collected',at,at));
   statements.push(step(db,raw.id,'collect','done',{sourceId:raw.sourceId,url,publishedAt:raw.publishedAt,archiveOnly:old}));
 }
 await batch(db,statements);return items.length;
}
async function bootstrap(db,seed){
 if(await getSetting(db,'pipeline_bootstrapped_v3',false))return;
 const stored=(await db.prepare("SELECT data FROM entries WHERE kind='article' ORDER BY published_at DESC LIMIT ?").bind(policy.bootstrapLimit).all()).results.map(r=>JSON.parse(r.data));
 await ingest(db,stored.length?stored:seed.entries);
 await set(db,'pipeline_bootstrapped_v3',true);
}
async function collect(db,sources,seed){
 await bootstrap(db,seed);
 const active=sources.filter(s=>s.adapter!=='directory'&&s.feed),cursor=await getSetting(db,'pipeline_collect_cursor',0);
 const checks=new Map((await getSetting(db,'news_health',seed.health)).map(h=>[h.id,h]));
 const selection=active.slice(cursor,cursor+policy.batches.collect);let added=0;
 // Keep source traffic and D1 writes bounded; source failures are independent.
 for(const source of selection){const at=iso();try{
   const result=await collectSource(source,fetch,{includeIrrelevant:true,excerptChars:policy.inputExcerptChars});
   added+=await ingest(db,result.items);
   checks.set(source.id,{id:source.id,ok:true,count:result.items.length,rawCount:result.rawCount,checkedAt:at,lastSuccessAt:at,error:null});
 }catch(error){const old=checks.get(source.id);checks.set(source.id,{...old,id:source.id,ok:false,checkedAt:at,lastSuccessAt:old?.lastSuccessAt||(old?.ok?old.checkedAt:null),error:String(error.message||'采集失败').slice(0,180)});}}
 const next=cursor+selection.length>=active.length?0:cursor+selection.length;
 await db.batch([settingStatement(db,'news_health',[...checks.values()]),settingStatement(db,'pipeline_collect_cursor',next),...(next===0?[settingStatement(db,'news_collected_at',iso())]:[])]);
 return {processed:added,checked:selection.length,done:next===0,next};
}
async function analyze(db,sources,key){
 const pending=await rows(db,'collected',policy.batches.analyze),sourcesById=sourceMap(sources),inputs=[],prepared=[];
 for(const row of pending){const raw=JSON.parse(row.raw),reason=ruleFilter(raw,sourcesById.get(row.source_id));
   if(reason){prepared.push(db.prepare("UPDATE pipeline_items SET status='filtered',analysis=?,updated_at=? WHERE id=?").bind(JSON.stringify({isAI:false,importance:0,reasons:[reason],method:'rule'}),iso(),row.id),step(db,row.id,'analyze','filtered',{reason,method:'rule'}));continue;}
   const cached=await db.prepare("SELECT analysis FROM pipeline_items WHERE content_hash=? AND analysis IS NOT NULL AND status NOT IN ('filtered','collected','error') LIMIT 1").bind(row.content_hash).first();
   if(cached){const value={...JSON.parse(cached.analysis),id:row.id};prepared.push(db.prepare("UPDATE pipeline_items SET status='analyzed',analysis=?,updated_at=? WHERE id=?").bind(JSON.stringify(value),iso(),row.id),step(db,row.id,'analyze','done',{...value,reused:true}));continue;}
   inputs.push({id:row.id,title:raw.title,excerpt:raw.summary,source:raw.source,publishedAt:raw.publishedAt});
 }
 await batch(db,prepared);
 if(inputs.length){const result=await modelJSON(db,key,'analyze',analysisPrompt,inputs);let values;
   try{values=validateAnalyses(result,inputs.map(x=>x.id));}catch(e){await markError(db,inputs,'analyze',e.message);return {processed:pending.length,done:await remaining(db,'collected')===0,errors:inputs.length};}
   const writes=[];for(const value of values){writes.push(db.prepare('UPDATE pipeline_items SET status=?,analysis=?,error=NULL,updated_at=? WHERE id=?').bind(value.isAI?'analyzed':'filtered',JSON.stringify({...value,model:policy.model,version:policy.version}),iso(),value.id),step(db,value.id,'analyze',value.isAI?'done':'filtered',value));}await batch(db,writes);
 }
 return {processed:pending.length,done:await remaining(db,'collected')===0};
}
async function markError(db,items,stage,message){await batch(db,items.flatMap(x=>[db.prepare("UPDATE pipeline_items SET status='error',error=?,updated_at=? WHERE id=?").bind(stage+': '+message,iso(),x.id),step(db,x.id,stage,'error',{message})]));}
async function deduplicate(db){
 const pending=await rows(db,'analyzed',policy.batches.deduplicate);
 for(const row of pending){const raw=JSON.parse(row.raw);
   const candidates=(await db.prepare("SELECT id,raw FROM pipeline_items WHERE status IN ('deduplicated','grouped') AND duplicate_of IS NULL AND published_at BETWEEN ? AND ?").bind(new Date(Date.parse(row.published_at)-policy.groupingHours*3600000).toISOString(),new Date(Date.parse(row.published_at)+policy.groupingHours*3600000).toISOString()).all()).results;
   const match=candidates.find(x=>duplicate(raw,JSON.parse(x.raw)));
   await db.batch([db.prepare("UPDATE pipeline_items SET status='deduplicated',duplicate_of=?,updated_at=? WHERE id=?").bind(match?.id||null,iso(),row.id),step(db,row.id,'deduplicate','done',{duplicateOf:match?.id||null,method:match?'canonical_url_or_identical_text':'unique'})]);
 }
 return {processed:pending.length,done:await remaining(db,'analyzed')===0};
}
async function group(db,key){
 const pending=(await db.prepare("SELECT * FROM pipeline_items WHERE status='deduplicated' ORDER BY duplicate_of IS NOT NULL,published_at DESC,id LIMIT ?").bind(policy.batches.group).all()).results;
 const existing=(await db.prepare('SELECT id,candidate FROM pipeline_events WHERE published_at>=?').bind(new Date(Date.now()-(policy.processDays+3)*86400000).toISOString()).all()).results.map(x=>({...JSON.parse(x.candidate),id:x.id}));
 const inputs=[],automatic=new Map(),virtual=[...existing];
 for(const row of pending){const a=JSON.parse(row.analysis),item={id:row.id,title:a.title,takeaway:a.takeaway,entities:a.entities,action:a.action,publishedAt:row.published_at};
   if(row.duplicate_of){const original=await db.prepare('SELECT event_id FROM pipeline_items WHERE id=?').bind(row.duplicate_of).first();if(original?.event_id){automatic.set(row.id,{eventId:original.event_id,relation:'same_event',confidence:1,reason:'已验证重复内容'});continue;}}
   const candidates=virtual.map(c=>({...c,weight:candidateWeight(item,c)})).filter(c=>c.weight>0).sort((a,b)=>b.weight-a.weight).slice(0,policy.groupingCandidates).map(({weight,...c})=>c);
   if(candidates.length)inputs.push({...item,candidates});else automatic.set(row.id,{eventId:null,relation:'new',confidence:1,reason:'候选集中无相关事件'});
   virtual.push({...item,id:'evt-'+row.id});
 }
 if(inputs.length){const result=await modelJSON(db,key,'group',groupingPrompt,inputs);try{for(const value of validateGroups(result,inputs))automatic.set(value.id,value);}catch(e){await markError(db,inputs,'group',e.message);}}
 const aliases=new Map();let processed=0;
 for(const row of pending){const decision=automatic.get(row.id);if(!decision)continue;
   const target=aliases.get(decision.eventId)||decision.eventId;
   const exists=target?await db.prepare('SELECT id FROM pipeline_events WHERE id=?').bind(target).first():null;
   const merge=decision.relation==='same_event'&&decision.confidence>=policy.mergeConfidence&&exists;
   const id=merge?target:'evt-'+row.id,a=JSON.parse(row.analysis),at=iso();aliases.set('evt-'+row.id,id);
   const candidate={title:a.title,takeaway:a.takeaway,entities:a.entities,action:a.action,publishedAt:row.published_at};
   await db.batch([db.prepare('INSERT OR IGNORE INTO pipeline_events(id,parent_id,candidate,published_at,updated_at) VALUES(?,?,?,?,?)').bind(id,decision.relation==='follow_up'&&exists?target:null,JSON.stringify(candidate),row.published_at,at),db.prepare("UPDATE pipeline_items SET event_id=?,status='grouped',updated_at=? WHERE id=?").bind(id,at,row.id),step(db,row.id,'group','done',{...decision,assignedEventId:id})]);processed++;
 }
 return {processed,done:await remaining(db,'deduplicated')===0};
}
async function score(db,sources){
 const items=(await db.prepare("SELECT * FROM pipeline_items WHERE status='grouped' ORDER BY published_at DESC LIMIT ?").bind(policy.publicationLimit).all()).results;
 const events=(await db.prepare('SELECT id,parent_id FROM pipeline_events').all()).results,byEvent=new Map();
 for(const row of items){if(!byEvent.has(row.event_id))byEvent.set(row.event_id,[]);byEvent.get(row.event_id).push(row);}
 const writes=[],now=Date.now(),map=sourceMap(sources);
 for(const event of events){const members=byEvent.get(event.id);if(!members?.length){writes.push(db.prepare('UPDATE pipeline_events SET data=NULL WHERE id=?').bind(event.id));continue;}const result=scoreGroup(members,map,event,now);
   writes.push(db.prepare('UPDATE pipeline_events SET data=?,heat=?,importance=?,recency=?,reliability=?,updated_at=? WHERE id=?').bind(JSON.stringify(result),result.scoreParts.heat,result.scoreParts.importance,result.scoreParts.recency,result.scoreParts.reliability,iso(),event.id),step(db,event.id,'score','done',result.scoreParts));}
 await batch(db,writes);return {processed:byEvent.size,done:true};
}
export async function publish(db,sources,seed){
 const at=iso(),now=Date.now();
 const stories=(await db.prepare('SELECT data FROM pipeline_events WHERE data IS NOT NULL ORDER BY published_at DESC LIMIT ?').bind(policy.publicationLimit).all()).results.map(x=>JSON.parse(x.data));
 const health=await getSetting(db,'news_health',seed.health),healthy=new Set(health.filter(h=>h.ok&&now-Date.parse(h.checkedAt)<48*3600000).map(h=>h.id));
 const prior=await getSetting(db,'news_publication_v3',null);
 const history=appendSnapshot(await getSetting(db,'news_trends_v3',[]),stories,at),index=indexSnapshots(history);
 for(const story of stories)story.trend=trendFor(story,history,index);
 // Preserve old archive links, but do not republish old source excerpts as AI
 // writing. New editions carry version=3 and contain derived points only.
 const cleanArchives=issues=>issues.map(issue=>({...issue,articles:issue.articles.map(a=>a.scoreVersion===3?a:{...a,summary:'',developments:[]})}));
 const archivedDaily=cleanArchives(prior?.daily||await getSetting(db,'news_daily_editions_v1',[])),archivedWeekly=cleanArchives(prior?.weekly||await getSetting(db,'news_weekly_editions_v1',[]));
 const issues=editions(stories,at,archivedDaily,archivedWeekly);
 const counts=(await db.prepare('SELECT status,COUNT(*) n FROM pipeline_items GROUP BY status').all()).results;
 const snapshot={stories,...issues,hot:selectHot(stories,now),ranking:{version:3,windowHours:policy.hotHours,asOf:at},sources,health,collectedAt:await getSetting(db,'news_collected_at',at),processedAt:at,databaseReady:true,topics:topicNames,
   pipeline:{mode:'DeepSeek 要点与重要性 · 独立信源热度',processed:counts.filter(x=>x.status==='grouped').reduce((n,x)=>n+x.n,0),lastSuccessAt:at,pending:counts.filter(x=>['collected','analyzed','deduplicated'].includes(x.status)).reduce((n,x)=>n+x.n,0)},
   stats:{registered:sources.filter(s=>s.scope!=='截图栏目').length,configured:sources.filter(s=>s.adapter!=='directory').length,healthy:new Set(sources.filter(s=>healthy.has(s.id)).map(s=>s.publisher)).size,healthyEndpoints:healthy.size,articles:counts.reduce((n,x)=>n+x.n,0),stories:stories.length}};
 // A single statement publishes an internally consistent snapshot. Public GETs
 // do not group, score, invoke a model, or write anything.
 await db.batch([settingStatement(db,'news_publication_v3',snapshot),settingStatement(db,'news_trends_v3',history),step(db,'publication','publish','done',{at,stories:stories.length})]);
 return {done:true,processed:stories.length,pending:snapshot.pipeline.pending,publishedAt:at};
}
export async function pipelineStatus(db){return {version:policy.version,model:policy.model,budget:await budgetStatus(db),phase:await getSetting(db,'pipeline_phase','collect'),items:(await db.prepare('SELECT status,COUNT(*) count FROM pipeline_items GROUP BY status').all()).results,recentRuns:(await db.prepare('SELECT started_at,finished_at,added,details FROM runs ORDER BY started_at DESC LIMIT 12').all()).results};}
export async function runPipeline(db,sources,seed,key,requested='auto'){
 if(requested!=='auto'&&!stages.includes(requested))throw Error('未知处理阶段');
 const now=Date.now(),lease=String(now+policy.leaseMs),lock=await db.prepare("INSERT INTO settings(key,value) VALUES('news_sync_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key").bind(lease,now).first();
 if(!lock)return {busy:true,complete:false};
 let stage=requested==='auto'?await getSetting(db,'pipeline_phase','collect'):requested;const at=iso();
 try{
   let result;
   try{result=await ({collect:()=>collect(db,sources,seed),analyze:()=>analyze(db,sources,key),deduplicate:()=>deduplicate(db),group:()=>group(db,key),score:()=>score(db,sources),publish:()=>publish(db,sources,seed)})[stage]();}
   catch(e){if(!(e instanceof PipelinePause))throw e;result={processed:0,done:true,deferred:true,reason:e.code,message:e.message};await set(db,'pipeline_last_pause',{stage,at,reason:e.code,message:e.message});}
   const next=result.done?stages[(stages.indexOf(stage)+1)%stages.length]:stage;
   if(requested==='auto')await set(db,'pipeline_phase',next);
   await db.prepare('INSERT INTO runs(id,started_at,finished_at,added,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),at,iso(),result.processed||0,JSON.stringify({pipeline:3,stage,...result})).run();
   return {busy:false,stage,nextStage:next,complete:stage==='publish'&&result.done,...result};
 }finally{await db.prepare("DELETE FROM settings WHERE key='news_sync_lock' AND value=?").bind(lease).run();}
}

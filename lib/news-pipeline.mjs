import {policy,analysisPrompt,groupingPrompt} from '../config/pipeline.mjs';
import {modelJSON,digest,budgetStatus,PipelinePause} from './pipeline-model.mjs';
import {ruleFilter,validateAnalyses,validateGroups,duplicate,candidateWeight,eventCandidate,addEventEvidence,scoreGroup,selectHot,editions} from './pipeline-editorial.mjs';
import {canonicalUrl,topicNames} from './dayday-core.mjs';
import {collectSource} from './news-collector.mjs';
import {appendSnapshot,trendFor,indexSnapshots} from './event-trends.mjs';
import {primaryLinkCandidates} from './editorial-priority.mjs';

export const stages=['collect','analyze','deduplicate','group','score','publish','reprocess'];
export async function getSetting(db,key,fallback){const row=await db.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();return row?JSON.parse(row.value):fallback;}
export const settingStatement=(db,key,value)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value));
const set=(db,key,value)=>settingStatement(db,key,value).run();
const iso=()=>new Date().toISOString();
function step(db,id,stage,status,result){return db.prepare('INSERT INTO pipeline_steps(id,item_id,stage,status,result,version,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,result=excluded.result,version=excluded.version,updated_at=excluded.updated_at').bind(id+':'+stage,id,stage,status,JSON.stringify(result),policy.version,iso());}
async function batch(db,statements){for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));}
const sourceMap=sources=>new Map(sources.map(s=>[s.id,s]));
function selection(ids){return ids?.length?{sql:` AND id IN (${ids.map(()=>'?').join(',')})`,values:ids}:{sql:'',values:[]};}
async function rows(db,status,limit,ids,order='published_at DESC,id'){const selected=selection(ids);return (await db.prepare(`SELECT * FROM pipeline_items WHERE status=?${selected.sql} ORDER BY ${order} LIMIT ?`).bind(status,...selected.values,limit).all()).results;}
async function remaining(db,status,ids){const selected=selection(ids);return (await db.prepare(`SELECT COUNT(*) n FROM pipeline_items WHERE status=?${selected.sql}`).bind(status,...selected.values).first()).n;}

export async function ingest(db,items){
 const at=iso(),statements=[];
 for(const item of items){
   const url=canonicalUrl(item.url);if(!url)continue;
   const raw={...item,url,title:item.title.slice(0,policy.inputTitleChars),summary:(item.summary||'').slice(0,policy.inputExcerptChars)};
   const hash=await digest(JSON.stringify([raw.title,raw.summary,...(raw.evidenceLinks?.length?[raw.evidenceLinks]:[])]));
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
async function collect(db,sources,seed,sourceIds){
 await bootstrap(db,seed);
 const active=sources.filter(s=>s.adapter!=='directory'&&s.feed),cursor=await getSetting(db,'pipeline_collect_cursor',0);
 const checks=new Map((await getSetting(db,'news_health',seed.health)).map(h=>[h.id,h]));
 const selection=sourceIds?sourceIds.map(id=>active.find(s=>s.id===id)):active.slice(cursor,cursor+policy.batches.collect);
 let added=0,checked=0;const start=Date.now(),itemIds=[],checkedIds=[];
 // Keep source traffic and D1 writes bounded; source failures are independent.
 for(const source of selection){if(checked&&Date.now()-start>policy.collectionTimeBudgetMs)break;checked++;checkedIds.push(source.id);const at=iso();try{
   const result=await collectSource(source,fetch,{includeIrrelevant:true,excerptChars:policy.inputExcerptChars});
   added+=await ingest(db,result.items);
   if(sourceIds)itemIds.push(...result.items.filter(item=>Date.parse(item.publishedAt)>=Date.now()-policy.processDays*86400000).map(item=>item.id));
   checks.set(source.id,{id:source.id,ok:true,count:result.items.length,rawCount:result.rawCount,checkedAt:at,lastSuccessAt:at,error:null});
 }catch(error){const old=checks.get(source.id);checks.set(source.id,{...old,id:source.id,ok:false,checkedAt:at,lastSuccessAt:old?.lastSuccessAt||(old?.ok?old.checkedAt:null),error:String(error.message||'采集失败').slice(0,180)});}}
 const next=cursor+checked>=active.length?0:cursor+checked;
 await db.batch([settingStatement(db,'news_health',[...checks.values()]),...(!sourceIds?[settingStatement(db,'pipeline_collect_cursor',next),...(next===0?[settingStatement(db,'news_collected_at',iso())]:[])]:[])]);
 if(sourceIds)return {processed:added,checked,done:checked===selection.length,targeted:true,remainingSourceIds:sourceIds.slice(checked),itemIds,sourceResults:checkedIds.map(id=>checks.get(id))};
 return {processed:added,checked,done:next===0,next};
}
async function analyze(db,sources,key,ids){
 const pending=await rows(db,'collected',policy.batches.analyze,ids),sourcesById=sourceMap(sources),start=Date.now();let processed=0,errors=0;
 // A model sees one source at a time. Batch-level instructions alone cannot
 // prevent attribution leakage between different articles in the same prompt.
 for(const row of pending){
   if(processed&&Date.now()-start>=policy.modelStageTimeBudgetMs)break;
   const raw=JSON.parse(row.raw),reason=ruleFilter(raw,sourcesById.get(row.source_id));
   if(reason){await db.batch([db.prepare("UPDATE pipeline_items SET status='filtered',analysis=?,updated_at=? WHERE id=?").bind(JSON.stringify({isAI:false,importance:0,reasons:[reason],method:'rule'}),iso(),row.id),step(db,row.id,'analyze','filtered',{reason,method:'rule'})]);processed++;continue;}
   const cached=await db.prepare("SELECT analysis FROM pipeline_items WHERE content_hash=? AND analysis IS NOT NULL AND status NOT IN ('filtered','collected','error') LIMIT 1").bind(row.content_hash).first();
   let value,reused=false;
   if(cached&&JSON.parse(cached.analysis).version===policy.version){value={...JSON.parse(cached.analysis),id:row.id};reused=true;}
   else{
     const input={id:row.id,title:raw.title,excerpt:raw.summary,source:raw.source,publishedAt:raw.publishedAt,primaryLinks:primaryLinkCandidates(raw,sourcesById)};
     const result=await modelJSON(db,key,'analyze',analysisPrompt,[input]);
     try{[value]=validateAnalyses(result,[row.id],[input]);}catch(e){await markError(db,[row],'analyze',e.message);processed++;errors++;continue;}
   }
   await db.batch([db.prepare('UPDATE pipeline_items SET status=?,analysis=?,error=NULL,updated_at=? WHERE id=?').bind(value.isAI?'analyzed':'filtered',JSON.stringify({...value,model:policy.model,version:policy.version}),iso(),row.id),step(db,row.id,'analyze',value.isAI?'done':'filtered',{...value,reused})]);processed++;
 }
 return {processed,done:await remaining(db,'collected')===0,remainingSelected:ids?await remaining(db,'collected',ids):undefined,...(errors?{errors}:{})};
}
async function markError(db,items,stage,message){await batch(db,items.flatMap(x=>[db.prepare("UPDATE pipeline_items SET status='error',error=?,updated_at=? WHERE id=?").bind(stage+': '+message,iso(),x.id),step(db,x.id,stage,'error',{message})]));}
async function deduplicate(db,ids){
 const pending=await rows(db,'analyzed',policy.batches.deduplicate,ids);
 for(const row of pending){const raw=JSON.parse(row.raw);
   const candidates=(await db.prepare("SELECT id,raw FROM pipeline_items WHERE status IN ('deduplicated','grouped') AND duplicate_of IS NULL AND published_at BETWEEN ? AND ?").bind(new Date(Date.parse(row.published_at)-policy.groupingHours*3600000).toISOString(),new Date(Date.parse(row.published_at)+policy.groupingHours*3600000).toISOString()).all()).results;
   const match=candidates.find(x=>duplicate(raw,JSON.parse(x.raw)));
   await db.batch([db.prepare("UPDATE pipeline_items SET status='deduplicated',duplicate_of=?,updated_at=? WHERE id=?").bind(match?.id||null,iso(),row.id),step(db,row.id,'deduplicate','done',{duplicateOf:match?.id||null,method:match?'canonical_url_or_identical_text':'unique'})]);
 }
 return {processed:pending.length,done:await remaining(db,'analyzed')===0,remainingSelected:ids?await remaining(db,'analyzed',ids):undefined};
}
async function group(db,key,ids){
 const pending=await rows(db,'deduplicated',policy.batches.group,ids,'duplicate_of IS NOT NULL,published_at DESC,id');
 const stored=(await db.prepare("SELECT id,candidate FROM pipeline_events e WHERE published_at>=? AND EXISTS (SELECT 1 FROM pipeline_items i WHERE i.event_id=e.id AND i.status='grouped')").bind(new Date(Date.now()-(policy.processDays+3)*86400000).toISOString()).all()).results;
 const existing=new Map(stored.map(x=>[x.id,{...JSON.parse(x.candidate),id:x.id}])),start=Date.now();let processed=0,errors=0;
 // Commit each decision before considering the next article. A model only sees
 // this article's candidates, never hypothetical IDs belonging to other tasks.
 for(const row of pending){
   if(processed&&Date.now()-start>=policy.modelStageTimeBudgetMs)break;
   const item={id:row.id,...eventCandidate(row)};let decision,candidates=[];
   if(row.duplicate_of){const original=await db.prepare('SELECT event_id FROM pipeline_items WHERE id=?').bind(row.duplicate_of).first();if(original?.event_id)decision={id:row.id,eventId:original.event_id,relation:'same_event',confidence:1,reason:'已验证重复内容'};}
   if(!decision){
     candidates=[...existing.values()].map(c=>({...c,weight:candidateWeight(item,c)})).filter(c=>c.weight>0).sort((a,b)=>b.weight-a.weight||a.id.localeCompare(b.id)).slice(0,policy.groupingCandidates).map(({weight,...c})=>c);
     for(const c of candidates){if(!c.evidence?.length){const member=await db.prepare("SELECT * FROM pipeline_items WHERE event_id=? AND status='grouped' ORDER BY duplicate_of IS NOT NULL,published_at DESC LIMIT 1").bind(c.id).first();if(member){c.evidence=eventCandidate(member).evidence;existing.set(c.id,c);}}}
     if(candidates.length){
       const stripIds=c=>({...c,evidence:c.evidence?.map(({id,...e})=>e)});
       const input={...stripIds(item),candidates:candidates.map((c,i)=>({...stripIds(c),id:'candidate-'+(i+1)}))};
       const result=await modelJSON(db,key,'group',groupingPrompt,[input]);
       try{[decision]=validateGroups(result,[input]);if(decision.eventId)decision.eventId=candidates[input.candidates.findIndex(c=>c.id===decision.eventId)].id;}
       catch(e){await markError(db,[row],'group',e.message);processed++;errors++;continue;}
     }else decision={id:row.id,eventId:null,relation:'new',confidence:1,reason:'候选集中无相关事件'};
   }
   const target=decision.eventId,exists=target?await db.prepare('SELECT id FROM pipeline_events WHERE id=?').bind(target).first():null;
   const merge=decision.relation==='same_event'&&decision.confidence>=policy.mergeConfidence&&exists;
   let id=merge?target:'evt-'+row.id;const at=iso();
   // Replaying one representative must not force unrelated old members into it.
   if(!merge&&await db.prepare("SELECT id FROM pipeline_items WHERE event_id=? AND status='grouped' LIMIT 1").bind(id).first())id+='-'+(await digest(row.id+row.updated_at)).slice(0,10);
   const prior=merge?await db.prepare('SELECT candidate FROM pipeline_events WHERE id=?').bind(id).first():null;
   const candidate=prior?addEventEvidence(JSON.parse(prior.candidate),eventCandidate(row)):eventCandidate(row);
   const targetCandidate=candidates.find(c=>c.id===target);
   const followUp=decision.relation==='follow_up'&&decision.confidence>=policy.mergeConfidence&&exists&&targetCandidate&&Date.parse(row.published_at)>=Date.parse(targetCandidate.publishedAt);
   const eventWrite=merge?db.prepare('UPDATE pipeline_events SET candidate=?,updated_at=? WHERE id=?').bind(JSON.stringify(candidate),at,id):db.prepare('INSERT INTO pipeline_events(id,parent_id,candidate,published_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,candidate=excluded.candidate,published_at=excluded.published_at,updated_at=excluded.updated_at').bind(id,followUp?target:null,JSON.stringify(candidate),row.published_at,at);
   await db.batch([eventWrite,db.prepare("UPDATE pipeline_items SET event_id=?,status='grouped',error=NULL,updated_at=? WHERE id=?").bind(id,at,row.id),step(db,row.id,'group','done',{...decision,assignedEventId:id,merged:!!merge,followUp:!!followUp,threshold:policy.mergeConfidence,candidateIds:candidates.map(c=>c.id),...(decision.relation==='same_event'&&!merge?{notMergedReason:'confidence_or_target'}:{})})]);
   existing.set(id,{...candidate,id});processed++;
 }
 return {processed,done:await remaining(db,'deduplicated')===0,remainingSelected:ids?await remaining(db,'deduplicated',ids):undefined,...(errors?{errors}:{})};
}
async function score(db,sources){
 const items=(await db.prepare("SELECT * FROM pipeline_items WHERE status='grouped' ORDER BY published_at DESC LIMIT ?").bind(policy.publicationLimit).all()).results;
 const events=(await db.prepare('SELECT id,parent_id FROM pipeline_events').all()).results,byEvent=new Map();
 for(const row of items){if(!byEvent.has(row.event_id))byEvent.set(row.event_id,[]);byEvent.get(row.event_id).push(row);}
 const writes=[],now=Date.now(),map=sourceMap(sources);
 for(const event of events){const members=byEvent.get(event.id);if(!members?.length){writes.push(db.prepare('UPDATE pipeline_events SET data=NULL WHERE id=?').bind(event.id));continue;}const result=scoreGroup(members,map,event,now);
   writes.push(db.prepare('UPDATE pipeline_events SET data=?,heat=?,importance=?,recency=?,reliability=?,updated_at=? WHERE id=?').bind(JSON.stringify(result),result.scoreParts.heat,result.scoreParts.importance,result.scoreParts.recency,result.scoreParts.reliability,iso(),event.id),step(db,event.id,'score','done',{...result.scoreParts,priority:result.priority}));}
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
 const snapshot={stories,...issues,hot:selectHot(stories,now),ranking:{version:4,mode:'editorial_priority',windowHours:policy.hotHours,asOf:at,weights:policy.scoring.priority.weights,minimumImportance:policy.scoring.priority.minimumImportance,heatSaturation:policy.scoring.priority.heatSaturation},sources,health,collectedAt:await getSetting(db,'news_collected_at',at),processedAt:at,databaseReady:true,topics:topicNames,
   pipeline:{mode:'DeepSeek 要点与重要性 · 今日必知综合排序',processed:counts.filter(x=>x.status==='grouped').reduce((n,x)=>n+x.n,0),lastSuccessAt:at,pending:counts.filter(x=>['collected','analyzed','deduplicated'].includes(x.status)).reduce((n,x)=>n+x.n,0)},
   stats:{registered:sources.filter(s=>s.scope!=='截图栏目').length,configured:sources.filter(s=>s.adapter!=='directory').length,healthy:new Set(sources.filter(s=>healthy.has(s.id)).map(s=>s.publisher)).size,healthyEndpoints:healthy.size,articles:counts.reduce((n,x)=>n+x.n,0),stories:stories.length}};
 // A single statement publishes an internally consistent snapshot. Public GETs
 // do not group, score, invoke a model, or write anything.
 await db.batch([settingStatement(db,'news_publication_v3',snapshot),settingStatement(db,'news_trends_v3',history),step(db,'publication','publish','done',{at,stories:stories.length})]);
 return {done:true,processed:stories.length,pending:snapshot.pipeline.pending,publishedAt:at};
}
export async function pipelineStatus(db){return {version:policy.version,model:policy.model,budget:await budgetStatus(db),phase:await getSetting(db,'pipeline_phase','collect'),items:(await db.prepare('SELECT status,COUNT(*) count FROM pipeline_items GROUP BY status').all()).results,recentRuns:(await db.prepare('SELECT started_at,finished_at,added,details FROM runs ORDER BY started_at DESC LIMIT 12').all()).results};}
async function reprocess(db,ids){
 const selected=selection(ids),items=(await db.prepare(`SELECT * FROM pipeline_items WHERE status!='archived'${selected.sql}`).bind(...selected.values).all()).results;
 await batch(db,items.flatMap(row=>[step(db,row.id,'reprocess','done',{previousStatus:row.status,previousEventId:row.event_id,previousDuplicateOf:row.duplicate_of,previousAnalysis:row.analysis?JSON.parse(row.analysis):null}),db.prepare("UPDATE pipeline_items SET status='collected',analysis=NULL,event_id=NULL,duplicate_of=NULL,error=NULL,updated_at=? WHERE id=?").bind(iso(),row.id)]));
 return {processed:items.length,done:true};
}
export function validSelection(stage,ids){return ids===undefined?stage!=='reprocess':(['analyze','deduplicate','group','reprocess'].includes(stage)&&Array.isArray(ids)&&ids.length>0&&ids.length<=Math.min(policy.batches.analyze,policy.batches.group)&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)));}
export function validSourceSelection(stage,ids,sources){return ids===undefined||(stage==='collect'&&Array.isArray(ids)&&ids.length>0&&ids.length<=policy.batches.collect&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&sources.some(s=>s.id===id&&s.adapter!=='directory'&&s.feed)));}
export async function runPipeline(db,sources,seed,key,requested='auto',itemIds,sourceIds){
 if(requested!=='auto'&&!stages.includes(requested))throw Error('未知处理阶段');
 if(!validSelection(requested,itemIds))throw Error('条目选择无效');
 if(!validSourceSelection(requested,sourceIds,sources)||(sourceIds&&itemIds))throw Error('来源选择无效');
 const now=Date.now(),lease=String(now+policy.leaseMs),lock=await db.prepare("INSERT INTO settings(key,value) VALUES('news_sync_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key").bind(lease,now).first();
 if(!lock)return {busy:true,complete:false};
 const at=iso();
 try{
   const execute=async stage=>{
     let result;
     try{result=await ({collect:()=>collect(db,sources,seed,sourceIds),analyze:()=>analyze(db,sources,key,itemIds),deduplicate:()=>deduplicate(db,itemIds),group:()=>group(db,key,itemIds),score:()=>score(db,sources),publish:()=>publish(db,sources,seed),reprocess:()=>reprocess(db,itemIds)})[stage]();}
     catch(e){if(!(e instanceof PipelinePause))throw e;result={processed:0,done:true,deferred:true,reason:e.code,message:e.message};await set(db,'pipeline_last_pause',{stage,at,reason:e.code,message:e.message});}
     await db.prepare('INSERT INTO runs(id,started_at,finished_at,added,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),at,iso(),result.processed||0,JSON.stringify({pipeline:3,stage,...result})).run();
     return {stage,...result};
   };
   if(requested!=='auto'){const result=await execute(requested);return {busy:false,nextStage:requested==='reprocess'?'analyze':requested==='publish'?'collect':result.done?stages[stages.indexOf(requested)+1]:requested,complete:requested==='publish'&&result.done,...result};}
   // Each automatic request publishes a bounded chunk end-to-end. A large
   // historical backlog cannot keep today's completed results off the site.
   let phase=await getSetting(db,'pipeline_phase','collect');const results=[];
   if(phase==='collect'){const collected=await execute('collect');results.push(collected);if(collected.done){phase='analyze';await set(db,'pipeline_phase',phase);}}
   for(const stage of ['analyze','deduplicate','group','score','publish'])results.push(await execute(stage));
   const publication=results.at(-1),deferred=results.find(r=>r.deferred),complete=phase!=='collect'&&(publication.pending===0||!!deferred);
   if(complete)await set(db,'pipeline_phase','collect');
   return {busy:false,stage:'batch',nextStage:complete?'collect':phase,complete,processed:publication.processed,pending:publication.pending,publishedAt:publication.publishedAt,...(deferred?{deferred:true,reason:deferred.reason,message:deferred.message}:{}),steps:results};
 }finally{await db.prepare("DELETE FROM settings WHERE key='news_sync_lock' AND value=?").bind(lease).run();}
}

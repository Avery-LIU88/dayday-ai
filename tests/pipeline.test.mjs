import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {modelJSON,budgetStatus,chinaDay,usageCost} from '../lib/pipeline-model.mjs';
import {ingest,runPipeline,getSetting,validSelection,validSourceSelection,settingStatement} from '../lib/news-pipeline.mjs';
import {validateAnalyses,validateGroups,scoreGroup,selectHot,editions,ruleFilter,duplicate,eventCandidate,addEventEvidence} from '../lib/pipeline-editorial.mjs';
import {policy} from '../config/pipeline.mjs';
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const db={prepare(text){const stmt={values:[],bind(...values){this.values=values;return this;},async first(){return sql.prepare(text).get(...this.values)||null;},async all(){return {results:sql.prepare(text).all(...this.values)};},async run(){const r=sql.prepare(text).run(...this.values);return {meta:{changes:r.changes}};}};return stmt;},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};return {db,sql};
}
const sources=[{id:'one',name:'One',publisher:'one',primary:true,adapter:'directory'},{id:'two',name:'Two',publisher:'two',adapter:'directory'},{id:'mirror',name:'Mirror',publisher:'one',adapter:'directory'}];
const entry=(id='a',sourceId='one',title='OpenAI releases TestModel 9')=>({id,sourceId,title,summary:'A new AI model with a released evaluation.',source:sourceId,url:'https://example.test/'+id,publishedAt:new Date().toISOString(),kind:'article',topics:['公司动态']});
const analysis=id=>({id,isAI:true,title:'OpenAI 发布 TestModel 9',takeaway:'新模型发布并提供评测。',bullets:['公开摘要没有提供具体指标。'],importance:75,reasons:['有可核对的产品更新'],entities:['OpenAI','TestModel 9'],action:'发布 TestModel 9',topic:'公司动态'});
const response=items=>Response.json({choices:[{message:{content:JSON.stringify({items})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:80,prompt_cache_hit_tokens:50}});
test('targeted source retries persist independent health, retain last success and do not move the scheduled cursor or call a model',async()=>{
 const {db,sql}=database(),original=globalThis.fetch,calls=[];
 const selected=[{id:'ok',name:'Official',adapter:'rss',feed:'https://one.test/rss'},{id:'bad',name:'Unavailable',adapter:'rss',feed:'https://two.test/rss'},{id:'skip',name:'Unselected',adapter:'rss',feed:'https://three.test/rss'}];
 const last='2026-10-10T00:00:00.000Z';
 globalThis.fetch=async url=>{calls.push(url);if(url===selected[1].feed)return new Response('Unavailable',{status:503});return new Response(`<rss><channel><item><title>AI model update</title><link>https://one.test/new</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);};
 try{
   await db.batch([settingStatement(db,'pipeline_collect_cursor',2),settingStatement(db,'news_collected_at',last),settingStatement(db,'news_health',[{id:'bad',ok:true,checkedAt:last,lastSuccessAt:last}])]);
   const result=await runPipeline(db,selected,{entries:[],health:[]},'','collect',undefined,['ok','bad']);
   assert.deepEqual(calls,selected.slice(0,2).map(x=>x.feed));assert.equal(result.targeted,true);assert.equal(result.done,true);assert.equal(result.itemIds.length,1);
   assert.equal(result.sourceResults[0].ok,true);assert.equal(result.sourceResults[1].ok,false);assert.match(result.sourceResults[1].error,/503/);assert.equal(result.sourceResults[1].lastSuccessAt,last);
   assert.equal(await getSetting(db,'pipeline_collect_cursor',0),2);assert.equal(await getSetting(db,'news_collected_at',''),last);
   assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_items').get().n,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_calls').get().n,0);
   for(const ids of [[],['ok','ok'],['unknown'],['ok','bad','skip','extra','fifth']])assert.equal(validSourceSelection('collect',ids,selected),false);
   assert.equal(validSourceSelection('analyze',['ok'],selected),false);
 }finally{globalThis.fetch=original;sql.close();}
});
test('model responses reject fabricated IDs, oversized summaries and invalid scores',()=>{
 assert.equal(validateAnalyses({items:[analysis('a')]},['a'])[0].importance,75);
 for(const bad of [{id:'other'},{importance:101},{bullets:['a','b','c'.repeat(260),'d']},{isAI:'true'}])assert.throws(()=>validateAnalyses({items:[{...analysis('a'),...bad}]},['a']));
 assert.throws(()=>validateGroups({items:[{id:'a',eventId:'forged',relation:'same_event',confidence:1,reason:'same'}]},[{id:'a',candidates:[]}]))
});
test('Shanghai budget day and peak token accounting are deterministic',()=>{
 assert.equal(chinaDay(Date.parse('2026-10-23T16:01:00Z')),'2026-10-24');
 assert.equal(usageCost({prompt_tokens:1000,prompt_cache_hit_tokens:500,completion_tokens:100}),1820);
 assert.equal(usageCost({}),null);
});
test('receipts prevent duplicate paid calls and keep token usage',async()=>{
 const {db,sql}=database();let calls=0;const options={fetcher:async()=>{calls++;return response([analysis('a')]);}};
 const first=await modelJSON(db,'test-only','analyze','json',[{id:'a'}],options),second=await modelJSON(db,'test-only','analyze','json',[{id:'a'}],options);
 assert.deepEqual(first,second);assert.equal(calls,1);assert.equal((await budgetStatus(db)).calls,1);assert.equal(sql.prepare('SELECT status FROM pipeline_calls').get().status,'received');sql.close();
});
test('concurrent reservations never cross the daily budget',async()=>{
 const {db,sql}=database();let release;const hold=new Promise(r=>release=r);let calls=0;
 const options={config:{...policy,dailyBudgetCny:0.05},fetcher:async()=>{calls++;await hold;return response([]);}};
 const first=modelJSON(db,'test-only','one','json',[{id:'one'}],options);
 while(!calls)await new Promise(r=>setTimeout(r,1));
 await assert.rejects(modelJSON(db,'test-only','two','json',[{id:'two'}],options),e=>e.code==='budget');
 assert.equal(calls,1);release();await first;sql.close();
});
test('unknown network outcome retains reservation and is not automatically retried',async()=>{
 const {db,sql}=database();let calls=0;const options={fetcher:async()=>{calls++;throw Error('timeout');}};
 await assert.rejects(modelJSON(db,'test-only','analyze','json',[],options));
 assert.ok((await budgetStatus(db)).accountedCny>0);
 await assert.rejects(modelJSON(db,'test-only','analyze','json',[],options));assert.equal(calls,1);sql.close();
});
test('missing key and exhausted budgets never fake AI results',async()=>{
 const {db,sql}=database();await assert.rejects(modelJSON(db,'','test','json',[]),e=>e.code==='missing_key');
 await assert.rejects(modelJSON(db,'test-only','test','json',[],{config:{...policy,dailyBudgetCny:0}}),e=>e.code==='budget');assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_calls').get().n,0);sql.close();
});
test('complete pipeline persists every stage, handles mirrors and publishes only derived fields',async()=>{
 const {db,sql}=database();const rawFetch=globalThis.fetch;let modelCalls=0;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.redirect,'manual');modelCalls++;const body=JSON.parse(options.body),items=JSON.parse(body.messages[1].content).items;assert.equal(items.length,1);if(items[0].candidates)assert.ok(items[0].candidates.every(c=>/^candidate-\d+$/.test(c.id)));
   return response(items.map(x=>x.candidates?{id:x.id,eventId:x.candidates[0].id,relation:'same_event',confidence:0.97,reason:'同一具体模型发布'}:analysis(x.id)));};
 try{
   const entries=[entry(),entry('b','two','Independent report on TestModel 9 AI release'),entry('c','mirror'),entry('d','one','优惠券领取')];
   await ingest(db,entries);await ingest(db,entries);
   assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_items').get().n,4);
   const seed={entries:[],health:[]};for(const stage of ['analyze','deduplicate','group','score','publish'])await runPipeline(db,sources,seed,'test-only',stage);
   const published=await getSetting(db,'news_publication_v3',null);assert.equal(published.stories.length,1);assert.equal(published.hot[0].scoreParts.heat,2);
   assert.equal(published.hot[0].scoreParts.importance,75);assert.equal(published.daily[0].articles[0].title,'OpenAI 发布 TestModel 9');assert.equal(published.ranking.mode,'editorial_priority');assert.equal(published.hot[0].priority.eligible,true);
   assert.ok(!JSON.stringify(published).includes('A new AI model with a released evaluation.'));
   assert.equal(sql.prepare("SELECT COUNT(*) n FROM pipeline_steps WHERE stage='collect'").get().n,4);
   assert.equal(sql.prepare("SELECT status FROM pipeline_items WHERE id='d'").get().status,'filtered');
   assert.ok(modelCalls>0);const before=modelCalls;await runPipeline(db,sources,seed,'test-only','analyze');assert.equal(modelCalls,before);
   const recorded=JSON.stringify(published);await getSetting(db,'news_publication_v3',null);assert.equal(JSON.stringify(await getSetting(db,'news_publication_v3',null)),recorded);
 }finally{globalThis.fetch=rawFetch;sql.close();}
});
test('hot ranking uses persisted editorial priority while daily ranking keeps importance',()=>{
 const at=new Date().toISOString(),make=(id,heat,importance,priorityScore)=>({id,title:id,takeaway:id,bullets:[],topic:'公司动态',source:'x',sourceId:'x',url:'https://x.test/'+id,links:[],publishedAt:at,firstPublishedAt:at,scoreParts:{heat,importance,reliability:90},priority:{eligible:true},priorityScore});
 const stories=[make('widely-reported',8,85,85),make('important',1,90,80)];
 assert.equal(selectHot(stories,Date.now())[0].id,'widely-reported');assert.equal(editions(stories,at).daily[0].articles[0].id,'important');
 assert.ok(ruleFilter(entry('sale','one','black friday deals')));
});
test('automatic batches publish immediately and resume persisted work to completion',async()=>{
 const {db,sql}=database(),original=globalThis.fetch;globalThis.fetch=async(_url,options)=>{const items=JSON.parse(JSON.parse(options.body).messages[1].content).items;return response(items.map(x=>x.candidates?{id:x.id,eventId:x.candidates[0].id,relation:'same_event',confidence:0.95,reason:'同一具体事件'}:analysis(x.id)));};
 try{const seed={entries:Array.from({length:8},(_,i)=>entry('item'+i)),health:[]};
   const first=await runPipeline(db,sources,seed,'test-only');assert.equal(first.complete,false);assert.ok(first.processed>0);assert.ok(first.pending>0);assert.equal((await getSetting(db,'news_publication_v3',null)).stories.length,1);
   const second=await runPipeline(db,sources,seed,'test-only');assert.equal(second.complete,true);assert.equal(second.pending,0);assert.equal(await getSetting(db,'pipeline_phase',''),'collect');
 }finally{globalThis.fetch=original;sql.close();}
});
test('public read path does not invoke grouping, scoring or model calls',()=>{
 const file=fs.readFileSync(new URL('../lib/news-store.ts',import.meta.url),'utf8'),body=file.slice(file.indexOf('export async function publicState'),file.indexOf('export async function refreshNews'));
 assert.doesNotMatch(body,/clusterEntries\(|scoreGroup\(|modelJSON\(|buildDailyEditions\(|\.run\(|\.batch\(/);
 assert.match(body,/getSetting\(database\(\),'news_publication_v3'/);
});
test('source-observed primary citations flow through model validation into persisted priority without inflating heat',async()=>{
 const {db,sql}=database(),original=globalThis.fetch,url='https://lab.example/research/model';
 const catalog=[{...sources[0],primary:false},{...sources[1],adapter:'rss',primary:true,website:'https://lab.example/news'}];
 globalThis.fetch=async(_url,options)=>{const items=JSON.parse(JSON.parse(options.body).messages[1].content).items;assert.equal(items[0].primaryLinks[0].url,url);return response(items.map(x=>({...analysis(x.id),editorial:{newFact:true,uncertain:false,insufficientEvidence:false},primaryEvidenceUrls:[url]})));};
 try{await ingest(db,[{...entry(),evidenceLinks:[{url,label:'Original research',context:'The original study describes this model.'}]}]);
   for(const stage of ['analyze','deduplicate','group','score','publish'])await runPipeline(db,catalog,{entries:[],health:[]},'test-only',stage);
   const state=await getSetting(db,'news_publication_v3',null),story=state.hot[0];assert.equal(story.verification,'引有一手材料');assert.equal(story.scoreParts.heat,1);assert.equal(story.primaryEvidence[0].url,url);
   const persisted=JSON.parse(sql.prepare("SELECT result FROM pipeline_steps WHERE item_id=? AND stage='score'").get(story.id).result);assert.equal(persisted.priority.score,story.priorityScore);
   assert.equal(story.priority.quality.method,'model');
 }finally{globalThis.fetch=original;sql.close();}
});
test('targeted audit processes only requested pending rows and rejects invalid selections',async()=>{
 const {db,sql}=database(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,options)=>{calls++;const items=JSON.parse(JSON.parse(options.body).messages[1].content).items;assert.deepEqual(items.map(x=>x.id),['older']);return response(items.map(x=>analysis(x.id)));};
 try{await ingest(db,[entry('newer'),{...entry('older'),publishedAt:new Date(Date.now()-23*3600000).toISOString()}]);
   await runPipeline(db,sources,{entries:[],health:[]},'test-only','analyze',['older']);
   assert.equal(sql.prepare("SELECT status FROM pipeline_items WHERE id='newer'").get().status,'collected');
   assert.equal(sql.prepare("SELECT status FROM pipeline_items WHERE id='older'").get().status,'analyzed');
   await runPipeline(db,sources,{entries:[],health:[]},'test-only','analyze',['older']);assert.equal(calls,1);
   for(const ids of [[],['x','x'],['x\' OR 1=1'],Array.from({length:7},(_,i)=>'x'+i)])assert.equal(validSelection('analyze',ids),false);
   assert.equal(validSelection('auto',['older']),false);
 }finally{globalThis.fetch=original;sql.close();}
});
test('absence of AI keywords is not evidence of irrelevance; empty URLs never deduplicate',()=>{
 assert.equal(ruleFilter({title:'Neocloud operator Nscale loses a data center order',summary:''},{filterAI:true}),null);
 assert.equal(ruleFilter({title:'明天天气预报',summary:''},{filterAI:true}),'明显非 AI 内容');
 assert.equal(duplicate({url:'',title:'One'},{url:'',title:'Another'}),false);
 assert.equal(duplicate({url:'https://x.test/a?utm_source=rss',title:'One'},{url:'https://x.test/a',title:'Another'}),true);
});
test('grouping evidence remains bounded and is never copied into public story fields',()=>{
 const row={id:'a',published_at:new Date().toISOString(),analysis:analysis('a'),raw:{...entry(),summary:'<p>'+ '原始摘要'.repeat(600)+'</p>'}};
 let candidate=eventCandidate(row);assert.ok(candidate.evidence[0].excerpt.length<=policy.groupingEvidenceChars);assert.doesNotMatch(candidate.evidence[0].excerpt,/<p>/);
 for(let i=0;i<5;i++)candidate=addEventEvidence(candidate,eventCandidate({...row,id:'x'+i}));
 assert.equal(candidate.evidence.length,policy.groupingEvidenceReports);
 const publicStory=scoreGroup([{...row,source_id:'one',raw:JSON.stringify(row.raw),analysis:JSON.stringify(row.analysis)}],new Map(sources.map(s=>[s.id,s])),{id:'event'},Date.now());
 assert.ok(!JSON.stringify(publicStory).includes('原始摘要'));
});
test('reprocessing can split an erroneous event without overwriting its other members',async()=>{
 const {db,sql}=database(),original=globalThis.fetch;let split=false;
 globalThis.fetch=async(_url,options)=>{const items=JSON.parse(JSON.parse(options.body).messages[1].content).items;return response(items.map(x=>x.candidates?{id:x.id,eventId:split?null:x.candidates[0].id,relation:split?'new':'same_event',confidence:0.97,reason:split?'不同真实动作':'同一发布'}:analysis(x.id)));};
 const seed={entries:[],health:[]};
 try{await ingest(db,[entry('a'),{...entry('b','two','Another report'),publishedAt:new Date(Date.now()-1000).toISOString()}]);
   for(const stage of ['analyze','deduplicate','group'])await runPipeline(db,sources,seed,'test-only',stage);
   const old=sql.prepare("SELECT event_id FROM pipeline_items WHERE id='a'").get().event_id;
   assert.equal(sql.prepare("SELECT event_id FROM pipeline_items WHERE id='b'").get().event_id,old);
   split=true;await runPipeline(db,sources,seed,'test-only','reprocess',['a']);
   for(const stage of ['analyze','deduplicate','group'])await runPipeline(db,sources,seed,'test-only',stage,['a']);
   assert.notEqual(sql.prepare("SELECT event_id FROM pipeline_items WHERE id='a'").get().event_id,old);
   assert.equal(sql.prepare("SELECT event_id FROM pipeline_items WHERE id='b'").get().event_id,old);
   const previous=JSON.parse(sql.prepare("SELECT result FROM pipeline_steps WHERE item_id='a' AND stage='reprocess'").get().result);
   assert.equal(previous.previousEventId,old);assert.equal(previous.previousAnalysis.title,analysis('a').title);
   await runPipeline(db,sources,seed,'test-only','score');await runPipeline(db,sources,seed,'test-only','publish');assert.equal((await getSetting(db,'news_publication_v3',{})).stories.length,2);
   assert.equal(validSelection('reprocess',undefined),false);
 }finally{globalThis.fetch=original;sql.close();}
});
test('grouping uses source evidence and records rejected low-confidence and backward follow-ups',async()=>{
 for(const [relation,confidence] of [['same_event',0.85],['follow_up',0.99]]){
   const {db,sql}=database(),original=globalThis.fetch;
   globalThis.fetch=async(_url,options)=>{const items=JSON.parse(JSON.parse(options.body).messages[1].content).items;return response(items.map(x=>{if(!x.candidates)return analysis(x.id);assert.match(x.evidence[0].excerpt,/new AI model/);assert.ok(x.candidates[0].evidence.length);return {id:x.id,eventId:x.candidates[0].id,relation,confidence,reason:'test'};}));};
   try{await ingest(db,[entry('a'),{...entry('b','two','Another report'),publishedAt:new Date(Date.now()-1000).toISOString()}]);for(const stage of ['analyze','deduplicate','group'])await runPipeline(db,sources,{entries:[],health:[]},'test-only',stage);
     assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_events').get().n,2);assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_events WHERE parent_id IS NOT NULL').get().n,0);
     const result=JSON.parse(sql.prepare("SELECT result FROM pipeline_steps WHERE item_id='b' AND stage='group'").get().result);assert.equal(result.merged,false);assert.equal(result.followUp,false);assert.ok(result.candidateIds.length);
   }finally{globalThis.fetch=original;sql.close();}
 }
});
test('time-limited model batches resume without repeating completed paid analyses',async()=>{
 const {db,sql}=database(),original=globalThis.fetch,priorBudget=policy.modelStageTimeBudgetMs;let calls=0;
 globalThis.fetch=async(_url,options)=>{calls++;const items=JSON.parse(JSON.parse(options.body).messages[1].content).items;assert.equal(items.length,1);return response(items.map(x=>analysis(x.id)));};
 try{policy.modelStageTimeBudgetMs=0;await ingest(db,[entry('a'),entry('b','two','A distinct source report')]);
   const first=await runPipeline(db,sources,{entries:[],health:[]},'test-only','analyze',['a','b']);assert.equal(first.processed,1);assert.equal(first.remainingSelected,1);
   const next=await runPipeline(db,sources,{entries:[],health:[]},'test-only','analyze',['a','b']);assert.equal(next.remainingSelected,0);assert.equal(calls,2);
 }finally{policy.modelStageTimeBudgetMs=priorBudget;globalThis.fetch=original;sql.close();}
});
test('one invalid candidate reference does not poison other articles in the batch',async()=>{
 const {db,sql}=database(),original=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{const items=JSON.parse(JSON.parse(options.body).messages[1].content).items;assert.equal(items.length,1);const x=items[0];return response([x.candidates?{id:x.id,eventId:x.id==='b'?'candidate-99':x.candidates[0].id,relation:'same_event',confidence:0.96,reason:'test'}:analysis(x.id)]);};
 try{await ingest(db,[entry('a'),entry('b','two','Second'),entry('c','two','Third')]);for(const stage of ['analyze','deduplicate','group'])await runPipeline(db,sources,{entries:[],health:[]},'test-only',stage);
   assert.equal(sql.prepare("SELECT status FROM pipeline_items WHERE id='b'").get().status,'error');
   assert.equal(sql.prepare("SELECT status FROM pipeline_items WHERE id='c'").get().status,'grouped');
   assert.equal(sql.prepare("SELECT event_id FROM pipeline_items WHERE id='a'").get().event_id,sql.prepare("SELECT event_id FROM pipeline_items WHERE id='c'").get().event_id);
 }finally{globalThis.fetch=original;sql.close();}
});

test('calendar intake preserves first-seen, invalidates changed schedules and publishes old-announced future events outside news',async()=>{
 const {db,sql}=database(),original=globalThis.fetch;
 const future=new Date(Date.now()+30*86400000).toISOString().slice(0,10),old='2020-01-01T00:00:00.000Z';
 const raw={...entry('calendar'),activityListing:true,publicationDateKnown:false,publishedAt:old,activityCandidate:{date:future,endDate:future,location:'上海',format:'offline',kind:'meetup',url:'https://example.test/calendar',status:'scheduled',dateEvidence:'private evidence'}};
 globalThis.fetch=async(_url,options)=>{const item=JSON.parse(JSON.parse(options.body).messages[1].content).items[0];return response([{...analysis(item.id),topic:'线下活动',editorial:{newFact:true,uncertain:false,insufficientEvidence:false}}]);};
 try{
  await ingest(db,[raw]);assert.equal(sql.prepare('SELECT status FROM pipeline_items').get().status,'collected');
  const seed={entries:[],health:[]};for(const stage of ['analyze','deduplicate','group','score','publish'])await runPipeline(db,sources,seed,'test-only',stage);
  const state=await getSetting(db,'news_publication_v3',null);assert.equal(state.activities.length,1);assert.equal(state.activities[0].activity.date,future);assert.equal(state.activities[0].activity.dateEvidence,undefined);assert.equal(state.hot.length,0);assert.ok(state.daily.every(x=>x.articles.length===0));
  await ingest(db,[{...raw,publishedAt:new Date().toISOString()}]);assert.equal(sql.prepare('SELECT status FROM pipeline_items').get().status,'grouped');assert.equal(sql.prepare('SELECT published_at FROM pipeline_items').get().published_at,old);
  await ingest(db,[{...raw,publishedAt:new Date().toISOString(),activityCandidate:{...raw.activityCandidate,location:'北京'}}]);
  const row=sql.prepare('SELECT * FROM pipeline_items').get();assert.equal(row.status,'collected');assert.equal(row.analysis,null);assert.equal(row.published_at,old);
 }finally{globalThis.fetch=original;sql.close();}
});

test('intake accepts only the fixed 24-hour news window, including its boundaries, and retains future activity listings',async()=>{
 const {db,sql}=database(),end='2026-10-28T13:00:00.000Z',start='2026-10-27T13:00:00.000Z';
 try{
  const samples=[['start',start],['end',end],['old','2026-10-27T12:59:59.999Z'],['future','2026-10-28T13:00:00.001Z'],['invalid','bad']].map(([id,publishedAt])=>({...entry(id),publishedAt}));
  samples.push({...entry('activity'),publishedAt:'2020-01-01T00:00:00Z',activityListing:true,activityCandidate:{date:'2026-11-01',url:'https://example.test/activity'}});
  assert.equal(await ingest(db,samples,{start,end}),3);
  assert.deepEqual(sql.prepare('SELECT id FROM pipeline_items ORDER BY id').all().map(x=>x.id),['activity','end','start']);
 }finally{sql.close();}
});
test('retiring historical pending news preserves raw data, paid receipts and published archives without network calls',async()=>{
 const {db,sql}=database(),original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('must not fetch or bill');};
 try{
  const oldDate=new Date(Date.now()-7*86400000).toISOString();
  await ingest(db,[{...entry('old'),publishedAt:oldDate}],{start:oldDate,end:oldDate});
  sql.prepare("UPDATE pipeline_items SET status='deduplicated',analysis=? WHERE id='old'").run(JSON.stringify(analysis('old')));
  const before=sql.prepare("SELECT raw,analysis FROM pipeline_items WHERE id='old'").get();
  await db.batch([settingStatement(db,'news_publication_v3',{processedAt:'original-publication',pipeline:{pending:1},hot:[{id:'published'}],daily:[{id:'archive'}]})]);
  const result=await runPipeline(db,sources,{entries:[],health:[]},'test-only','archive');
  assert.equal(result.processed,1);assert.equal(result.pending,0);
  assert.equal(sql.prepare("SELECT status FROM pipeline_items WHERE id='old'").get().status,'archived');
  assert.deepEqual(sql.prepare("SELECT raw,analysis FROM pipeline_items WHERE id='old'").get(),before);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_calls').get().n,0);
  const snapshot=await getSetting(db,'news_publication_v3',null);assert.equal(snapshot.processedAt,'original-publication');assert.deepEqual(snapshot.daily,[{id:'archive'}]);assert.equal(snapshot.pipeline.pending,0);
  await runPipeline(db,sources,{entries:[],health:[]},'test-only','reprocess',['old']);
  await runPipeline(db,sources,{entries:[],health:[]},'test-only','analyze');
  assert.equal(sql.prepare("SELECT status FROM pipeline_items WHERE id='old'").get().status,'archived');
 }finally{globalThis.fetch=original;sql.close();}
});
test('daily source batches and resumed processing keep one window instead of moving with wall time',async()=>{
 const {db,sql}=database(),original=globalThis.fetch,end='2026-10-28T13:00:00.000Z',start='2026-10-27T13:00:00.000Z';
 const catalog=Array.from({length:5},(_,i)=>({id:'feed'+i,name:'Feed',adapter:'rss',feed:'https://feed.test/'+i}));
 globalThis.fetch=async url=>new Response(`<rss><channel><item><title>优惠券领取</title><link>${url}/inside</link><pubDate>${start}</pubDate></item><item><title>AI old</title><link>${url}/old</link><pubDate>2026-10-26T13:00:00Z</pubDate></item><item><title>AI later</title><link>${url}/later</link><pubDate>2026-10-28T13:01:00Z</pubDate></item></channel></rss>`);
 try{
  const seed={entries:[{...entry('old-seed'),publishedAt:'2020-01-01T00:00:00Z'}],health:[]};
  const first=await runPipeline(db,catalog,seed,'','auto',undefined,undefined,{windowEnd:end});assert.equal(first.complete,false);
  assert.deepEqual(await getSetting(db,'news_processing_window',null),{start,end});
  const second=await runPipeline(db,catalog,seed,'','auto',undefined,undefined,{windowEnd:end});assert.equal(second.complete,true);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_items').get().n,5);
  assert.ok(sql.prepare('SELECT published_at FROM pipeline_items').all().every(x=>x.published_at===start));
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_calls').get().n,0);
  assert.equal((await getSetting(db,'news_health',[]))[0].count,1);
 }finally{globalThis.fetch=original;sql.close();}
});

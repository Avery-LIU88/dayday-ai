import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {modelJSON,budgetStatus,chinaDay,usageCost} from '../lib/pipeline-model.mjs';
import {ingest,runPipeline,getSetting} from '../lib/news-pipeline.mjs';
import {validateAnalyses,validateGroups,scoreGroup,selectHot,editions,ruleFilter} from '../lib/pipeline-editorial.mjs';
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
test('model responses reject fabricated IDs, oversized summaries and invalid scores',()=>{
 assert.equal(validateAnalyses({items:[analysis('a')]},['a'])[0].importance,75);
 for(const bad of [{id:'other'},{importance:101},{bullets:['a','b','c','d']},{isAI:'true'}])assert.throws(()=>validateAnalyses({items:[{...analysis('a'),...bad}]},['a']));
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
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.redirect,'manual');modelCalls++;const body=JSON.parse(options.body),items=JSON.parse(body.messages[1].content).items;
   return response(items.map(x=>x.candidates?{id:x.id,eventId:x.candidates[0].id,relation:'same_event',confidence:0.97,reason:'同一具体模型发布'}:analysis(x.id)));};
 try{
   const entries=[entry(),entry('b','two','Independent report on TestModel 9 AI release'),entry('c','mirror'),entry('d','one','优惠券领取')];
   await ingest(db,entries);await ingest(db,entries);
   assert.equal(sql.prepare('SELECT COUNT(*) n FROM pipeline_items').get().n,4);
   const seed={entries:[],health:[]};for(const stage of ['analyze','deduplicate','group','score','publish'])await runPipeline(db,sources,seed,'test-only',stage);
   const published=await getSetting(db,'news_publication_v3',null);assert.equal(published.stories.length,1);assert.equal(published.hot[0].scoreParts.heat,2);
   assert.equal(published.hot[0].scoreParts.importance,75);assert.equal(published.daily[0].articles[0].title,'OpenAI 发布 TestModel 9');
   assert.ok(!JSON.stringify(published).includes('A new AI model with a released evaluation.'));
   assert.equal(sql.prepare("SELECT COUNT(*) n FROM pipeline_steps WHERE stage='collect'").get().n,4);
   assert.equal(sql.prepare("SELECT status FROM pipeline_items WHERE id='d'").get().status,'filtered');
   assert.ok(modelCalls>0);const before=modelCalls;await runPipeline(db,sources,seed,'test-only','analyze');assert.equal(modelCalls,before);
   const recorded=JSON.stringify(published);await getSetting(db,'news_publication_v3',null);assert.equal(JSON.stringify(await getSetting(db,'news_publication_v3',null)),recorded);
 }finally{globalThis.fetch=rawFetch;sql.close();}
});
test('hot ranking and daily ranking deliberately choose different leading events',()=>{
 const at=new Date().toISOString(),make=(id,heat,importance)=>({id,title:id,takeaway:id,bullets:[],topic:'公司动态',source:'x',sourceId:'x',url:'https://x.test/'+id,links:[],publishedAt:at,firstPublishedAt:at,scoreParts:{heat,importance,reliability:100}});
 const stories=[make('widely-reported',8,65),make('important',1,95)];
 assert.equal(selectHot(stories,Date.now())[0].id,'widely-reported');assert.equal(editions(stories,at).daily[0].articles[0].id,'important');
 assert.ok(ruleFilter(entry('sale','one','black friday deals')));
});
test('public read path does not invoke grouping, scoring or model calls',()=>{
 const file=fs.readFileSync(new URL('../lib/news-store.ts',import.meta.url),'utf8'),body=file.slice(file.indexOf('export async function publicState'),file.indexOf('export async function refreshNews'));
 assert.doesNotMatch(body,/clusterEntries\(|scoreGroup\(|modelJSON\(|buildDailyEditions\(|\.run\(|\.batch\(/);
 assert.match(body,/getSetting\(database\(\),'news_publication_v3'/);
});

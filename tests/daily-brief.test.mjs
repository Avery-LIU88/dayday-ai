import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDailyStories,briefExcerpt,buildDailyEditions} from '../lib/daily-brief.mjs';

const at='2026-10-21T12:05:00Z';
const story=(id,extra={})=>({id,title:`产品 ${id} 发布`,summary:'发布了新模型。支持更长上下文。今天开放使用。第四句话。',url:`https://example.com/${id}`,source:'官方',sourceId:'official',language:'zh',topic:'公司动态',firstPublishedAt:'2026-10-21T00:00:00Z',publishedAt:'2026-10-21T00:00:00Z',scoreParts:{importance:27,reliability:10},heatEvidence:{independentReports:1},links:[],...extra});
test('daily selection uses Shanghai calendar day and earliest report, not a later repost',()=>{
 const input=[story('boundary',{firstPublishedAt:'2026-10-20T16:00:00Z'}),story('old',{firstPublishedAt:'2026-10-20T15:59:59Z'}),story('future',{firstPublishedAt:'2026-10-22T01:00:00Z'})];
 assert.deepEqual(selectDailyStories(input,'2026-10-21',Date.parse(at)).map(s=>s.id),['boundary']);
});
test('importance beats heat, all qualifying events survive and weak filler is excluded',()=>{
 const input=[...Array.from({length:9},(_,i)=>story(String(i))),story('important',{score:1,scoreParts:{importance:34,reliability:10}}),story('rumor',{verification:'待核实'}),story('weak',{scoreParts:{importance:16,reliability:10}}),story('roundup',{title:'AI 日报：今日摘要'})];
 const chosen=selectDailyStories(input,'2026-10-21',Date.parse(at));
 assert.equal(chosen.length,10);assert.equal(chosen[0].id,'important');
 assert.ok(!chosen.some(s=>['rumor','weak','roundup'].includes(s.id)));
});
test('source excerpts preserve facts, decimal numbers and sentence boundaries',()=>{
 assert.equal(briefExcerpt('第一句。第二句。第三句。第四句。'),'第一句。第二句。第三句。');
 assert.equal(briefExcerpt('Model 3.5 launches. It is available. Cost is $0.20. Extra.'),'Model 3.5 launches. It is available. Cost is $0.20.');
 assert.equal(briefExcerpt(''),'');
});
test('routine patches and low-value papers stay out',()=>{
 const input=[story('patch',{title:'Patch release v5.20.2'}),story('paper',{topic:'论文与研究',title:'Balancing regulatory risk',scoreParts:{importance:16,reliability:5}}),story('major',{heatEvidence:{independentReports:5},scoreParts:{importance:30,reliability:10}}),story('single',{scoreParts:{importance:34,reliability:5}})];
 assert.deepEqual(selectDailyStories(input,'2026-10-21',Date.parse(at)).map(s=>s.id),['major','single']);
});
test('old editions survive raw feed eviction; unchanged issue keeps actual update time',()=>{
 const first=buildDailyEditions([story('a')],[],at);
 const same=buildDailyEditions([story('a')],[],'2026-10-21T13:00:00Z',first);
 assert.equal(same[0].updatedAt,at);
 const next=buildDailyEditions([],[],'2026-10-25T00:00:00Z',same);
 assert.equal(next.find(x=>x.date==='2026-10-21').articles[0].id,'a');
 assert.deepEqual(next[0].articles,[]);
});
test('Chinese merged report keeps its own source and link; no translation is invented',()=>{
 const s=story('official',{language:'en',title:'Model launches',links:[{id:'zh',publisher:'media'}]});
 const edition=buildDailyEditions([s],[{id:'zh',language:'zh',title:'模型发布',summary:'正式发布。',source:'媒体',url:'https://example.com/zh'}],at);
 assert.equal(edition[0].articles[0].title,'模型发布');
 assert.equal(edition[0].articles[0].url,'https://example.com/zh');
 assert.equal(edition[0].articles[0].source,'媒体');
});
test('busy categories cannot crowd out qualifying model, product or research events',()=>{
 const industry=Array.from({length:12},(_,i)=>story(`funding-${i}`,{title:`Company ${i} funding`,topic:'投融资',scoreParts:{importance:30,reliability:5}}));
 const input=[...industry,story('model',{title:'新模型正式发布'}),story('product',{title:'开发工具上线'}),story('research',{title:'研究团队发布新评测基准',topic:'论文与研究',hasPrimary:false,scoreParts:{importance:22,reliability:5}}),story('policy',{title:'AI 安全法案通过',topic:'政策监管'})];
 const chosen=selectDailyStories(input,'2026-10-21',Date.parse(at));
 assert.equal(chosen.length,16);
 for(const id of ['model','product','research','policy'])assert.ok(chosen.some(s=>s.id===id));
});
test('category coverage never inserts a below-threshold item',()=>{
 const low=story('research',{title:'新论文发布',topic:'论文与研究',hasPrimary:true,scoreParts:{importance:19,reliability:10}});
 assert.deepEqual(selectDailyStories([low],'2026-10-21',Date.parse(at)),[]);
 const eligible=story('research',{...low,scoreParts:{importance:20,reliability:10}});
 assert.equal(selectDailyStories([eligible],'2026-10-21',Date.parse(at)).length,1);
});
test('a financing interview does not duplicate the same company and round in the daily summary',()=>{
 const one=story('round',{title:'Tenstorrent hits $6.2B valuation',topic:'投融资',summary:'Raised $1.5 billion.'});
 const interview=story('interview',{title:'Tenstorrent CEO on New Funding Round',topic:'投融资',summary:'Discussed a $1.5B funding round.'});
 const other=story('other',{title:'OtherCompany raises $1.5B',topic:'投融资'});
 assert.equal(selectDailyStories([one,interview,other],'2026-10-21',Date.parse(at)).length,2);
});

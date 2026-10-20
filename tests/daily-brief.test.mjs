import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDailyStories,briefExcerpt,buildDailyEditions} from '../lib/daily-brief.mjs';

const at='2026-10-21T12:05:00Z';
const story=(id,extra={})=>({id,title:`产品 ${id} 发布`,summary:'发布了新模型。支持更长上下文。今天开放使用。第四句话。',url:`https://example.com/${id}`,source:'官方',sourceId:'official',language:'zh',topic:'公司动态',firstPublishedAt:'2026-10-21T00:00:00Z',publishedAt:'2026-10-21T00:00:00Z',scoreParts:{importance:27,reliability:10},heatEvidence:{independentReports:1},links:[],...extra});
test('daily selection uses Shanghai calendar day and earliest report, not a later repost',()=>{
 const input=[story('boundary',{firstPublishedAt:'2026-10-20T16:00:00Z'}),story('old',{firstPublishedAt:'2026-10-20T15:59:59Z'}),story('future',{firstPublishedAt:'2026-10-22T01:00:00Z'})];
 assert.deepEqual(selectDailyStories(input,'2026-10-21',Date.parse(at)).map(s=>s.id),['boundary']);
});
test('importance beats heat, maximum six and no rumor, roundups or weak filler',()=>{
 const input=[...Array.from({length:9},(_,i)=>story(String(i))),story('important',{score:1,scoreParts:{importance:34,reliability:10}}),story('rumor',{verification:'待核实'}),story('weak',{scoreParts:{importance:16,reliability:10}}),story('roundup',{title:'AI 日报：今日摘要'})];
 const chosen=selectDailyStories(input,'2026-10-21',Date.parse(at));
 assert.equal(chosen.length,6);assert.equal(chosen[0].id,'important');
 assert.ok(!chosen.some(s=>['rumor','weak','roundup'].includes(s.id)));
});
test('source excerpts preserve facts, decimal numbers and sentence boundaries',()=>{
 assert.equal(briefExcerpt('第一句。第二句。第三句。第四句。'),'第一句。第二句。第三句。');
 assert.equal(briefExcerpt('Model 3.5 launches. It is available. Cost is $0.20. Extra.'),'Model 3.5 launches. It is available. Cost is $0.20.');
 assert.equal(briefExcerpt(''),'');
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

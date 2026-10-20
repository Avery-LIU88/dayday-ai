import test from 'node:test';
import assert from 'node:assert/strict';
import {weekRange,selectWeeklyArticles,buildWeeklyEditions} from '../lib/weekly-brief.mjs';

const collected='2026-10-21T00:05:00Z';
const story=(id,extra={})=>({id,title:`Company ${id} launches an AI tool`,summary:'The tool is now available.',
 url:`https://example.com/${id}`,source:'Official',sourceId:'official',language:'en',topic:'公司动态',
 firstPublishedAt:'2026-10-20T00:00:00Z',publishedAt:'2026-10-20T00:00:00Z',
 scoreParts:{importance:25,reliability:10},heatEvidence:{independentReports:1},links:[],...extra});

test('Shanghai weeks start Monday, including year and Sunday midnight boundaries',()=>{
 assert.deepEqual(weekRange('2026-10-18T15:59:59Z'),{date:'2026-10-12',endDate:'2026-10-18'});
 assert.deepEqual(weekRange('2026-10-18T16:00:00Z'),{date:'2026-10-19',endDate:'2026-10-25'});
 assert.deepEqual(weekRange('2027-01-01T00:00:00Z'),{date:'2026-12-28',endDate:'2027-01-03'});
});
test('weekly ranking uses importance, excludes weak/rumor/future/old items and is not capped at six',()=>{
 const stories=Array.from({length:10},(_,i)=>story(String(i)));
 const items=[...stories,story('top',{scoreParts:{importance:34,reliability:10}}),
 story('old',{firstPublishedAt:'2026-10-18T15:59:59Z'}),
 story('future',{firstPublishedAt:'2026-10-22T00:00:00Z'}),
 story('weak',{scoreParts:{importance:19,reliability:10}}),story('rumor',{verification:'待核实'}),
 story('jobs',{topic:'招聘'}),story('roundup',{title:'AI weekly digest'})];
 const selected=selectWeeklyArticles(items,'2026-10-19',Date.parse(collected));
 assert.equal(selected.length,11);assert.equal(selected[0].id,'top');
});
test('one event across multiple days is grouped with attributed developments; versions remain distinct',()=>{
 const items=[story('first',{title:'Acme launches Falcon-7 model',firstPublishedAt:'2026-10-19T00:00:00Z'}),
 story('followup',{title:'Falcon-7 model released with developer access',firstPublishedAt:'2026-10-21T00:00:00Z'}),
 story('different',{title:'Acme launches Falcon-8 model'})];
 const selected=selectWeeklyArticles(items,'2026-10-19',Date.parse(collected));
 assert.equal(selected.length,2);
 const merged=selected.find(a=>a.id==='first');
 assert.equal(merged.developments.length,1);
 assert.equal(merged.developments[0].url,'https://example.com/followup');
 assert.equal(merged.developments[0].firstPublishedAt,'2026-10-21T00:00:00Z');
});
test('daily archive recovers evicted events, then all weekly candidates are reranked and deduplicated',()=>{
 const daily=[{date:'2026-10-19',articles:[{...story('archived'),title:'Historic model released',importance:24}]}];
 const issues=buildWeeklyEditions([story('top',{scoreParts:{importance:34,reliability:10}})],[],collected,daily);
 assert.equal(issues[0].articles.length,2);assert.equal(issues[0].articles[0].id,'top');
 assert.equal(issues[0].date,'2026-10-19');assert.equal(issues[0].endDate,'2026-10-25');
});
test('current week retains evicted stories and real update time; Sunday late events finalize on Monday',()=>{
 const first=buildWeeklyEditions([story('first')],[],collected);
 const same=buildWeeklyEditions([],[],'2026-10-22T00:05:00Z',[],first);
 assert.equal(same[0].articles.length,1);assert.equal(same[0].updatedAt,collected);
 const monday=buildWeeklyEditions([story('late',{firstPublishedAt:'2026-10-25T15:50:00Z'})],[],'2026-10-26T00:05:00Z',[],same);
 const closed=monday.find(e=>e.date==='2026-10-19');
 assert.equal(closed.articles.length,2);assert.equal(closed.finalized,true);
 const later=buildWeeklyEditions([story('change',{firstPublishedAt:'2026-10-25T12:00:00Z'})],[],'2026-11-02T00:05:00Z',[],monday);
 assert.deepEqual(later.find(e=>e.date==='2026-10-19'),closed);
});
test('old events do not reappear in a new week solely because of reposts',()=>{
 const issues=buildWeeklyEditions([story('repost',{firstPublishedAt:'2026-10-15T00:00:00Z',publishedAt:'2026-10-20T00:00:00Z'})],[],collected);
 assert.equal(issues[0].date,'2026-10-19');assert.deepEqual(issues[0].articles,[]);
 assert.equal(issues[1].articles[0].id,'repost');
});
test('retained developments survive subsequent refreshes with the same lead',()=>{
 const items=[story('first',{title:'Acme launches Falcon-7 model',firstPublishedAt:'2026-10-19T00:00:00Z'}),
 story('followup',{title:'Falcon-7 model released with developer access'})];
 const first=buildWeeklyEditions(items,[],collected);
 const next=buildWeeklyEditions([items[0]],[],'2026-10-22T00:05:00Z',[],first);
 assert.equal(next[0].articles.length,1);
 assert.equal(next[0].articles[0].developments.length,1);
});

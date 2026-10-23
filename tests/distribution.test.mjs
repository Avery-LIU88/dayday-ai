import test from 'node:test';
import assert from 'node:assert/strict';
import {eventList,edition,editionText,publishedEditions,scheduledEdition,rss} from '../lib/distribution.mjs';
import {mcpResponse,distributionResponse} from '../lib/distribution-http.mjs';
const article={id:'a',title:'AI <新模型> & 工具',source:'Example',url:'https://example.com/a?x=1&y=2',publishedAt:'2026-10-23T09:00:00Z',takeaway:'提炼要点',summary:'提炼摘要 <img onerror="alert(1)">',bullets:['一','二','三','四'],scoreParts:{heat:30,importance:90,recency:80,reliability:95},raw:'PRIVATE RAW',evidence:'PRIVATE EVIDENCE',bot:'PRIVATE BOT'};
const issue={date:'2026-10-23',updatedAt:'2026-10-23T12:05:00Z',articles:[article,{...article,id:'b',title:'Second'}]};
const state={databaseReady:true,processedAt:'2026-10-23T12:05:00Z',stories:[article,{...article,id:'b',title:'Other event'}],hot:[{...article,id:'b',title:'Other event'},article],daily:[{date:'2026-10-24',articles:[]},issue],weekly:[{...issue,date:'2026-10-19',endDate:'2026-10-25'},{...issue,date:'2026-10-12',endDate:'2026-10-18'}],readers:[{token:'PRIVATE TOKEN'}]};
test('public events keep stored hot ranking, paginate, search, and whitelist fields',()=>{
 const original=JSON.stringify(state),first=eventList(state,{limit:1});
 assert.equal(first.items[0].id,'b');assert.equal(first.nextOffset,1);assert.equal(eventList(state,{offset:1}).items[0].id,'a');
 assert.equal(eventList(state,{feed:'all',q:'新模型'}).total,1);
 assert.equal(first.items[0].scores.importance,90);assert.equal(first.items[0].bullets.length,3);
 assert.doesNotMatch(JSON.stringify(first),/PRIVATE/);assert.equal(JSON.stringify(state),original);
 for(const params of [{limit:51},{offset:-1},{q:'a'.repeat(101)},{feed:'unknown'}])assert.throws(()=>eventList(state,params));
});
test('editions preserve every selected article and order, never choose source stories',()=>{
 const result=edition(state,'daily');assert.equal(result.edition.date,'2026-10-23');
 assert.deepEqual(result.edition.articles.map(a=>a.id),['a','b']);assert.match(editionText(result.edition,'daily'),/1\. AI[\s\S]+2\. Second/);
 assert.throws(()=>edition(state,'daily','2026-02-30'),/YYYY/);assert.throws(()=>edition(state,'daily','2026-10-22'),/尚未发布/);
 assert.equal(publishedEditions({...state,daily:[]},'daily').length,0);
});
test('scheduled daily and weekly use previous complete calendar period, never stale fallback',()=>{
 assert.equal(scheduledEdition(state,'daily',new Date('2026-10-24T00:00Z')).date,'2026-10-23');
 assert.equal(scheduledEdition(state,'daily',new Date('2026-10-25T00:00Z')),null);
 assert.equal(scheduledEdition(state,'weekly',new Date('2026-10-26T00:00Z')).date,'2026-10-19');
 assert.equal(scheduledEdition(state,'weekly',new Date('2026-10-19T00:00Z')).date,'2026-10-12');
});
test('RSS escapes titles, links and HTML descriptions; IDs survive publication changes',()=>{
 const xml=rss(state);assert.match(xml,/<title>AI &lt;新模型&gt; &amp; 工具<\/title>/);
 assert.match(xml,/x=1&amp;y=2/);assert.doesNotMatch(xml,/<img|PRIVATE|content:encoded/);assert.match(xml,/&amp;lt;img/);
 assert.equal(xml.match(/<item>/g).length,2);
 const next=rss({...state,processedAt:'2026-10-24T00:00Z'});
 assert.deepEqual([...xml.matchAll(/<guid[^>]*>(.*?)<\/guid>/g)].map(m=>m[1]),[...next.matchAll(/<guid[^>]*>(.*?)<\/guid>/g)].map(m=>m[1]));
 assert.match(rss(state,'daily'),/#daily\?date=2026-10-23/);assert.match(rss(state,'weekly'),/AI 周报/);
});
test('HTTP endpoints return explicit availability and parameter errors with public CORS',async()=>{
 let reads=0;const read=async()=>{reads++;return state;};
 const docs=await distributionResponse(new Request('https://site/api/v1'),'docs',read);assert.equal(docs.status,200);assert.equal(reads,0);
 const ok=await distributionResponse(new Request('https://site/api/v1/events'),'events',read);assert.equal(ok.headers.get('access-control-allow-origin'),'*');
 assert.equal((await distributionResponse(new Request('https://site/?limit=999'),'events',read)).status,400);
 assert.equal((await distributionResponse(new Request('https://site/?date=2020-01-01'),'daily',read)).status,404);
 assert.equal((await distributionResponse(new Request('https://site/'),'events',async()=>({...state,databaseReady:false}))).status,503);
});
test('MCP discovery does not read data; tools use exactly the same public projections',async()=>{
 let reads=0;const read=async()=>{reads++;return state;};
 const call=async(method,params,id=1)=>{const response=await mcpResponse(new Request('https://site/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id,method,params})}),read);return response.json();};
 assert.ok((await call('server/discover')).result.supportedVersions.includes('2026-07-28'));
 assert.equal((await call('initialize',{protocolVersion:'2025-11-25'})).result.protocolVersion,'2025-11-25');
 const list=(await call('tools/list')).result.tools;assert.equal(list.length,2);assert.ok(list.every(t=>t.annotations.readOnlyHint));assert.equal(reads,0);
 const events=(await call('tools/call',{name:'dayday_events',arguments:{feed:'all',limit:1}})).result;
 assert.deepEqual(JSON.parse(events.content[0].text),eventList(state,{feed:'all',limit:1}));
 const brief=(await call('tools/call',{name:'dayday_brief',arguments:{kind:'daily'}})).result;
 assert.deepEqual(JSON.parse(brief.content[0].text),edition(state,'daily'));assert.doesNotMatch(JSON.stringify(brief),/PRIVATE/);
 assert.equal((await call('tools/call',{name:'dayday_events',arguments:{limit:'1'}})).result.isError,true);
 assert.equal((await call('tools/call',{name:'dayday_events',arguments:{url:'https://private'}})).result.isError,true);
 assert.equal((await call('tools/call',{name:'send_feishu'})).error.code,-32602);
 assert.equal((await call('unknown')).error.code,-32601);
 const notification=await mcpResponse(new Request('https://site/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})}),read);assert.equal(notification.status,202);
 const malformed=await mcpResponse(new Request('https://site/mcp',{method:'POST',body:'bad'}),read);assert.equal((await malformed.json()).error.code,-32700);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {clusterEntries,canonicalUrl,similarTitle,hotStories,dayKey} from '../lib/dayday-core.mjs';
import {collectSource,parseArticle,parseDatedList,parsePublisherList,parseProductUpdates,parseStructured,relevant,extractSnippet} from '../lib/news-collector.mjs';
const now=Date.parse('2026-10-20T08:00:00Z');
const base={kind:'article',id:'a',title:'OpenAI releases a new open source model for coding',summary:'Research benchmark for AI agents.',url:'https://example.com/news/a',publishedAt:'2026-10-20T06:00:00Z',sourceId:'a',source:'A',language:'en',topics:['公司动态']};
test('tracking links merge while preserving distinct publishers and all original links',()=>{
 const stories=clusterEntries([base,{...base,id:'b',sourceId:'b',source:'B',url:base.url+'?utm_source=mail'}],[{id:'a',publisher:'a',primary:true,section:'公司动态'},{id:'b',publisher:'b',section:'媒体资讯'}],now);
 assert.equal(stories.length,1);assert.equal(stories[0].coverage,2);assert.equal(stories[0].links.length,2);assert.ok(stories[0].tags.includes('媒体资讯'));assert.equal(stories[0].scoreParts.breadth,5);
});
test('multiple endpoints from one publisher cannot inflate breadth',()=>{
 const [s]=clusterEntries([base,{...base,id:'b',sourceId:'b'}],[{id:'a',publisher:'same'},{id:'b',publisher:'same'}],now);
 assert.equal(s.coverage,1);assert.equal(s.scoreParts.breadth,0);
});
test('model versions stay separate',()=>{
 assert.equal(similarTitle('OpenAI introduces model GPT 5.1 for all coding developers','OpenAI introduces model GPT 5.2 for all coding developers'),false);
 const stories=clusterEntries([base,{...base,id:'b',title:base.title+' version 2',url:'https://example.com/b'}],[],now);assert.equal(stories.length,2);
});
test('unsafe URLs, invalid dates, future publications are excluded',()=>{
 assert.equal(canonicalUrl('javascript:alert(1)'),'');
 assert.equal(clusterEntries([{...base,url:'javascript:alert(1)'},{...base,publishedAt:'bad'},{...base,publishedAt:'2027-01-01'}],[],now).length,0);
});
test('scores explain their total; jobs and old stories stay out of hot ranking',()=>{
 const items=clusterEntries([base,{...base,id:'job',url:'https://example.com/jobs',sourceId:'jobs',publishedAt:'2026-10-20T05:00:00Z',title:'Hiring an AI researcher'},{...base,id:'old',title:'Old research',url:'https://example.com/old',publishedAt:'2026-09-01T00:00:00Z'}],[{id:'jobs',section:'招聘'}],now);
 for(const s of items){assert.equal(s.score,Object.values(s.scoreParts).reduce((a,b)=>a+b,0));assert.ok(s.score>=0&&s.score<=100);}
 assert.equal(hotStories(items,now).length,1);
});
test('Shanghai brief boundaries differ from UTC',()=>{assert.equal(dayKey('2026-10-19T18:00:00Z'),'2026-10-20');});
test('AI filtering suppresses unrelated general media',()=>{
 assert.equal(relevant({...base,title:'A guide to house prices',summary:'Local residential property'}, {filterAI:true}),false);
 assert.equal(relevant({...base,title:'Claude model release',summary:''},{filterAI:true}),true);
 assert.equal(relevant({...base,title:'双11华为平板国补优惠',summary:'AI model research launch'},{filterAI:true}),false);
});
test('encoded HTML and boilerplate never appear in summaries',()=>{
 assert.equal(extractSnippet('&lt;p&gt;AI &amp; research&lt;/p&gt;'),'AI & research');
 assert.equal(extractSnippet('&lt;script&gt;alert(1)&lt;/script&gt;Useful AI news'),'Useful AI news');
 assert.ok(extractSnippet('x'.repeat(1000)).length<=321);
});
test('article adapter requires a publication date, never substitutes collection time',()=>{
 const source={id:'test',name:'Test',section:'公司动态',language:'en'};
 assert.equal(parseArticle('<meta property=\"og:title\" content=\"Story\">','https://example.com/a',source),null);
 const e=parseArticle('<meta content=\"2026-10-19T12:00:00Z\" property=\"article:published_time\"><meta property=\"og:title\" content=\"Story\">','https://example.com/a',source);assert.equal(e.title,'Story');assert.equal(e.publishedAt,'2026-10-19T12:00:00.000Z');
});
test('RSS collector rejects HTML responses and returns stable IDs on repeated collection',async()=>{
 const source={id:'test',name:'Test',website:'https://example.com',feed:'https://example.com/feed',adapter:'rss',section:'公司动态',language:'en'};
 await assert.rejects(()=>collectSource(source,async()=>new Response('<html>Log in</html>')),/RSS/);
 const rss='<rss><channel><item><title>New AI model</title><link>https://example.com/model</link><pubDate>Mon, 19 Oct 2026 08:00:00 GMT</pubDate><description>Model launch</description></item></channel></rss>';
 const a=await collectSource(source,async()=>new Response(rss)),b=await collectSource(source,async()=>new Response(rss));assert.equal(a.items[0].id,b.items[0].id);assert.ok(a.items[0].topics.includes('产品发布'));
});
test('dated newsletter links retain the real issue title and date',()=>{
 const [item]=parseDatedList('<a href=\"/ai/2026-10-19\"><div><time dateTime=\"2026-10-19\">Oct 19, 2026</time>New AI model</div></a>',{id:'tldr',name:'TLDR',adapter:'tldr',website:'https://tldr.tech',section:'Newsletter'});
 assert.equal(item.title,'New AI model');assert.equal(item.publishedAt,'2026-10-19T00:00:00.000Z');
});
test('publisher cards deduplicate repeated links without inventing dates',()=>{
 const source={id:'moonshot',adapter:'kimi',name:'Kimi',website:'https://www.kimi.com',section:'公司动态'};
 const card='<div class="menu-card x"><a href="/en/blog/kimi-k2"></a><h4>Kimi K2</h4><p class="card-date x">2025-07-11</p></div>';
 const items=parsePublisherList(card+card+card.replace('2025-07-11','Coming soon'),source);
 assert.equal(items.length,1);assert.equal(items[0].publishedAt,'2025-07-11T00:00:00.000Z');
});
test('stepfun reads literal public news fields without executing downloaded JS',()=>{
 const source={id:'stepfun',adapter:'stepfun',name:'StepFun',website:'https://www.stepfun.com',section:'公司动态'};
 const js='throw Error("must not execute");const data=[{slug:"model",date:"2026-09-20",dateLabel:"2026年9月20日",title:"A \\"new\\" AI model"}]';
 const [e]=parsePublisherList(js,source);assert.equal(e.title,'A "new" AI model');assert.equal(e.url,'https://www.stepfun.com/news/model');
});
test('article publication header wins over recommendation dates',()=>{
 const [id,date]=['jazzyear','2025-08-20'];
 const html='<title>AI news</title><div class="time">2026-10-19</div><div class="author-header"><span class="time">'+date+'</span></div>';
 assert.equal(parseArticle(html,'https://example.com/a',{id,name:'甲子光年'}).publishedAt,'2025-08-20T00:00:00.000Z');
 assert.equal(parseArticle('<title>AI</title><script>var release_time= "2025/12/31";</script>','https://example.com/a',{id:'latepost'}).publishedAt,'2025-12-31T00:00:00.000Z');
});
test('public Tencent timestamps preserve seconds and public article URLs',()=>{
 const [e]=parseStructured(JSON.stringify({data:{list:[{id:1,title:'Hy research',lang:'en',customUrl:'hy3',displayPublishTime:1776873600,desc:'Summary'}]}}),{adapter:'tencent-blog',id:'tencent'});
 assert.equal(e.publishedAt,new Date(1776873600*1000).toISOString());assert.equal(e.url,'https://hunyuan.tencent.com/research/hy3?langVersion=en');
});
test('paper API excludes undated and future results instead of treating them as new',()=>{
 const source={adapter:'semantic',id:'semantic'};
 const data={data:[{title:'AI',url:'https://www.semanticscholar.org/paper/a',publicationDate:'2026-01-01'},{title:'Future',url:'https://example.com/f',publicationDate:'2099-01-01'},{title:'Unknown',url:'https://example.com/u'}]};
 assert.equal(parseStructured(JSON.stringify(data),source).length,1);
});
test('LatePost reads the article year, not the yearless list date',async()=>{
 const source={id:'latepost',name:'晚点',adapter:'latepost-api',feed:'https://www.latepost.com/news/get-news-data',website:'https://www.latepost.com/',linkPattern:'^/news/dj_detail$',filterAI:true};
 const requests=[];const result=await collectSource(source,async(url,opts)=>{
  requests.push([url,opts.method]);
  return new Response(url===source.feed?JSON.stringify({data:[{title:'AI model',release_time:'12月31日',detail_url:'/news/dj_detail?id=1'}]}):'<title>AI model</title><script>var release_time= "2025/12/31";</script>');
 });
 assert.equal(requests[0][1],'POST');assert.equal(result.items[0].publishedAt,'2025-12-31T00:00:00.000Z');
});
test('conference notices use their announcement date, not a deadline in the headline',()=>{
 const [e]=parsePublisherList('<table class="news-table"><tr><td>Sep. 2, 2026</td><td><a href="/sponsors">Final call (Sep 15)</a></td></tr></table>',{adapter:'emnlp-news',website:'https://2026.emnlp.org/',id:'emnlp'});
 assert.equal(e.publishedAt,'2026-09-02T00:00:00.000Z');assert.equal(e.dateLabel,'公告发布');
});
test('product changelogs retain publisher years and distinct daily links',()=>{
 const source={adapter:'xai-updates',id:'xai-updates',website:'https://docs.x.ai/developers/release-notes'};
 const block=(date,id)=>`<div class="relative mt-12 grid x"><div class="relative">${date}<span>x</span></div><h3 id="${id}">Model ${id}</h3><p>AI update</p></div>`;
 const html='<script>{"dateModified":"2026-10-13"}</script><h2 id="october">October</h2>'+block('October 14','a')+'<h2 id="december-2025">December 2025</h2>'+block('Dec 16','b');
 const items=parseProductUpdates(html,source);assert.equal(items.length,2);assert.equal(items[1].publishedAt,'2025-12-16T00:00:00.000Z');assert.notEqual(canonicalUrl(items[0].url),canonicalUrl(items[1].url));
 const sameDay=parseProductUpdates('<script>{"dateModified":"2026-10-13"}</script><h2>October</h2>'+block('October 14','a')+block('October 14','b'),source);
 assert.notEqual(canonicalUrl(sameDay[0].url),canonicalUrl(sameDay[1].url));
 assert.equal(parseProductUpdates(html.replace('"dateModified"','"unknown"'),source).length,0);
 const [z]=parseProductUpdates('<Update label="2026-01-14" description="GLM-Image">* See [docs](/guides/image)</Update>',{adapter:'zai-updates',website:'https://docs.z.ai/release-notes/new-released'});
 assert.equal(z.publishedAt,'2026-01-14T00:00:00.000Z');assert.equal(z.title,'GLM-Image');
});

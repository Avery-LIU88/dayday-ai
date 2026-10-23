import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreGroup,selectHot,validateAnalyses} from '../lib/pipeline-editorial.mjs';
import {editorialQuality,editorialPriority,primaryLinkCandidates} from '../lib/editorial-priority.mjs';
import {parseFeed} from '../lib/feed.mjs';
import {eventList} from '../lib/distribution.mjs';
const now=Date.parse('2026-10-24T04:00:00Z'),at='2026-10-24T01:00:00Z';
const sources=new Map([['official',{primary:true,name:'官方',website:'https://lab.example/news',publisher:'lab'}],['media',{name:'媒体',website:'https://media.example',publisher:'media'}],['repo',{primary:true,name:'官方仓库',website:'https://github.com/lab/repo',publisher:'lab'}]]);
const analysis=(id,importance=85,extra={})=>({id,isAI:true,title:'New AI model released',takeaway:'Released a model with new capabilities.',bullets:['Supports a new task.'],importance,reasons:['可核对的产品新能力'],entities:['TestModel'],action:'Release TestModel',topic:'公司动态',editorial:{newFact:true,uncertain:false,insufficientEvidence:false},...extra});
const row=(id='a',source='official',importance=85,extra={})=>({id,source_id:source,published_at:at,updated_at:at,duplicate_of:null,raw:JSON.stringify({id,title:'New AI model',source:source,url:`https://${source}.example/${id}`,summary:'Public release summary',topics:[]}),analysis:JSON.stringify(analysis(id,importance)),...extra});
const event=(rows,id='evt')=>scoreGroup(rows,sources,{id},now);
test('an important original release outranks a widely covered incremental update; marketing never buys first place',()=>{
 const major=event([row('major','official',90)],'major'),minor=event(Array.from({length:8},(_,i)=>row('minor'+i,'media'+i,62)),'minor');
 const marketing=event(Array.from({length:30},(_,i)=>row('ad'+i,'ad'+i,55)),'ad');
 assert.deepEqual(selectHot([marketing,minor,major],now).map(x=>x.id),['major','minor']);
 assert.equal(major.scoreParts.heat,1);assert.equal(marketing.priority.eligible,false);
 assert.ok(major.priorityScore>minor.priorityScore);
});
test('primary evidence materially improves priority without turning an official opinion into news',()=>{
 const primary=event([row()]),secondary=event([row('b','media')]);
 assert.ok(primary.priorityScore>secondary.priorityScore);assert.equal(primary.scoreParts.importance,secondary.scoreParts.importance);
 const opinion=event([row('opinion','official',85,{analysis:JSON.stringify(analysis('opinion',85,{editorial:{newFact:false,uncertain:false,insufficientEvidence:false}}))})]);
 assert.equal(selectHot([opinion],now).length,0);
});
test('a supported primary citation earns evidence credit, never another publisher or fabricated confirmation',()=>{
 const citation={url:'https://lab.example/research/model',label:'Original paper',context:'This release is described in the original paper.'};
 const raw={title:'Media report',source:'媒体',url:'https://media.example/article',summary:'Public summary',evidenceLinks:[citation]};
 const cited=event([row('a','media',85,{raw:JSON.stringify(raw),analysis:JSON.stringify(analysis('a',85,{primaryEvidenceUrls:[citation.url]}))})]);
 const unselected=event([row('b','media',85,{raw:JSON.stringify(raw)})]);
 assert.equal(cited.verification,'引有一手材料');assert.equal(cited.hasPrimary,false);assert.equal(cited.scoreParts.heat,1);assert.equal(cited.links.length,1);
 assert.ok(cited.priorityScore>unselected.priorityScore);assert.equal(cited.primaryEvidence[0].url,citation.url);
 const spoofed=primaryLinkCandidates({...raw,evidenceLinks:[{url:'https://lab.example.evil.test/research/a'},{url:'https://github.com/stranger/repo/blob/main/claim.md'},{url:'https://lab.example/'}]},sources);
 assert.deepEqual(spoofed,[]);
});
test('the model cannot fabricate supporting links or return string editorial booleans',()=>{
 const link='https://lab.example/research/model',input={id:'a',primaryLinks:[{url:link}]};
 assert.equal(validateAnalyses({items:[analysis('a',85,{primaryEvidenceUrls:[link]})]},['a'],[input])[0].primaryEvidenceUrls[0],link);
 assert.throws(()=>validateAnalyses({items:[analysis('a',85,{primaryEvidenceUrls:['https://lab.example/made-up']})]},['a'],[input]));
 assert.throws(()=>validateAnalyses({items:[analysis('a',85,{editorial:{newFact:'true',uncertain:false,insufficientEvidence:false}})]},['a']));
});
test('unconfirmed and insufficient reports cannot lead, and a sensational member cannot inflate a confirmed event',()=>{
 const rumor=row('rumor','media',99,{analysis:JSON.stringify(analysis('rumor',99,{editorial:{newFact:true,uncertain:true,insufficientEvidence:false}}))});
 assert.equal(selectHot([event([rumor])],now).length,0);
 const mixed=event([rumor,row('confirmed','official',70)]);
 assert.equal(mixed.scoreParts.importance,70);assert.equal(mixed.priority.eligible,true);assert.equal(mixed.sourceId,'official');
 const unknown=event([row('unknown','official',90,{analysis:JSON.stringify(analysis('unknown',90,{editorial:{newFact:true,uncertain:false,insufficientEvidence:true}}))})]);
 assert.equal(selectHot([unknown],now).length,0);
});
test('reposts and duplicate feeds cannot reset event age or multiply heat',()=>{
 const old=event([row('old','official',90,{published_at:'2026-10-22T00:00:00Z'}),row('new','media',90)]);
 assert.equal(selectHot([old],now).length,0);
 const mirrors=event([row(),row('mirror','repo',85),row('copy','media',85,{duplicate_of:'a'})]);
 assert.equal(mirrors.scoreParts.heat,1);
});
test('existing analyses have conservative explicit fallbacks and heat bonuses saturate',()=>{
 assert.equal(editorialQuality({title:'Funding',reasons:['来源为匿名消息，尚未获公司确认']}).uncertain,true);
 assert.equal(editorialQuality({title:'Market',reasons:['属市场评论而非新事实']}).newFact,false);
 assert.equal(editorialQuality({title:'A story',reasons:['公开摘要仅显示报道标题']}).insufficientEvidence,true);
 const q={newFact:true,uncertain:false,insufficientEvidence:false},score=n=>editorialPriority({importance:80,heat:n,reliability:90,recency:80},q);
 assert.ok(score(2).score>score(1).score);assert.equal(score(10).score,score(1000).score);
 assert.equal(score(10).score,Math.round(Object.values(score(10).contributions).reduce((a,b)=>a+b,0)*100)/100);
});
test('only observed RSS links become evidence candidates; encoded HTML and unsafe links are handled',()=>{
 const xml=`<rss><channel><item><title>AI model released</title><link>https://media.example/post</link><pubDate>${at}</pubDate><description>&lt;p&gt;See the &lt;a href=&quot;https://lab.example/research/model&quot;&gt;original paper&lt;/a&gt;.&lt;a href=&quot;javascript:alert(1)&quot;&gt;bad&lt;/a&gt;&lt;/p&gt;</description></item></channel></rss>`;
 const [item]=parseFeed(xml,{id:'media',name:'Media',kind:'news'},new Date(now));
 assert.equal(item.evidenceLinks.length,1);assert.equal(primaryLinkCandidates(item,sources)[0].url,'https://lab.example/research/model');assert.doesNotMatch(item.summary,/<a/);
});
test('the published API preserves editorial order and exposes scores without evidence excerpts',()=>{
 const major=event([row('major','official',90)],'major'),other=event([row('other','media',70)],'other');
 const snapshot={databaseReady:true,processedAt:at,ranking:{mode:'editorial_priority'},stories:[other,major],hot:selectHot([other,major],now)};
 const result=eventList(snapshot);assert.deepEqual(result.items.map(x=>x.id),['major','other']);assert.equal(result.items[0].scores.priority,major.priorityScore);assert.equal(result.ranking.mode,'editorial_priority');
 assert.doesNotMatch(JSON.stringify(result),/"raw"|"editorial"|"context"/);
});

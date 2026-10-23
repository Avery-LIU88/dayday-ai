import test from 'node:test';
import assert from 'node:assert/strict';
import {activityRecord,parseActivityPage,parseEventJsonLd,dateRange,allowedActivityUrl,collectActivities} from '../lib/activity-collector.mjs';
import {publicActivity,activityEnd,activityTime,activityNoticeId} from '../lib/activity-data.mjs';
import {duplicate,candidateWeight,validateAnalyses,selectHot,editions} from '../lib/pipeline-editorial.mjs';
import {upcomingActivities,deliveryParts} from '../lib/delivery-content.mjs';
const source={id:'example',name:'AI 活动',website:'https://luma.com/example',city:'上海'};
test('conference dates use labeled event dates, not news publication or stale editions',()=>{
 const wic=parseActivityPage('<title>2026世界智能产业博览会</title><p>发布日期：2026年04月03日</p><p>2026世界智能产业博览会由天津主办，将于5月28日至31日在天津举办。</p>',{...source,activityAdapter:'wic'})[0];
 assert.equal(wic.activityCandidate.date,'2026-05-28');assert.equal(wic.activityCandidate.endDate,'2026-05-31');
 const agic=parseActivityPage('<p>展会时间：2027年9月1-3日 展会地点：深圳 主办单位：协会</p><p>2026年8月26-28日上届</p>',{...source,activityAdapter:'agic'})[0];
 assert.equal(agic.activityCandidate.date,'2027-09-01');
 assert.deepEqual(dateRange('2026年11月26日—28日'),{start:'2026-11-26',end:'2026-11-28'});
 assert.equal(dateRange('2026年2月30日'),null);
});
test('JSON-LD preserves timezone, deadline and observed original link without copying content',()=>{
 const x={'@type':'Event',name:'AI 黑客松',description:'公开摘要',startDate:'2026-10-24T20:00:00Z',endDate:'2026-12-26T00:00:00Z',offers:{validThrough:'2026-12-01T15:59:59Z',url:'https://example.org/register'},location:{name:'上海'},eventAttendanceMode:'https://schema.org/MixedEventAttendanceMode'};
 const [entry]=parseEventJsonLd('<script type="application/ld+json">'+JSON.stringify(x)+'</script>',source);
 assert.equal(entry.activityCandidate.registrationDeadline,'2026-12-01T15:59:59Z');assert.equal(entry.activityCandidate.originalUrl,'https://example.org/register');
 assert.match(activityTime(entry.activityCandidate),/2026\/10\/25 04:00/);
 assert.equal(activityEnd(entry.activityCandidate),Date.parse(x.endDate));
});
test('weekly recurrences are not merged; material changes produce a new notice identity',()=>{
 const a=activityRecord(source,{title:'ShanghAI AI',start:'2026-10-24',url:'https://luma.com/a'}),b=activityRecord(source,{title:'ShanghAI AI',start:'2026-10-31',url:'https://luma.com/b'});
 assert.equal(duplicate(a,b),false);assert.equal(duplicate(a,{...a}),true);
 const event={entities:['ShanghAI AI'],title:a.title,takeaway:a.summary,publishedAt:a.publishedAt,activity:a.activityCandidate};
 assert.equal(candidateWeight(event,{...event,activity:b.activityCandidate}),0);
 const item={id:'one',activity:a.activityCandidate};assert.equal(activityNoticeId(item),activityNoticeId({...item,title:'不同标题',score:90}));
 assert.notEqual(activityNoticeId(item),activityNoticeId({...item,activity:{...item.activity,date:'2026-10-25'}}));
});
test('verified parser metadata survives AI analysis but cannot be overwritten by a model date',()=>{
 const known=activityRecord(source,{title:'AI 黑客松',start:'2026-10-31'}).activityCandidate;
 const v={id:'one',isAI:true,title:'AI 黑客松',takeaway:'开发者可参与。',importance:40,bullets:[],reasons:['小范围活动'],entities:['AI'],action:'活动报名',topic:'公司动态',activity:{date:'2099-01-01'}};
 const [result]=validateAnalyses({items:[v]},['one'],[{id:'one',activityCandidate:known}]);
 assert.equal(result.activity.date,'2026-10-31');assert.equal(result.topic,'黑客松');assert.equal(result.activity.dateEvidence,undefined);
});
test('future activities outlive the 24-hour window and deadlines never pretend to be event dates',()=>{
 const entry=activityRecord(source,{title:'AI competition',deadline:'2026-11-20',kind:'hackathon',format:'online'});
 const item={id:'one',title:entry.title,activity:entry.activityCandidate,activityListing:true,publishedAt:'2026-01-01T00:00:00Z',firstPublishedAt:'2026-01-01T00:00:00Z',priority:{eligible:true,quality:{newFact:false,uncertain:false,insufficientEvidence:false}},scoreParts:{importance:95}};
 assert.equal(upcomingActivities([item],Date.parse('2026-11-01T00:00:00Z')).length,1);
 assert.equal(upcomingActivities([item],Date.parse('2026-11-21T00:00:00Z')).length,0);
 assert.equal(upcomingActivities([{...item,activity:{...item.activity,status:'cancelled'}}],Date.parse('2026-11-01T00:00:00Z')).length,0);
 assert.match(deliveryParts([item],'activities')[0].text,/提交截止/);assert.doesNotMatch(deliveryParts([item],'activities')[0].text,/活动日期/);
 assert.deepEqual(selectHot([item],Date.parse('2026-01-01T12:00:00Z')),[]);
 assert.equal(editions([item],'2026-01-01T12:00:00Z').daily[0].articles.length,0);
});
test('activity fetch checks every redirect and stays within known public endpoints',async()=>{
 assert.equal(allowedActivityUrl('https://hackathonweekly.com/api/events'),true);
 for(const url of ['http://luma.com/x','https://luma.com.evil.test','https://u:p@luma.com/','https://127.0.0.1','https://luma.com:8443/x'])assert.equal(allowedActivityUrl(url),false);
 const calls=[];await assert.rejects(collectActivities({...source,feed:'https://luma.com/x',activityAdapter:'jsonld'},async url=>{calls.push(url);return new Response('',{status:302,headers:{location:'https://127.0.0.1/private'}});},async(url,fetcher)=>{const r=await fetcher(url,{});return r.text();}),/已核验/);
 assert.equal(calls.length,1);
});
test('same-day livestreams at different times are different occurrences; source self-citations do not inflate evidence',()=>{
 const a={title:'AI Fundamentals',takeaway:'AI 直播',entities:['Microsoft'],publishedAt:'2026-10-24T00:00:00Z',activity:{date:'2026-10-26',startAt:'2026-10-26T15:00:00Z'}};
 assert.equal(candidateWeight(a,{...a,activity:{date:'2026-10-26',startAt:'2026-10-26T20:00:00Z'}}),0);
 const v={id:'x',isAI:true,title:'AI 活动',takeaway:'AI 开发者活动',bullets:[],importance:45,reasons:['公开时间'],entities:['AI'],action:'发布活动',topic:'线下活动',primaryEvidenceUrls:['https://example.org/event/']};
 assert.deepEqual(validateAnalyses({items:[v]},['x'],[{id:'x',url:'https://example.org/event',primaryLinks:[]}])[0].primaryEvidenceUrls,[]);
 assert.throws(()=>validateAnalyses({items:[{...v,primaryEvidenceUrls:['https://unobserved.example/event']}]},['x'],[{id:'x',url:'https://example.org/event',primaryLinks:[]}]));
});

test('published activity dates use Beijing calendar days and retain a specific event link',()=>{
 const a=publicActivity({date:'2026-10-23',startAt:'2026-10-23T21:00:00Z',endAt:'2026-10-23T22:00:00Z',url:'https://luma.com/specific',originalUrl:'https://organizer.example/'});
 assert.equal(a.date,'2026-10-24');assert.equal(a.endDate,'2026-10-24');assert.equal(a.timezone,'Asia/Shanghai');assert.equal(a.originalUrl,undefined);
});

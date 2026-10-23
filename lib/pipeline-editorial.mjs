import {policy} from '../config/pipeline.mjs';
import {canonicalUrl,titleKey,topicNames,tokens,dayKey} from './dayday-core.mjs';
import {briefSection} from './daily-layout.mjs';
import {editorialQuality,supportedQuality,confirmedPrimaryLinks,editorialPriority} from './editorial-priority.mjs';
export function ruleFilter(item,source={}){
  if(new RegExp(policy.rules.reject,'i').test(item.title))return '明显促销内容';
  if(source.filterAI&&!new RegExp(policy.rules.ai,'i').test(`${item.title} ${item.summary}`)&&new RegExp(policy.rules.unrelated,'i').test(item.title))return '明显非 AI 内容';
  return null;
}
const bounded=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=n;
export function validateAnalyses(value,ids,inputs=[]){
  if(!Array.isArray(value?.items)||value.items.length!==ids.length)throw Error('模型返回条数不匹配');
  const seen=new Set();
  return value.items.map(v=>{
    if(!ids.includes(v.id)||seen.has(v.id))throw Error('模型返回未知或重复 ID');seen.add(v.id);
    // Preserve every point, including trailing caveats, when the model returns
    // a fourth short bullet. Never silently discard the last factual qualifier.
    const bullets=Array.isArray(v.bullets)&&v.bullets.length>3&&v.bullets.length<=6&&v.bullets.every(x=>bounded(x,260))?[...v.bullets.slice(0,2),v.bullets.slice(2).join('；')]:v.bullets;
    if(typeof v.isAI!=='boolean'||!Number.isInteger(v.importance)||v.importance<0||v.importance>100
      ||!bounded(v.title,180)||!bounded(v.takeaway,240)||!topicNames.includes(v.topic)
      ||!Array.isArray(bullets)||bullets.length>3||!bullets.every(x=>bounded(x,260))
      ||!Array.isArray(v.reasons)||v.reasons.length<1||v.reasons.length>3||!v.reasons.every(x=>bounded(x,260))
      ||!Array.isArray(v.entities)||v.entities.length>12||!v.entities.every(x=>bounded(x,100))||!bounded(v.action,180))throw Error('模型字段不符合约定');
    if(v.editorial!==undefined&&(!v.editorial||!['newFact','uncertain','insufficientEvidence'].every(k=>typeof v.editorial[k]==='boolean')))throw Error('编辑判断字段无效');
    const allowed=new Set(inputs.find(x=>x.id===v.id)?.primaryLinks?.map(x=>x.url)||[]),cited=v.primaryEvidenceUrls||[];
    if(!Array.isArray(cited)||cited.length>3||cited.some(url=>!allowed.has(url)))throw Error('一手证据链接不在来源材料内');
    return {id:v.id,isAI:v.isAI,title:v.title,takeaway:v.takeaway,bullets,importance:v.isAI?v.importance:0,reasons:v.reasons,entities:v.entities,action:v.action,topic:v.topic,...(v.editorial?{editorial:{newFact:v.editorial.newFact,uncertain:v.editorial.uncertain,insufficientEvidence:v.editorial.insufficientEvidence}}:{}),primaryEvidenceUrls:[...new Set(cited)]};
  });
}
export function validateGroups(value,inputs){
  if(!Array.isArray(value?.items)||value.items.length!==inputs.length)throw Error('归组返回条数不匹配');
  const seen=new Set();return value.items.map(v=>{
    const input=inputs.find(x=>x.id===v.id);
    if(!input||seen.has(v.id)||!['new','same_event','follow_up'].includes(v.relation)||!Number.isFinite(v.confidence)||v.confidence<0||v.confidence>1||!bounded(v.reason,300))throw Error('归组结果无效');
    if(v.relation!=='new'&&!input.candidates.some(c=>c.id===v.eventId))throw Error('归组引用不属于候选集');
    seen.add(v.id);return {id:v.id,eventId:v.relation==='new'?null:v.eventId,relation:v.relation,confidence:v.confidence,reason:v.reason};
  });
}
export function duplicate(a,b){const url=canonicalUrl(a.url);return (!!url&&url===canonicalUrl(b.url))||(!!a.title&&!!b.title&&titleKey(a.title)===titleKey(b.title)&&titleKey(a.summary)===titleKey(b.summary));}
export function eventCandidate(row){
  const a=typeof row.analysis==='string'?JSON.parse(row.analysis):row.analysis,raw=typeof row.raw==='string'?JSON.parse(row.raw):row.raw;
  return {title:a.title,takeaway:a.takeaway,entities:a.entities,action:a.action,publishedAt:row.published_at,
    evidence:[{id:row.id,title:raw.title,source:raw.source,publishedAt:row.published_at,excerpt:String(raw.summary||'').replace(/<[^>]*>/g,' ').slice(0,policy.groupingEvidenceChars)}]};
}
export function addEventEvidence(candidate,item){
  const evidence=[...new Map([...(item.evidence||[]),...(candidate.evidence||[])].map(e=>[e.id,e])).values()].slice(0,policy.groupingEvidenceReports);
  return {...candidate,entities:[...new Set([...candidate.entities,...item.entities])].slice(0,24),evidence};
}
export function candidateWeight(a,b){
  if(Math.abs(Date.parse(a.publishedAt)-Date.parse(b.publishedAt))>policy.groupingHours*3600000)return 0;
  const entities=new Set(a.entities.map(x=>titleKey(x))),shared=b.entities.filter(x=>entities.has(titleKey(x))).length;
  const x=tokens(a.title+' '+a.takeaway),y=tokens(b.title+' '+b.takeaway);
  const overlap=[...x].filter(t=>y.has(t)).length/Math.max(1,Math.min(x.size,y.size));
  return shared>0?shared+overlap:overlap>=policy.candidateTextOverlap?overlap:0;
}
/** Heat counts independent publishers, never duplicate rows or a weighted sum. */
export function scoreGroup(rows,sourceMap,event,now=Date.now()){
  const analyzed=rows.map(r=>({...r,raw:JSON.parse(r.raw),a:JSON.parse(r.analysis)}));
  analyzed.sort((a,b)=>b.a.importance-a.a.importance||Number(!!sourceMap.get(b.source_id)?.primary)-Number(!!sourceMap.get(a.source_id)?.primary)||a.id.localeCompare(b.id));
  const supported=analyzed.filter(r=>supportedQuality(editorialQuality(r.a))),judged=supported.length?supported:analyzed;
  const lead=judged[0],quality=editorialQuality(lead.a),links=analyzed.map(r=>({id:r.id,source:r.raw.source,sourceId:r.source_id,url:r.raw.url,publishedAt:r.published_at,publisher:sourceMap.get(r.source_id)?.publisher||r.source_id,primary:!!sourceMap.get(r.source_id)?.primary}));
  const counts=new Set(analyzed.filter(r=>!r.duplicate_of&&Date.parse(r.published_at)>now-policy.scoring.heat.windowHours*3600000).map(r=>sourceMap.get(r.source_id)?.publisher||r.source_id));
  const heat=counts.size,first=links.map(l=>l.publishedAt).sort()[0],latest=links.map(l=>l.publishedAt).sort().at(-1),primary=judged.some(r=>sourceMap.get(r.source_id)?.primary),reliability=policy.scoring.reliability;
  const primaryEvidence=[...new Map(judged.flatMap(r=>confirmedPrimaryLinks(r.a,r.raw,sourceMap)).map(x=>[x.url,x])).values()];
  const scoreParts={heat,importance:Math.max(...judged.map(r=>r.a.importance)),recency:Math.round(policy.scoring.recency.max*Math.exp(-Math.max(0,now-Date.parse(first))/(policy.scoring.recency.decayHours*3600000))),reliability:!supportedQuality(quality)?reliability.insufficient:primary?reliability.primary:primaryEvidence.length?reliability.citedPrimary:heat>=3?reliability.threePublishers:heat>=2?reliability.twoPublishers:reliability.singlePublisher};
  const priority=editorialPriority(scoreParts,quality);
  return {id:event.id,title:lead.a.title,summary:lead.a.takeaway,takeaway:lead.a.takeaway,bullets:lead.a.bullets,
    originalTitle:lead.a.title,url:lead.raw.url,publishedAt:latest,firstPublishedAt:first,dateLabel:'发布',topic:lead.a.topic,
    tags:[...new Set(analyzed.flatMap(r=>[r.a.topic,...(r.raw.topics||[])]))],language:'zh',source:lead.raw.source,sourceId:lead.source_id,
    links,coverage:new Set(links.map(l=>l.publisher)).size,scoreVersion:3,score:scoreParts.importance,scoreParts,priority,priorityScore:priority.score,primaryEvidence,scoreMode:'今日必知优先 · 重要性、证据、热度与时效',
    why:lead.a.reasons.join('；'),reasons:lead.a.reasons,valueParts:{impact:0,novelty:0,utility:0},hasPrimary:primary,verification:quality.uncertain?'待核实':quality.insufficientEvidence?'公开材料不足':primary?'含一手来源':primaryEvidence.length?'引有一手材料':'媒体报道',
    heatEvidence:{independentReports:heat,recentReports:heat,coveragePoints:heat,activityPoints:0,windowHours:policy.scoring.heat.windowHours},
    scoreBasis:'今日必知综合重要性、报道覆盖、一手证据与时效；原始热度仍为发布者数',analysisAt:lead.updated_at,trend:[],relatedEventId:event.parent_id||null};
}
export function orderBy(fields){return (a,b)=>{for(const key of fields){const x=a.scoreParts?.[key]??a[key],y=b.scoreParts?.[key]??b[key];const d=typeof x==='number'?y-x:String(y).localeCompare(String(x));if(d)return d;}return a.id.localeCompare(b.id);};}
export function selectHot(stories,now){return stories.filter(s=>s.priority?.eligible===true&&s.topic!=='招聘'&&Date.parse(s.firstPublishedAt)>now-policy.hotHours*3600000&&Date.parse(s.firstPublishedAt)<=now).sort(orderBy(policy.scoring.hotOrder));}
export function editions(stories,at,previousDaily=[],previousWeekly=[]){
  const today=dayKey(at),days=new Map(previousDaily.map(x=>[x.date,x])),weeks=new Map(previousWeekly.map(x=>[x.date,x]));
  const dates=new Set(stories.map(s=>dayKey(s.firstPublishedAt)));dates.add(today);
  const article=s=>({id:s.id,title:s.title,summary:[s.takeaway,...s.bullets].join('\n'),takeaway:s.takeaway,bullets:s.bullets,importance:s.scoreParts.importance,score:s.scoreParts.importance,scoreParts:s.scoreParts,url:s.url,source:s.source,publisher:s.links[0]?.publisher||s.sourceId,topic:s.topic,section:briefSection(s),firstPublishedAt:s.firstPublishedAt,scoreVersion:3,developments:[]});
  for(const date of dates){const list=stories.filter(s=>dayKey(s.firstPublishedAt)===date&&s.scoreParts.importance>=policy.dailyMinImportance&&s.topic!=='招聘').sort(orderBy(policy.scoring.dailyOrder)).map(article);
    if(list.length||date===today)days.set(date,{date,updatedAt:at,articles:list});}
  const shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const week=d=>shift(d,-((new Date(d+'T00:00:00Z').getUTCDay()+6)%7));
  const grouped=new Map();
  for(const issue of days.values())for(const item of issue.articles){const w=week(issue.date);if(!grouped.has(w))grouped.set(w,new Map());grouped.get(w).set(item.id,item);}
  for(const [date,items] of grouped){const old=weeks.get(date);if(old?.finalized)continue;weeks.set(date,{date,endDate:shift(date,6),updatedAt:at,finalized:date<week(today),articles:[...items.values()].sort((a,b)=>(b.importance||0)-(a.importance||0))});}
  return {daily:[...days.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,policy.dailyArchiveLimit),weekly:[...weeks.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,policy.weeklyArchiveLimit)};
}

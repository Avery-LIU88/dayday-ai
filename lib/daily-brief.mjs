import {dayKey} from './dayday-core.mjs';
import {roundup} from './event-ranking.mjs';

/** Calendar-day selection: no decaying heat score or recycled old events. */
export function selectDailyStories(stories,date,asOf=Date.now()){
 return stories.filter(s=>{
  const at=Date.parse(s.firstPublishedAt||s.publishedAt);
  return Number.isFinite(at)&&at<=asOf&&dayKey(new Date(at).toISOString())===date
   &&s.topic!=='招聘'&&!roundup(s.title)&&s.verification!=='待核实'
   &&(s.scoreParts?.importance||0)>=20;
 }).sort((a,b)=>(b.scoreParts.importance-a.scoreParts.importance)
  ||(b.scoreParts.reliability-a.scoreParts.reliability)
  ||((b.heatEvidence?.independentReports||1)-(a.heatEvidence?.independentReports||1))
  ||String(a.id).localeCompare(String(b.id))).slice(0,6);
}

/** Short source excerpts; never invented interpretation or translation. */
export function briefExcerpt(text=''){
 const clean=String(text).replace(/\s+/g,' ').trim();
 if(!clean)return '';
 const limit=/[\u3400-\u9fff]/.test(clean)?300:620;
 const sentences=clean.match(/.*?(?:[。！？!?]+|[.](?=\s+[A-Z]|$)|$)/g)?.filter(Boolean)||[clean];
 let excerpt=sentences.slice(0,3).join('');
 if(excerpt.length>limit){
  const boundary=excerpt.slice(0,limit).search(/[。！？!?][^。！？!?]*$/);
  excerpt=boundary>limit/3?excerpt.slice(0,boundary+1):excerpt.slice(0,limit).trimEnd()+'…';
 }
 return excerpt.trim();
}

function article(story,entries){
 // A Chinese report already merged into the same event can supply the excerpt.
 const chinese=!story.analysisAt&&story.language!=='zh'
  ?entries.find(e=>e.language==='zh'&&story.links.some(l=>l.id===e.id)):null;
 return {id:story.id,title:chinese?.title||story.title,
  summary:briefExcerpt(chinese?.summary||story.summary),
  url:chinese?.url||story.url,source:chinese?.source||story.source,
  publisher:story.links.find(l=>l.id===(chinese?.id||story.id))?.publisher||story.sourceId,
  topic:story.topic,firstPublishedAt:story.firstPublishedAt||story.publishedAt};
}

/** Persist editions beyond the recent feed. Only recent days can be revised. */
export function buildDailyEditions(stories,entries,collectedAt,previous=[]){
 const asOf=Date.parse(collectedAt);
 if(!Number.isFinite(asOf))return previous;
 const today=dayKey(collectedAt),recent=dayKey(new Date(asOf-2*86400000).toISOString());
 const byDate=new Map(previous.map(issue=>[issue.date,issue]));
 const dates=new Set(stories.flatMap(s=>{
  const at=Date.parse(s.firstPublishedAt||s.publishedAt);
  return Number.isFinite(at)&&at<=asOf?[dayKey(new Date(at).toISOString())]:[];
 }));
 dates.add(today);
 for(const date of dates){
  if(byDate.has(date)&&date<recent)continue;
  const articles=selectDailyStories(stories,date,asOf).map(s=>article(s,entries));
  if(!articles.length){if(date===today&&!byDate.has(date))byDate.set(date,{date,updatedAt:collectedAt,articles:[]});continue;}
  const old=byDate.get(date);
  const unchanged=old&&JSON.stringify(old.articles)===JSON.stringify(articles);
  byDate.set(date,{date,updatedAt:unchanged?old.updatedAt:collectedAt,articles});
 }
 return [...byDate.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,90);
}

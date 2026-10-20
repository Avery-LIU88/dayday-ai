import {dayKey,canonicalUrl,similarTitle} from './dayday-core.mjs';
import {sameEvent,judgeValue,roundup} from './event-ranking.mjs';
import {article,sameFinancing} from './daily-brief.mjs';

const DAY=86400000;
const shift=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*DAY).toISOString().slice(0,10);
/** Monday–Sunday, based on the publication date in Shanghai. */
export function weekRange(iso){
 const date=dayKey(iso),weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
 const start=shift(date,-((weekday+6)%7));
 return {date:start,endDate:shift(start,6)};
}
const at=a=>a.firstPublishedAt||a.publishedAt;
function matches(a,b){
 return a.id===b.id||(canonicalUrl(a.url)&&canonicalUrl(a.url)===canonicalUrl(b.url))
  ||similarTitle(a.title,b.title)||sameFinancing(a,b)
  // The concrete product/version and action guards still apply; only the
  // original 24-hour matching window is extended to this one weekly edition.
  ||sameEvent({...a,publishedAt:'2000-01-01T00:00:00Z'},{...b,publishedAt:'2000-01-01T00:00:00Z'});
}
function scored(a){
 const judgement=judgeValue(a);
 return {...a,importance:a.importance??a.scoreParts?.importance??judgement.importance,
  reliability:a.reliability??a.scoreParts?.reliability??5,
  reports:a.reports??a.heatEvidence?.independentReports??1,
  verification:a.verification||(judgement.rumor?'待核实':'媒体报道')};
}
const priority=a=>a.importance+Math.min(8,Math.max(0,a.reports-1)*2)+a.reliability/2;
function eligible(a){
 return a.importance>=20&&a.verification!=='待核实'&&a.topic!=='招聘'&&!roundup(a.title)
  &&!/^patch release\b|^bugfix\b|^修补版本|^补丁更新/i.test(a.title);
}
function development(a){
 return {title:a.title,summary:a.summary,url:a.url,source:a.source,publisher:a.publisher,firstPublishedAt:at(a)};
}
/** Rank all eligible events across the week; merge only identifiable events.
 * New headlines for a merged event remain as dated, attributed developments. */
export function selectWeeklyArticles(candidates,date,asOf){
 const endDate=shift(date,6),groups=[];
 for(const raw of candidates){
  const a=scored(raw),time=Date.parse(at(a));
  if(!Number.isFinite(time)||time>asOf||!eligible(a))continue;
  const day=dayKey(at(a));
  if(day<date||day>endDate)continue;
  let group=groups.find(g=>g.some(b=>matches(a,b)));
  if(!group){group=[];groups.push(group);}
  group.push(a);
 }
 return groups.map(group=>{
  group.sort((a,b)=>priority(b)-priority(a)||String(a.id).localeCompare(String(b.id)));
  const lead=group[0],all=group.flatMap(a=>[development(a),...(a.developments||[])]);
  const seen=new Set([canonicalUrl(lead.url)]);
  const developments=all.filter(d=>{
   const key=canonicalUrl(d.url),time=Date.parse(at(d));
   if(!key||seen.has(key)||!Number.isFinite(time)||time>asOf||dayKey(at(d))<date||dayKey(at(d))>endDate)return false;
   seen.add(key);return !similarTitle(d.title,lead.title);
  }).sort((a,b)=>String(at(a)).localeCompare(String(at(b))));
  return {...lead,developments};
 }).sort((a,b)=>priority(b)-priority(a)||String(a.id).localeCompare(String(b.id)));
}

/** Current week accumulates retained candidates. Finished editions are frozen.
 * Daily archives only recover expired source material; weekly selection and
 * ranking run again across the full period instead of concatenating issues. */
export function buildWeeklyEditions(stories,entries,collectedAt,daily=[],previous=[]){
 const asOf=Date.parse(collectedAt);
 if(!Number.isFinite(asOf))return previous;
 const current=weekRange(collectedAt),byDate=new Map(previous.map(e=>[e.date,e]));
 const candidates=new Map();
 for(const issue of daily)for(const a of issue.articles)candidates.set(a.id,a);
 for(const story of stories){
  const a={...article(story,entries),importance:story.scoreParts?.importance,
   reliability:story.scoreParts?.reliability,reports:story.heatEvidence?.independentReports,
   verification:story.verification};
  candidates.set(a.id,a);
 }
 const weeks=new Map();
 for(const a of candidates.values()){
  if(!Number.isFinite(Date.parse(at(a)))||Date.parse(at(a))>asOf)continue;
  const key=weekRange(at(a)).date;
  if(!weeks.has(key))weeks.set(key,[]);
  weeks.get(key).push(a);
 }
 if(!weeks.has(current.date))weeks.set(current.date,[]);
 for(const old of previous)if(!old.finalized&&!weeks.has(old.date))weeks.set(old.date,[]);
 for(const [date,items] of weeks){
  const old=byDate.get(date),endDate=shift(date,6);
  if(old?.finalized)continue;
  const incoming=new Set(items.map(a=>a.id));
  const retained=(old?.articles||[]).filter(a=>!incoming.has(a.id));
  const updated=items.map(a=>({...a,developments:old?.articles.find(b=>b.id===a.id)?.developments||[]}));
  const articles=selectWeeklyArticles([...updated,...retained],date,asOf);
  if(!articles.length&&date!==current.date)continue;
  const unchanged=old&&JSON.stringify(old.articles)===JSON.stringify(articles);
  byDate.set(date,{date,endDate,finalized:date<current.date,updatedAt:unchanged?old.updatedAt:collectedAt,articles});
 }
 return [...byDate.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,52);
}

import {dayKey} from './dayday-core.mjs';
import {roundup} from './event-ranking.mjs';
import {briefSection,briefSections} from './daily-layout.mjs';

// Conservative extra guard for an interview and a news report about the same
// financing: a distinctive company name and the same dollar amount, same day.
export function sameFinancing(a,b){
 if(a.topic!=='投融资'||b.topic!=='投融资')return false;
 const generic=new Set(['funding','million','billion','startup','secures','unicorn','valuation','raising','raises','investment','investors','capital','round','series','artificial','robotics','exclusive','breaking']);
 const company=s=>String(s.title).match(/^([A-Z][A-Za-z0-9.-]{5,})\b/)?.[1].toLowerCase();
 const name=company(a);
 if(!name||generic.has(name)||name!==company(b))return false;
 const amounts=s=>[...`${s.title} ${s.summary||''}`.matchAll(/\$(\d+(?:\.\d+)?)\s*(billion|million|bn|[mb])\b/gi)].map(m=>Number(m[1])*(/^b/i.test(m[2])?1000:1));
 const x=amounts(a),y=amounts(b);
 return x.some(n=>y.includes(n));
}

/** Calendar-day selection: assess every category before combining eligible events.
 * Importance must reach 20/35. No count ceiling, category quota or filler.
 * Coverage and reliability order the eligible set; no decaying live heat score. */
export function selectDailyStories(stories,date,asOf=Date.now()){
 const importance=s=>s.scoreParts?.importance||0;
 const priority=s=>importance(s)+Math.min(8,Math.max(0,(s.heatEvidence?.independentReports||1)-1)*2)+(s.scoreParts?.reliability||0)/2;
 const candidates=stories.filter(s=>{
  const at=Date.parse(s.firstPublishedAt||s.publishedAt);
  return Number.isFinite(at)&&at<=asOf&&dayKey(new Date(at).toISOString())===date
   &&s.topic!=='招聘'&&!roundup(s.title)&&s.verification!=='待核实'
   &&!/^patch release\b|^bugfix\b|^修补版本|^补丁更新/i.test(s.title)
 });
 const eligible=briefSections.flatMap(section=>candidates.filter(s=>briefSection(s)===section.id&&importance(s)>=20));
 const ranked=eligible.sort((a,b)=>(priority(b)-priority(a))
  ||(b.scoreParts.reliability-a.scoreParts.reliability)
  ||((b.heatEvidence?.independentReports||1)-(a.heatEvidence?.independentReports||1))
  ||String(a.id).localeCompare(String(b.id)));
 const selected=[];
 for(const story of ranked)if(!selected.some(s=>s.id===story.id||sameFinancing(s,story)))selected.push(story);
 return selected;
}

/** Short source excerpts; never invented interpretation or translation. */
export function briefExcerpt(text=''){
 const clean=String(text).replace(/\s+/g,' ').trim();
 if(!clean)return '';
 const limit=/[\u3400-\u9fff]/.test(clean)?300:620;
 const sentences=clean.match(/.*?(?:[。！？!?]+|[.](?=\s+[A-Z]|$)|$)/g)?.filter(Boolean)||[clean];
 let excerpt='';
 for(const sentence of sentences.slice(0,3)){
  if(excerpt&&excerpt.length+sentence.length>limit)break;
  excerpt+=sentence;
 }
 if(excerpt.length>limit){
  const boundary=excerpt.slice(0,limit).search(/[。！？!?][^。！？!?]*$/);
  excerpt=boundary>limit/3?excerpt.slice(0,boundary+1):excerpt.slice(0,limit).trimEnd()+'…';
 }
 return excerpt.trim();
}

export function article(story,entries){
 // A Chinese report already merged into the same event can supply the excerpt.
 const chinese=!story.analysisAt&&story.language!=='zh'
  ?entries.find(e=>e.language==='zh'&&story.links.some(l=>l.id===e.id)):null;
 return {id:story.id,title:chinese?.title||story.title,
  summary:briefExcerpt(chinese?.summary||story.summary),
  url:chinese?.url||story.url,source:chinese?.source||story.source,
  publisher:story.links.find(l=>l.id===(chinese?.id||story.id))?.publisher||story.sourceId,
  topic:story.topic,section:briefSection(story),firstPublishedAt:story.firstPublishedAt||story.publishedAt};
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

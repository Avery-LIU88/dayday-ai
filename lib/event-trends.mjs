import {canonicalUrl} from './dayday-core.mjs';
// Compact deterministic URL aliases preserve identity when the representative article changes.
function alias(url){let a=2166136261,b=2246822507;for(const ch of canonicalUrl(url)){const n=ch.codePointAt(0);a=Math.imul(a^n,16777619);b=Math.imul(b^n,3266489909);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
export function eventAliases(story){return [...new Set((story.links||[]).map(l=>canonicalUrl(l.url)).filter(Boolean).map(alias))].sort();}
export function appendSnapshot(history,stories,at){
 const now=Date.parse(at);if(!Number.isFinite(now))throw Error('Invalid snapshot time');
 const prior=(history||[]).filter(s=>Date.parse(s.at)>now-7*86400000&&Date.parse(s.at)<now).sort((a,b)=>a.at.localeCompare(b.at));
 // A retry/manual repeat within the same short window is not another trend observation.
 if(prior.length&&now-Date.parse(prior.at(-1).at)<6*3600000)return prior;
 const events=stories.filter(s=>Date.parse(s.firstPublishedAt||s.publishedAt)>now-48*3600000&&Date.parse(s.publishedAt)<=now).map(s=>({keys:eventAliases(s),heat:s.scoreParts.heat})).filter(s=>s.keys.length&&Number.isFinite(s.heat));
 const result=[...prior,{at,events}].slice(-16);
 while(result.length>1&&JSON.stringify(result).length>1500000)result.shift();return result;
}
export function indexSnapshots(history){
 const index=new Map();for(const snap of history)for(const event of snap.events){const record={...event,at:snap.at};for(const key of event.keys){const records=index.get(key)||[];records.push(record);index.set(key,records);}}return index;
}
export function trendFor(story,history,index=indexSnapshots(history)){
 const keys=new Set(eventAliases(story)),queue=[...keys],seen=new Set(),points=new Map();
 for(let i=0;i<queue.length;i++)for(const event of index.get(queue[i])||[]){if(seen.has(event))continue;seen.add(event);for(const k of event.keys)if(!keys.has(k)){keys.add(k);queue.push(k);}
 // Previously separate reports are never added together as fabricated historical heat.
 points.set(event.at,Math.max(points.get(event.at)??0,event.heat));}
 return [...points].sort(([a],[b])=>a.localeCompare(b)).map(([at,heat])=>({at,heat}));
}
/** @param {{at:string,heat:number}[]} points */
export function trendGeometry(points){
 const valid=points.filter(p=>Number.isFinite(Date.parse(p.at))&&Number.isFinite(p.heat)).sort((a,b)=>a.at.localeCompare(b.at));if(valid.length<2)return {points:[],path:'',direction:'pending'};
 const first=Date.parse(valid[0].at),last=Date.parse(valid.at(-1).at);if(last<=first)return {points:[],path:'',direction:'pending'};
 const plotted=valid.map(p=>({...p,x:4+112*(Date.parse(p.at)-first)/(last-first),y:38-34*Math.max(0,Math.min(40,p.heat))/40}));
 const path=plotted.map((p,i)=>`${!i||Date.parse(p.at)-Date.parse(plotted[i-1].at)>18*3600000?'M':'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
 const delta=valid.at(-1).heat-valid.at(-2).heat;return {points:plotted,path,direction:delta>0?'rising':delta<0?'falling':'steady'};
}

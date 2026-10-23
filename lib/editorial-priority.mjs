import {policy} from '../config/pipeline.mjs';
import {canonicalUrl} from './dayday-core.mjs';

export function editorialQuality(analysis){
 const value=analysis.editorial;
 if(value&&['newFact','uncertain','insufficientEvidence'].every(k=>typeof value[k]==='boolean'))return {...value,method:'model'};
 const rules=policy.scoring.priority,text=[analysis.title,analysis.takeaway,...(analysis.reasons||[])].join(' ');
 return {newFact:!new RegExp(rules.legacyNoNewFact,'i').test(text),uncertain:new RegExp(rules.legacyUncertain,'i').test(text),insufficientEvidence:new RegExp(rules.legacyInsufficient,'i').test(text),method:'existing_analysis_rules'};
}
export const supportedQuality=q=>q.newFact&&!q.uncertain&&!q.insufficientEvidence;

// Candidates must occur in the source content and belong to a configured
// primary publisher. A link's presence alone does not earn evidence credit.
export function primaryLinkCandidates(raw,sources){
 const output=[],seen=new Set();
 for(const ref of raw.evidenceLinks||[]){
  let u;try{u=new URL(ref.url);}catch{continue;}
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.pathname==='/')continue;
  const source=[...sources.values()].find(s=>{
   if(!s.primary||s.adapter==='directory')return false;
   try{const target=new URL(s.website);if(target.hostname!==u.hostname)return false;
    if(policy.scoring.priority.scopedPrimaryHosts.includes(u.hostname)){const path=target.pathname.replace(/\/$/,'');return path&&path!=='/'&&(u.pathname===path||u.pathname.startsWith(path+'/'));}
    return true;
   }catch{return false;}
  });
  const url=canonicalUrl(u.href);if(!source||!url||seen.has(url))continue;
  seen.add(url);output.push({url,label:String(ref.label||'').slice(0,120),context:String(ref.context||'').slice(0,180),source:source.name});
  if(output.length>=policy.scoring.priority.maxEvidenceLinks)break;
 }
 return output;
}
export function confirmedPrimaryLinks(analysis,raw,sources){
 const selected=new Set(analysis.primaryEvidenceUrls||[]);
 return primaryLinkCandidates(raw,sources).filter(x=>selected.has(x.url)).map(({url,source})=>({url,source}));
}
const round=v=>Math.round(v*100)/100;
export function editorialPriority(scoreParts,quality){
 const config=policy.scoring.priority;
 const values={importance:scoreParts.importance,reliability:scoreParts.reliability,recency:scoreParts.recency,
  heat:Math.min(100,100*Math.log1p(Math.max(0,scoreParts.heat))/Math.log1p(config.heatSaturation))};
 const contributions=Object.fromEntries(Object.entries(config.weights).map(([key,w])=>[key,round(Math.min(100,Math.max(0,values[key]))*w)]));
 const exclusions=[];
 if(scoreParts.importance<config.minimumImportance)exclusions.push('重要性未达到入选标准');
 if(!quality.newFact)exclusions.push('缺少实质新进展');
 if(quality.uncertain)exclusions.push('核心信息待核实');
 if(quality.insufficientEvidence)exclusions.push('公开材料不足');
 return {version:config.version,score:round(Object.values(contributions).reduce((n,x)=>n+x,0)),eligible:exclusions.length===0,contributions,exclusions,quality};
}

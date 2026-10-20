/** Explainable estimates from collected reports, never social engagement counts. */
const clean=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const actionRules=[
 ['open',/开源|open[- ]sourc/i],['release',/发布|推出|上线|launch|releas|introduc/i],
 ['funding',/融资|收购|并购|\bfunding\b|\bacqui[rs]|\braise[ds]? \$|\bvaluat/i],
 ['policy',/禁令|禁止|监管|法案|ban\b|regulat|legislation/i],
 ['security',/漏洞|泄露|leak|breach|vulnerabilit/i],['benchmark',/评测|登顶|benchmark|leaderboard/i]
];
const generic=new Set('openai anthropic deepseek google nvidia microsoft company research model models release releases launched launch introduces introducing artificial intelligence developer developers learning machine agent agents coding source github benchmark technology science framework performance inference training update report reports system product product development advances against between through language evaluation current paper transformers'.split(' '));
export function eventAnchors(title){
 const words=String(title).toLowerCase().match(/[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*/g)||[];
 const funding=String(title).match(/^([\p{Script=Han}A-Za-z]{2,16})(?:宣布)?完成.{0,16}?(\d+(?:\.\d+)?[亿万](?:美元|元)).{0,8}融资/u);
 return [...words.filter(w=>(w.length>=6||/\d/.test(w))&&!generic.has(w)),...(funding?[`fund:${funding[1]}:${funding[2]}`]:[])];
}
export const roundup=t=>/[；;|｜].*[；;|｜]|早知道|早报|日报|daily brief|roundup|weekly digest/i.test(t);
/** Conservative extra merge: a specific product plus the same action, within one day. */
export function sameEvent(a,b){
 if(roundup(a.title)||roundup(b.title))return false;
 if(Math.abs(Date.parse(a.publishedAt)-Date.parse(b.publishedAt))>24*3600000)return false;
 const x=eventAnchors(a.title),y=eventAnchors(b.title),shared=x.filter(w=>y.includes(w));
 if(!shared.length)return false;
 const concrete=w=>/\d/.test(w)||[a.title,b.title].every(t=>(String(t).match(/[A-Za-z][A-Za-z0-9.-]*/g)||[]).some(v=>v.toLowerCase()===w&&/[a-z][A-Z]/.test(v)));
 if(!shared.some(concrete))return false;
 if(/辟谣|否认|不实|denies|debunk/i.test(a.title)!==/辟谣|否认|不实|denies|debunk/i.test(b.title))return false;
 const versions=t=>(String(t).toLowerCase().match(/\b(?:gpt|claude|gemini|glm|qwen|llama|v)[ -]?\d+(?:\.\d+)*(?:[- ][a-z]+)?/g)||[]).sort().join('|');
 if(versions(a.title)&&versions(b.title)&&versions(a.title)!==versions(b.title))return false;
 // Both headlines must name the same concrete action; a broad company name is insufficient.
 return actionRules.some(([,r])=>r.test(a.title)&&r.test(b.title));
}
function words(text){return new Set([...(String(text).toLowerCase().match(/[a-z0-9]+/g)||[]),...(String(text).match(/[\p{Script=Han}]+/gu)||[]).flatMap(s=>Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)))]);}
function nearCopy(a,b){
 const x=clean(a.summary),y=clean(b.summary);
 if(x.length<60||y.length<60)return clean(a.title)===clean(b.title)&&(!x||!y||x===y);
 if(x.slice(0,180)===y.slice(0,180))return true;
 const p=words(a.summary),q=words(b.summary),n=[...p].filter(t=>q.has(t)).length;
 return n/(p.size+q.size-n)>.86;
}
/** A publisher's mirrors, the same canonical URL and near-identical copy count once. */
export function distinctReports(entries,sourceMap,canonical){
 const seen=new Set(),reports=[];
 for(const e of [...entries].sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt))){
  const publisher=sourceMap.get(e.sourceId)?.publisher||e.sourceId;
  if(seen.has(publisher))continue;
  seen.add(publisher);
  if(reports.some(r=>canonical(r.url)===canonical(e.url)||nearCopy(r,e)))continue;
  reports.push(e);
 }
 return reports;
}
/** @param {any} lead */
export function judgeValue(lead){
 const text=`${lead.title} ${lead.summary}`,title=lead.title;
 const rumor=/传闻|据传|未经证实|\brumou?rs?\b/i.test(text);
 const open=/(?:全面|正式|宣布|进一步|现已|首次)开源|开源[了：:]|开源.{0,12}(?:框架|代码|工具|项目)|开源[！!。.]?$|开放权重|open-sourc(?:ed|es|ing)|(?:release|introduc|launch).{0,100}open[- ]source/i.test(title);
 const eventNotice=/议程|嘉宾|洽谈会|峰会|大会|summit|conference|agenda/i.test(title);
 const release=!eventNotice&&/发布|推出|上线|launch|release|introduc/i.test(title);
 const security=/泄露|泄漏|遭攻击|漏洞披露|修复.{0,10}漏洞|leaked|breached|data breach|security flaw|patch.{0,20}vulnerabilit/i.test(title);
 const policy=/禁令|禁止|监管|法案|政策|\bban\b|\bregulat|\blegislation/i.test(title);
 const proposal=/研究起草|适时研究|拟议|计划|propos|consider/i.test(title);
 const funding=/融资|收购|并购|\bfunding\b|\bacqui[rs]|\braised? \$|\bvaluation\b/i.test(title);
 const research=/论文|评测|benchmark|research|paper|evaluation/i.test(title)||(lead.topics||[]).includes('论文与研究');
 const major=/OpenAI|Anthropic|DeepSeek|Google|NVIDIA|Microsoft|阿里|字节|腾讯|Meta\b|全国|联邦|欧盟|global|federal/i.test(title);
 let impact=major?10:5,novelty=3,utility=3,reason='提供行业观察，可结合原文判断是否与你的工作或研究相关。';
 if(research){novelty=6;utility=5;reason='提供研究或评测信息，值得核对实验条件与实际适用范围。';}
 if(eventNotice){impact=5;novelty=4;utility=5;reason='提供行业活动安排，可核对议程、时间及参与方式。';}
 if(funding){impact=major?13:9;novelty=8;utility=5;reason='涉及融资或并购变化，可用于观察 AI 行业的资本与竞争格局。';}
 if(release){novelty=9;utility=8;reason='涉及产品或模型更新，值得查看能力变化、可用范围与使用成本。';}
 if(open){impact=Math.max(impact,10);novelty=10;utility=10;reason='包含开放资源，开发者可进一步检查代码、许可和复用条件。';}
 if(policy){impact=proposal?8:15;novelty=proposal?4:8;utility=proposal?4:8;reason=proposal?'涉及政策讨论或规划，需区分拟议方向与已经生效的规则。':'涉及政策或准入变化，值得核对适用地区、对象与生效时间。';}
 if(security){impact=15;novelty=9;utility=10;reason='涉及安全或隐私风险，使用相关产品时应关注影响范围与修复进展。';}
 if(rumor){impact=Math.min(impact,5);novelty=Math.min(novelty,3);utility=Math.min(utility,3);reason='包含尚未确认的信息，等待原始证据后再做判断。';}
 return {importance:Math.min(35,impact+novelty+utility),valueParts:{impact,novelty,utility},reason,rumor};
}
/** @param {any[]} group @param {Map<any,any>} sourceMap @param {any} lead */
export function scoreEvent(group,sourceMap,lead,now,canonical){
 const reports=distinctReports(group,sourceMap,canonical);
 const earliest=group.reduce((a,e)=>e.publishedAt<a?e.publishedAt:a,group[0].publishedAt);
 const recent=reports.filter(e=>Date.parse(e.publishedAt)>now-6*3600000&&Date.parse(e.publishedAt)<=now).length;
 const coveragePoints=Math.min(25,Math.round(5+20*Math.log2(Math.max(1,reports.length))/3));
 const activityPoints=Math.min(15,recent*3);
 const judgement=judgeValue(lead);
 const primary=group.some(e=>sourceMap.get(e.sourceId)?.primary);
 const reliability=judgement.rumor?1:primary?10:reports.length>=3?8:reports.length>=2?7:5;
 const recency=Math.round(15*Math.exp(-Math.max(0,now-Date.parse(earliest))/(24*3600000)));
 const scoreParts={heat:coveragePoints+activityPoints,importance:judgement.importance,recency,reliability};
 return {scoreVersion:2,score:Object.values(scoreParts).reduce((a,b)=>a+b,0),scoreParts,scoreMode:'规则',why:judgement.reason,reasons:[judgement.reason],valueParts:judgement.valueParts,firstPublishedAt:earliest,hasPrimary:primary,verification:judgement.rumor?'待核实':primary?'含一手来源':'媒体报道',heatEvidence:{independentReports:reports.length,recentReports:recent,coveragePoints,activityPoints,windowHours:6},scoreBasis:'报道覆盖度估算；未接入社媒互动量'};
}

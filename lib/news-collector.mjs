import {parseFeed,plain,safeUrl,stableId} from './feed.mjs';
import {canonicalUrl,topicFor} from './dayday-core.mjs';

export const AI_PATTERN=/\b(?:ai|agi|llm|gpt|claude|gemini|deepseek|qwen|anthropic|openai|chatgpt|copilot|transformer|robotics)\b|artificial intelligence|machine learning|neural network|人工智能|大模型|智能体|机器学习|生成式|深度学习|机器人|算力|智谱|月之暗面/i;
export function relevant(entry,source){
 if(/双11|双十一|国补|教育优惠|好价正当时|优惠券|coupon code|black friday deals/i.test(entry.title))return false;
 return !source.filterAI||AI_PATTERN.test(`${entry.title} ${entry.summary}`);
}
export function extractSnippet(text){
 const clean=plain(text).replace(/The post [\s\S]*? appeared first on [^.]+\./gi,'').trim();
 if(clean.length<=320)return clean;
 const short=clean.slice(0,320),last=Math.max(short.lastIndexOf('。'),short.lastIndexOf('. '),short.lastIndexOf('！'));
 return last>160?short.slice(0,last+1):short.trimEnd()+'…';
}
export async function readBounded(url,fetcher=fetch){
 const res=await fetcher(url,{headers:{'User-Agent':'DayDayAI/1.0 (public information reader)','Accept':'application/rss+xml,application/atom+xml,application/json,text/html;q=0.8,*/*;q=0.5'},signal:AbortSignal.timeout(18000)});
 if(!res.ok)throw Error(`HTTP ${res.status}`);
 const reader=res.body?.getReader();if(!reader)throw Error('来源返回空响应');
 let bytes=0,text='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4_000_000)throw Error('来源超过 4MB 限制');text+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}
 return text+decoder.decode();
}
function record(s,title,url,date,summary='',extra={}){
 const time=Date.parse(date),link=safeUrl(url);
 if(!title||!link||!Number.isFinite(time)||time>Date.now()+600000)return null;
 return {id:'',kind:'article',sourceId:s.id,source:s.name,title:plain(title).slice(0,350),summary:plain(summary).slice(0,650),url:link,publishedAt:new Date(time).toISOString(),category:s.section,topics:[s.section],language:s.language,byline:'',duration:null,artwork:'',color:'#2563eb',...extra};
}
export function parseAnthropic(html,s){
 const items=[];
 for(const [,href,body] of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const date=body.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)?.[1];
  const title=body.match(/<(?:span|h[23])[^>]*class=["'][^"']*(?:__title|__featuredTitle|__sideTitle)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|h[23])>/i)?.[1]||body.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1];
  if(!date||!title)continue;
  const row=record(s,title,new URL(href,s.website).href,plain(date),body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]||'');
  if(row)items.push(row);
 }
 return items;
}
export function parseStructured(text,s){
 const data=JSON.parse(text);
 if(s.adapter==='greenhouse')return (data.jobs||[]).map(j=>record(s,j.title,j.absolute_url,j.updated_at,`工作地点：${j.location?.name||'见原站'}。职位是否仍开放以原站为准。`,{dateLabel:'职位更新'})).filter(Boolean);
 if(s.adapter==='hf')return (Array.isArray(data)?data:[]).map(x=>record(s,x.paper?.title,`https://huggingface.co/papers/${x.paper?.id}`,x.publishedAt||x.paper?.publishedAt,x.paper?.summary)).filter(Boolean);
 if(s.adapter==='hf-models')return (Array.isArray(data)?data:[]).map(x=>record(s,x.id,`https://huggingface.co/${x.id}`,x.createdAt,`官方模型仓库${x.pipeline_tag?`；任务类型：${x.pipeline_tag}`:''}。模型说明、权重与使用条件见原站模型卡。`,{dateLabel:'模型创建'})).filter(Boolean);
 throw Error('未知结构化来源');
}
function meta(html,key){
 for(const [tag] of html.matchAll(/<meta\b[^>]*>/gi)){
  const attrs=Object.fromEntries([...tag.matchAll(/([\w:-]+)=["']([^"']*)["']/g)].map(x=>[x[1].toLowerCase(),x[2]]));
  if(attrs.property===key||attrs.name===key)return plain(attrs.content);
 }return '';
}
export function parseArticle(html,url,s){
 let date=meta(html,'article:published_time')||meta(html,'date')||meta(html,'pubdate');
 let title=meta(html,'og:title'),summary=meta(html,'og:description')||meta(html,'description');
 function walk(x){if(!x||typeof x!=='object')return;if(Array.isArray(x))return x.forEach(walk);
  if(/Article|BlogPosting|NewsArticle/.test(String(x['@type']))){date=date||x.datePublished;title=title||x.headline;summary=summary||x.description;}
  if(x['@graph'])walk(x['@graph']);
 }
 for(const [,json] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(json))}catch{}}
 date=date||html.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1];
 date=date||html.match(/发布时间[：:\s]*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/)?.[1]||html.match(/发布日期[：:\s]*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/)?.[1];
 if(s.id==='hai')date=date||plain(html.match(/<div[^>]*class=["'][^"']*FeatureArticleMeta_date[^"']*["'][^>]*>([^<]+)<\/div>/)?.[1]||'');
 return record(s,title||plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),url,date,summary);
}
export function parseDatedList(html,s){
 const items=[];
 const pattern=s.adapter==='rundown'?/<article\b[^>]*>([\s\S]*?)<\/article>/gi:/<a\b[^>]*href=["'](\/ai\/\d{4}-\d{2}-\d{2})["'][^>]*>([\s\S]*?)<\/a>/gi;
 for(const match of html.matchAll(pattern)){
  const body=s.adapter==='rundown'?match[1]:match[2];
  const href=s.adapter==='rundown'?body.match(/href=["']([^"']+)["']/)?.[1]:match[1];if(!href)continue;
  const date=body.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1];
  const title=s.adapter==='rundown'?body.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)?.[1]:body.replace(/<time\b[^>]*>[\s\S]*?<\/time>/i,'');
  const row=record(s,title,new URL(href,s.website).href,date,body.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1]||'');if(row)items.push(row);
 }return items;
}
export function parseChangelog(html,s){
 return [...html.matchAll(/<h2\b[^>]*id=["']date-(\d{4}-\d{2}-\d{2})["'][^>]*>[\s\S]*?<\/h2>([\s\S]*?)(?=<h2\b|<footer|$)/gi)].slice(0,20).map(([,date,body])=>{
  const title=plain(body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]||body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]||`DeepSeek 更新 ${date}`);
  return record(s,title,`${s.website}?update=${date}#date-${date}`,date,plain(body).slice(0,650));
 }).filter(Boolean);
}
async function htmlArticles(html,s,fetcher){
 const links=[];
 for(const [,href] of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)){
  const url=new URL(plain(href),s.website);
  if(url.origin!==new URL(s.website).origin||!new RegExp(s.linkPattern||'/news/[^/]+').test(url.pathname))continue;
  if(!links.includes(url.href))links.push(url.href);
 }
 const items=[];
 // No page crawling: only five same-origin recent article links.
 for(let i=0;i<Math.min(5,links.length);i+=3)await Promise.all(links.slice(i,Math.min(i+3,5)).map(async url=>{try{const item=parseArticle(await readBounded(url,fetcher),url,s);if(item)items.push(item);}catch{}}));
 return items;
}
export async function collectSource(s,fetcher=fetch){
 if(s.adapter==='directory'||!s.feed)throw Error(s.notice||'尚未找到可用的自动更新入口');
 const text=await readBounded(s.feed,fetcher);
 let raw=s.adapter==='rss'?parseFeed(text,s):s.adapter==='anthropic'?parseAnthropic(text,s):s.adapter==='html'?await htmlArticles(text,s,fetcher):['tldr','rundown'].includes(s.adapter)?parseDatedList(text,s):s.adapter==='changelog'?parseChangelog(text,s):parseStructured(text,s);
 if(!raw.length&&!(s.adapter==='rss'&&/<(?:rss|feed|rdf:RDF)\b/i.test(text)&&!/<(?:item|entry)\b/i.test(text)))throw Error('未解析到带有有效日期的内容');
 const filtered=raw.filter(e=>relevant(e,s)).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,35);
 const items=[];
 for(const e of filtered){const url=canonicalUrl(e.url);if(!url)continue;
  // Identity includes the publisher so multi-source attribution survives dedup.
  const item={...e,title:plain(e.title),summary:extractSnippet(e.summary),id:await stableId(`${s.id}:${url}`),category:topicFor(e,s),topics:[]};
  item.topics=[...new Set([s.section,item.category,contentType(e,s),...(s.adapter==='hf-models'?['开发者平台','模型仓库']:[])].filter(Boolean))];items.push(item);
 }
 return {items,rawCount:raw.length};
}
export function contentType(e,s){
 if(s.adapter==='hf-models')return '模型仓库';
 const t=`${e.title} ${e.summary}`;
 if(s.section==='公司动态'){
  if(/tech(?:nical)? report|system card|model card|research paper|技术报告|系统卡|技术论文/i.test(t))return '技术报告';
  if(/introduc|launch|releas|announc|发布|推出|上线/i.test(t))return '产品发布';
  return '公司 Blog';
 }
 return s.section;
}

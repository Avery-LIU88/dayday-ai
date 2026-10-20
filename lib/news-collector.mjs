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
export async function readBounded(url,fetcher=fetch,request={}){
 const {expectFeed,...options}=request;
 const res=await fetcher(url,{...options,headers:{'User-Agent':'DayDayAI/1.0 (public information reader)','Accept':'application/rss+xml,application/atom+xml,application/json,text/html;q=0.8,*/*;q=0.5',...request.headers},signal:AbortSignal.timeout(18000)});
 if(!res.ok)throw Error(`HTTP ${res.status}`);
 const reader=res.body?.getReader();if(!reader)throw Error('来源返回空响应');
 let bytes=0,text='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4_000_000)throw Error('来源超过 4MB 限制');text+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}
 text+=decoder.decode();
 if(expectFeed&&!/<(?:rss|feed|rdf:RDF)\b/i.test(text)){
  const title=plain(text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').slice(0,55);
  const type=(res.headers.get('content-type')||'未知类型').split(';')[0];
  throw Error(`来源未返回 RSS / Atom：${type}${title?'；'+title:''}${res.headers.get('content-encoding')?'；编码 '+res.headers.get('content-encoding'):''}`);
 }
 return text;
}
export function record(s,title,url,date,summary='',extra={}){
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
 if(s.adapter==='semantic')return (data.data||[]).map(x=>record(s,x.title,x.url,x.publicationDate,x.abstract||'',{dateLabel:'论文发表'})).filter(Boolean);
 if(s.adapter==='tencent-blog')return (data.data?.list||[]).map(x=>record(s,x.title,`https://hunyuan.tencent.com/research/${encodeURIComponent(x.customUrl||x.id)}?langVersion=${x.lang||'en'}`,new Date((x.displayPublishTime||x.publishedAt)*1000).toISOString(),x.desc||'',{language:x.lang||'en'})).filter(Boolean);
 if(s.adapter==='greenhouse')return (data.jobs||[]).map(j=>record(s,j.title,j.absolute_url,j.updated_at,`工作地点：${j.location?.name||'见原站'}。职位是否仍开放以原站为准。`,{dateLabel:'职位更新'})).filter(Boolean);
 if(s.adapter==='hf')return (Array.isArray(data)?data:[]).map(x=>record(s,x.paper?.title,`https://huggingface.co/papers/${x.paper?.id}`,x.publishedAt||x.paper?.publishedAt,x.paper?.summary)).filter(Boolean);
 if(s.adapter==='hf-models')return (Array.isArray(data)?data:[]).map(x=>record(s,x.id,`https://huggingface.co/${x.id}`,x.createdAt,`官方模型仓库${x.pipeline_tag?`；任务类型：${x.pipeline_tag}`:''}。模型说明、权重与使用条件见原站模型卡。`,{dateLabel:'模型创建'})).filter(Boolean);
 throw Error('未知结构化来源');
}
function meta(html,key){
 for(const [tag] of html.matchAll(/<meta\b[^>]*>/gi)){
  const attrs=Object.fromEntries([...tag.matchAll(/([\w:-]+)=["']([^"']*)["']/g)].map(x=>[x[1].toLowerCase(),x[2]]));
  if(attrs.property?.toLowerCase()===key.toLowerCase()||attrs.name?.toLowerCase()===key.toLowerCase())return plain(attrs.content);
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
 // These selectors belong to the article header, not sidebar recommendations.
 if(s.id==='latepost'){
  date=html.match(/\bvar release_time\s*=\s*['"](\d{4}\/\d{2}\/\d{2})['"]/)?.[1]?.replaceAll('/','-');
  title=plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
 }
 if(s.id==='jazzyear'){
  date=html.match(/class=["']author-header["'][\s\S]*?<span class=["']time["']>([^<]+)/)?.[1];
  title=plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
 }
 if(s.id==='techweb'){
  const value=html.match(/class=["']infos["'][\s\S]*?class=["']time["']>([\d. :]+)/)?.[1];
  if(value)date=value.replaceAll('.','-').replace(' ','T')+'+08:00';
 }
 if(s.id==='cas')date=html.match(/发布时间:\s*<span[^>]*>([\d-]+)/)?.[1];
 if(s.id==='pku-wang')date=html.match(/(?:发布日期|发布时间)[：:\s]*(?:<[^>]*>\s*)*(\d{4}-\d{2}-\d{2})/)?.[1];
 if(s.id==='thu-dai')date=html.match(/<span[^>]*>时间[：:](\d{4}-\d{2}-\d{2})<\/span>/)?.[1];
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
  let url;try{url=new URL(plain(href),s.feed||s.website);}catch{continue;}
  if(url.origin!==new URL(s.website).origin||!new RegExp(s.linkPattern||'/news/[^/]+').test(url.pathname))continue;
  if(!links.includes(url.href))links.push(url.href);
 }
 const items=[];
 // No page crawling: only five same-origin recent article links.
 const limit=Math.min(s.maxArticles||5,12,links.length);
 for(let i=0;i<limit;i+=3)await Promise.all(links.slice(i,Math.min(i+3,limit)).map(async url=>{try{const item=parseArticle(await readBounded(url,fetcher),url,s);if(item)items.push(item);}catch{}}));
 return items;
}
/** Public publisher-rendered data only. Never execute downloaded JavaScript. */
export function parsePublisherList(html,s){
 const items=[];
 if(s.adapter==='kimi'){
  for(const part of html.split(/<div class="menu-card /).slice(1)){
   const href=part.match(/<a[^>]*href="([^"]+)"/)?.[1];
   const title=part.match(/<h4[^>]*>([\s\S]*?)<\/h4>/)?.[1];
   const date=part.match(/class="card-date[^"]*"[^>]*>(\d{4}-\d{2}-\d{2})/)?.[1];
   if(href){const row=record(s,title,new URL(href,s.website).href,date);if(row)items.push(row);}
  }
 }
 if(s.adapter==='seed-list'){
  for(const [,href,body] of html.matchAll(/<a\b[^>]*href="([^"]*\/blog\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)){
   const date=plain(body).match(/\b(\d{4}\.\d{2}\.\d{2})\b/)?.[1];
   const title=plain(body).split(date||'\0')[0];
   if(date){const row=record(s,title,new URL(href,s.website).href,date.replaceAll('.','-'));if(row)items.push(row);}
  }
 }
 if(s.adapter==='stepfun'){
  for(const [,slug,date,quotedTitle] of html.matchAll(/\{slug:"([a-z0-9-]+)",date:"(\d{4}-\d{2}-\d{2})",dateLabel:"[^"]*",title:("(?:\\.|[^"\\])*")/g)){
   try{const row=record(s,JSON.parse(quotedTitle),new URL(`/news/${slug}`,s.website).href,date);if(row)items.push(row);}catch{}
  }
 }
 if(s.adapter==='aipapers-list'){
  for(const [,href,date,title] of html.matchAll(/<a[^>]*href="(\/blog\/academic\/(\d{4}-\d{2}-\d{2}))"[^>]*>([\s\S]*?)<\/a>/g)){
   const clean=plain(title);if(clean.length<20)continue;
   const row=record(s,clean,new URL(href,s.website).href,date);if(row)items.push(row);
  }
 }
 if(s.adapter==='aiera'){
  for(const [,href,body] of html.matchAll(/<a class="art" href="([^"]+)">([\s\S]*?)<\/a>/g)){
   const title=body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1];
   const date=body.match(/<div class="m"><span>(\d{4}\.\d{2}\.\d{2})<\/span>/)?.[1]?.replaceAll('.','-');
   const row=record(s,title,new URL(href,s.website).href,date,body.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1]||'');if(row)items.push(row);
  }
 }
 if(s.adapter==='emnlp-news'){
  const table=html.match(/<table class="news-table">([\s\S]*?)<\/table>/)?.[1]||'';
  for(const [,date,body] of table.matchAll(/<tr>\s*<td>([^<]+)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)){
   const href=body.match(/href="([^"]+)"/)?.[1];if(!href)continue;
   const url=new URL(href,s.website);if(url.origin!==new URL(s.website).origin)continue;
   const parts=date.match(/([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/);
   const month=parts&&['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(parts[1].slice(0,3).toLowerCase())+1;
   if(!parts||!month)continue;
   const day=`${parts[3]}-${String(month).padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
   const row=record(s,plain(body),url.href,day,'',{dateLabel:'公告发布'});if(row)items.push(row);
  }
 }
 if(s.adapter==='naacl-news'){
  for(const [,href,date,title] of html.matchAll(/<a[^>]*href="(\/posts\/(\d{4}-\d{2}-\d{2})-[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)){
   const row=record(s,title,new URL(href,s.website).href,date,'',{dateLabel:'公告发布'});if(row)items.push(row);
  }
 }
 return [...new Map(items.map(e=>[e.url,e])).values()];
}
export function parseProductUpdates(text,s){
 const items=[];
 if(s.adapter==='zai-updates'){
  for(const [,date,title,body] of text.matchAll(/<Update label="(\d{4}-\d{2}-\d{2})" description="([^"]+)">([\s\S]*?)<\/Update>/g)){
   const summary=body.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/[*`\\]/g,'');
   const row=record(s,title,`${s.website}?update=${date}`,date,summary,{dateLabel:'产品更新'});if(row)items.push(row);
  }
 }
 if(s.adapter==='xai-updates'){
  const pageYear=text.match(/"dateModified":"(\d{4})-/)?.[1];
  if(!pageYear)return [];
  const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  for(const section of text.split(/<h2\b/).slice(1)){
   const heading=plain(section.slice(0,section.indexOf('</h2>'))).replace(/^[^>]*>/,'');
   const year=heading.match(/\b(20\d{2})\b/)?.[1]||pageYear;
   for(const part of section.split(/<div class="relative mt-12 grid/).slice(1)){
    const date=part.match(/<div class="relative">([A-Za-z]+) (\d{1,2})<span/);
    const month=date&&months.indexOf(date[1].slice(0,3).toLowerCase())+1;
    const titles=[...part.matchAll(/<h3\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g)];
    if(!date||!month||!titles.length)continue;
    const day=`${year}-${String(month).padStart(2,'0')}-${date[2].padStart(2,'0')}`;
    const row=record(s,titles.map(x=>plain(x[2])).join('；'),`${s.website}?update=${day}-${titles[0][1]}#${titles[0][1]}`,day,part.match(/<p>([\s\S]*?)<\/p>/)?.[1]||'',{dateLabel:'产品更新'});
    if(row)items.push(row);
   }
  }
 }
 return items;
}
export async function collectSource(s,fetcher=fetch){
 if(s.adapter==='directory'||!s.feed)throw Error(s.notice||'尚未找到可用的自动更新入口');
 const request=s.adapter==='latepost-api'?{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'page=1&limit=20&programa=1'}:s.adapter==='tencent-blog'?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageNum:1,pageSize:20,renderType:0})}:{};
 if(s.readerHeaders)request.headers={...request.headers,'User-Agent':'Mozilla/5.0','Accept':'application/rss+xml, application/xml, text/xml, */*'};
 if(s.uncompressed)request.headers={...request.headers,'Accept-Encoding':'identity'};
 let text=await readBounded(s.feed,fetcher,{...request,expectFeed:s.adapter==='rss'});
 if(s.adapter==='latepost-api'){
  const data=JSON.parse(text);
  // List dates omit the year. Fetch the article's explicit release_time instead.
  text=(data.data||[]).filter(x=>relevant({title:x.title,summary:x.abstract||''},s)).map(x=>x.detail_url).filter(x=>/^\/news\/dj_detail\?id=\d+$/.test(x)).map(href=>`<a href="${href}"></a>`).join('');
 }
 if(s.adapter==='stepfun'){
  const src=text.match(/<script\b[^>]*src="(https:\/\/www\.stepfun\.com\/assets\/index-[^"]+\.js)"/)?.[1];
  if(!src)throw Error('官方页面未提供可识别的公开新闻数据文件');
  text=await readBounded(src,fetcher);
 }
 let raw=s.adapter==='rss'?parseFeed(text,s):s.adapter==='anthropic'?parseAnthropic(text,s):['html','latepost-api'].includes(s.adapter)?await htmlArticles(text,s,fetcher):['tldr','rundown'].includes(s.adapter)?parseDatedList(text,s):s.adapter==='changelog'?parseChangelog(text,s):['kimi','seed-list','stepfun','aipapers-list','aiera','emnlp-news','naacl-news'].includes(s.adapter)?parsePublisherList(text,s):['xai-updates','zai-updates'].includes(s.adapter)?parseProductUpdates(text,s):parseStructured(text,s);
 if(!raw.length&&!(s.adapter==='rss'&&/<(?:rss|feed|rdf:RDF)\b/i.test(text)&&!/<(?:item|entry)\b/i.test(text)))throw Error('未解析到带有有效日期的内容');
 const filtered=raw.filter(e=>relevant(e,s)).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,35);
 const items=[];
 for(const e of filtered){const url=canonicalUrl(e.url);if(!url)continue;
  // Identity includes the publisher so multi-source attribution survives dedup.
  const item={...e,title:plain(e.title),summary:extractSnippet(e.summary),id:await stableId(`${s.id}:${url}`),category:topicFor(e,s),topics:[]};
  item.topics=[...new Set([s.section,item.category,s.contentLabel||contentType(e,s),...(s.adapter==='hf-models'?['开发者平台','模型仓库']:[])].filter(Boolean))];items.push(item);
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

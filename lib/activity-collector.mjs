import {activityEnd} from './activity-data.mjs';
import {plain,safeUrl} from './feed.mjs';
import {activitySources,activityPolicy} from '../config/activities.mjs';
const hosts=new Set([...activitySources.flatMap(s=>[s.feed,s.website,...(s.details||[])]).map(u=>new URL(u).hostname),'api2025.worldaic.com.cn','worldaic.com.cn','www.worldrobotconference.com','www.wicongress.org.cn','www.chtf.com','www.agicexpo.com','openai.com','www.openai.com','www.anthropic.com','gdg.community.dev','www.meetup.com','meetup.com','luma.com','lu.ma','www.hackathonweekly.com','hackathonweekly.com','devpost.com','www.devpost.com','hackertrip.cn']);
export function allowedActivityUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(hosts.has(u.hostname)||/^[a-z0-9-]+\.devpost\.com$/.test(u.hostname));}catch{return false;}}
export function jsonScripts(html,id){
 const out=[];for(const [,attrs,body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(id?!new RegExp(`\\bid=["']${id}["']`).test(attrs):! /type=["']application\/ld\+json["']/.test(attrs))continue;
  try{out.push(JSON.parse(body));}catch{}
 }return out;
}
const meta=(html,key)=>{for(const [tag] of html.matchAll(/<meta\b[^>]*>/gi)){if(tag.includes(`="${key}"`)||tag.includes(`='${key}'`))return plain(tag.match(/content=["']([^"']*)["']/)?.[1]||'');}return '';};
const pad=n=>String(n).padStart(2,'0');
const day=(y,m,d)=>{const x=`${y}-${pad(m)}-${pad(d)}`;return Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x?x:null;};
export function dateRange(text){
 const t=plain(text).replace(/\s+/g,'');
 const m=t.match(/(20\d{2})年(\d{1,2})月(\d{1,2})(?:日)?[-—–至~～](?:(\d{1,2})月)?(\d{1,2})日?/)
  ||t.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
 if(!m)return null;const start=day(+m[1],+m[2],+m[3]),end=day(+m[1],+(m[4]||m[2]),+(m[5]||m[3]));return start&&end&&end>=start?{start,end}:null;
}
function normalizedTime(value,china=false){
 if(!value)return null;const v=String(value).trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(v))return day(...v.split('-').map(Number));
 let t=v.replace(' ','T');if(!/(?:Z|[+-]\d\d:\d\d)$/.test(t)){if(!china)return day(...v.slice(0,10).split('-').map(Number));t+='+08:00';}
 return Number.isFinite(Date.parse(t))?t:null;
}
function englishDate(text){const m=String(text).match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})/);if(!m)return null;const n=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase())+1;return n?day(+m[3],n,+m[2]):null;}
export function activityRecord(s,v,now=Date.now()){
 const title=plain(v.title||'').slice(0,180),url=safeUrl(v.url||s.website);
 const start=normalizedTime(v.start,s.china!==false),end=normalizedTime(v.end,s.china!==false),deadline=normalizedTime(v.deadline,s.china!==false);
 if(!title||!url||(!start&&!deadline))return null;
 if(start&&end&&Date.parse(end)<Date.parse(start))return null;
 const format=v.format||'offline',date=start?.slice(0,10)||null;
 const track=activityPolicy.tracked.find(t=>new RegExp(t.pattern,'i').test(title));
 const pub=normalizedTime(v.publishedAt,true),publishedAt=pub&&Date.parse(pub)<=now?new Date(pub).toISOString():new Date(now).toISOString();
 const activityCandidate={date,endDate:end?.slice(0,10)||date,startAt:start?.includes('T')?start:null,endAt:end?.includes('T')?end:null,registrationDeadline:deadline,
  location:plain(v.location||s.city||'').slice(0,160),format,kind:v.kind||(/黑客松|hackathon/i.test(title)||s.section==='黑客松'?'hackathon':'conference'),url,
  ...(v.originalUrl&&safeUrl(v.originalUrl)?{originalUrl:safeUrl(v.originalUrl)}:{}),...(track?{trackedId:track.id}:{}),
  status:v.cancelled?'cancelled':v.tentative?'tentative':'scheduled',timezone:v.timezone||'Asia/Shanghai',dateEvidence:plain(v.evidence||[start,end,deadline].filter(Boolean).join(' / ')).slice(0,240),...(v.note?{note:plain(v.note).slice(0,180)}:{})};
 const section=activityCandidate.kind==='hackathon'?'黑客松':format==='online'?'线上发布会':'线下活动';
 return {id:'',kind:'article',activityListing:true,activityCandidate,publicationDateKnown:!!pub,sourceId:s.id,source:s.name,title,summary:plain(v.description||title).slice(0,1200),url,publishedAt,category:section,topics:[section],language:s.language||'zh',byline:'',duration:null,artwork:'',color:'#2563eb',dateLabel:pub?'公告发布':'首次发现'};
}
function address(location){if(typeof location==='string')return location;return [location?.name,typeof location?.address==='string'?location.address:location?.address?.streetAddress,location?.address?.addressLocality].filter(Boolean).join(' · ');}
export function parseEventJsonLd(html,s,url=s.website){
 const result=[],seen=new Set();function walk(x){if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(walk);return;}
  if(/(?:^|,)\w*Event(?:,|$)/.test(String(x['@type']))&&x.name&&(x.startDate||x.offers?.validThrough)){
   const row=activityRecord(s,{title:x.name,description:x.description,url:x.url||url,start:x.startDate,end:x.endDate,deadline:x.offers?.validThrough,location:address(x.location),format:/Online/.test(x.eventAttendanceMode)?'online':/Mixed/.test(x.eventAttendanceMode)?'hybrid':s.format||'offline',publishedAt:x.datePublished,cancelled:/Cancelled/.test(x.eventStatus),originalUrl:typeof x.sameAs==='string'?x.sameAs:x.offers?.url,timezone:x.startDate?.endsWith('+08:00')?'Asia/Shanghai':'见原站'});if(row&&!seen.has(row.url+row.activityCandidate.date)){seen.add(row.url+row.activityCandidate.date);result.push(row);}
  }
  if(x['@graph'])walk(x['@graph']);if(x.itemListElement)walk(x.itemListElement);if(x.item)walk(x.item);
 }jsonScripts(html).forEach(walk);return result;
}
export function parseActivityPage(html,s){
 const kind=s.activityAdapter,out=[];const push=v=>{const r=activityRecord(s,v);if(r)out.push(r);};
 if(kind==='meetup'){
  const state=jsonScripts(html,'__NEXT_DATA__')[0]?.props?.pageProps?.__APOLLO_STATE__;
  if(!state)throw Error('Meetup 活动数据未公开返回');
  for(const e of Object.values(state))if(e?.__typename==='Event'&&e.dateTime){const venue=state[e.venue?.__ref]||e.venue;push({title:e.title,url:e.eventUrl,start:e.dateTime,end:e.endTime,publishedAt:e.createdTime,description:e.description,location:address(venue),format:e.isOnline?'online':'offline',kind:'meetup',note:/check.*wechat|微信群|微信群.*地点/i.test(e.description||'')?'具体场地请以主办方本场公告为准':''});}
 }else if(kind==='aicon'){
  const data=jsonScripts(html,'__NUXT_DATA__')[0];if(!Array.isArray(data))throw Error('AICon 未返回届次数据');
  for(const e of data)if(e&&typeof e==='object'&&Number.isInteger(e.meetingBegin)){const title=data[e.name];if(!/AICon/i.test(title||''))continue;push({title,url:data[e.link],start:data[e.meetingBegin],end:data[e.meetingEnd],location:data[e.area],description:title});}
 }else if(kind==='anthropic'){
  for(const part of html.split(/<div role="listitem" class="event_list_item w-dyn-item">/).slice(1)){
   const field=name=>plain(part.match(new RegExp(`<div[^>]*fs-list-field="${name}"[^>]*>([\\s\\S]*?)<\\/div>`))?.[1]||'');
   if(field('format')!=='Virtual')continue;
   const href=part.match(/href="(\/events\/[^"#]+)"/)?.[1];if(href)push({title:field('title'),start:englishDate(field('date')),url:new URL(href,s.website).href,format:'online',timezone:'见原站'});
  }
 }else if(['chtf','gaitc','agic','wic','wrc','yunqi'].includes(kind)){
  const visible=plain(html),title=meta(html,'og:title')||plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]||s.name);let range,text='',location=s.city||'';
  if(kind==='yunqi'){
   text=meta(html,'og:description');const m=text.match(/(20\d{2}).*?(\d{1,2})\.(\d{1,2})[-—](\d{1,2})\.(\d{1,2})/);if(m)range={start:day(+m[1],+m[2],+m[3]),end:day(+m[1],+m[4],+m[5])};
  }else{
   const anchor=kind==='agic'?'展会时间':kind==='gaitc'?'会议时间':kind==='chtf'?'举办时间':kind==='wic'?'pc_news_content':null;
   const index=anchor?visible.indexOf(anchor):0;text=visible.slice(Math.max(0,index),Math.max(0,index)+600);range=dateRange(text);
   if(kind==='wic'){const m=visible.match(/(20\d{2})世界智能产业博览会[^。]*?将于(\d{1,2})月(\d{1,2})日?至(\d{1,2})日/);range=m?{start:day(+m[1],+m[2],+m[3]),end:day(+m[1],+m[2],+m[4])}:null;text=m?.[0]||'';}
   if(kind==='agic')location=visible.match(/展会地点[：:]?\s*([^。\n]{2,100})/)?.[1]?.split(/展会|主办|承办/)[0]||location;
  }
  if(range?.start&&range?.end)push({title:kind==='chtf'?`${range.start.slice(0,4)} 高交会 · 人工智能与机器人产业展`:kind==='agic'?`${range.start.slice(0,4)} ${s.name}`:title,url:s.eventUrl||s.website,start:range.start,end:range.end,description:text,location,evidence:text.slice(0,240),tentative:kind==='chtf'&&/拟于/.test(visible),note:kind==='agic'&&/2026年8月/.test(visible)?'官网正文残留往届日期；采用“展会时间”标注字段':''});
 }else out.push(...parseEventJsonLd(html,s));
 return [...new Map(out.map(x=>[x.url+':'+x.activityCandidate.date,x])).values()];
}
/** Read only public, allowlisted origins; validate every redirect. */
export async function collectActivities(s,fetcher,readBounded){
 const read=async(url,options={})=>readBounded(url,async(value,init)=>{let u=String(value);for(let i=0;i<5;i++){
  if(!allowedActivityUrl(u))throw Error('活动链接不在已核验来源内');const response=await fetcher(u,{...init,redirect:'manual'});
  if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw Error('活动页面跳转异常');u=new URL(next,u).href;continue;}return response;
 }throw Error('活动页面跳转过多');},options);
 const json=async(url,body)=>JSON.parse(await read(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}));
 let items=[],recognized=true;const kind=s.activityAdapter;
 if(kind==='waic'){
  const base='https://api2025.worldaic.com.cn/official/website/',intro=(await json(base+'conference/introduction/detail')).data;
  const range=dateRange(intro?.meetingTime||'');if(range){const r=activityRecord(s,{title:range.start.slice(0,4)+' 世界人工智能大会',start:range.start,end:range.end,location:intro.meetingVenue,evidence:intro.meetingTime});if(r)items.push(r);}
  const dates=(await json(base+'officialForum/queryOfficialForumParam')).data?.dateList;if(!Array.isArray(dates))throw Error('WAIC 未返回有效活动日期');
  const future=dates.map(x=>typeof x==='string'?x:x.value||x.date).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&x>=new Date(Date.now()+8*3600000).toISOString().slice(0,10)).sort().slice(0,activityPolicy.waicDates);
  for(const date of future){const list=(await json(base+'officialFront/queryOfficialFrontForumList',{forumTime:[date],pageNum:1,pageSize:activityPolicy.waicPerDate})).data;
   for(const e of (Array.isArray(list)?list:[]).slice(0,activityPolicy.waicPerDate)){if(!/^[a-zA-Z0-9-]+$/.test(e.uuid))continue;const v=(await json(base+'officialFront/queryOfficialFrontForum/'+e.uuid)).data;if(!v?.forumDate)continue;
    const r=activityRecord(s,{title:v.name,url:s.website+'events/forum/'+e.uuid,start:v.forumDate+'T'+v.startTime,end:v.forumDate+'T'+v.endTime,location:v.addr||v.forumAddr,description:v.introduction||v.name});if(r)items.push(r);
   }
  }
 }else if(kind==='weekly'||kind==='weekly-search'){
  const queries=kind==='weekly-search'?activityPolicy.keywords:[null];
  for(let i=0;i<queries.length;i+=2)await Promise.all(queries.slice(i,i+2).map(async q=>{
   const u=new URL(s.feed);if(q)u.searchParams.set('search',q);const data=await json(u.href);if(!Array.isArray(data?.data?.events))throw Error('活动平台未返回公开列表');
   for(const e of data.data.events){const r=activityRecord(s,{title:e.title,url:'https://www.hackathonweekly.com/events/'+(e.shortId||e.id),start:e.startTime,end:e.endTime,deadline:e.registrationDeadline,publishedAt:e.createdAt,location:e.address,format:e.isOnline?'online':'offline',kind:/HACKATHON/i.test(e.type)?'hackathon':'meetup',description:e.summary||e.description||e.title,timezone:e.timezone,cancelled:e.status==='CANCELLED'});if(r)items.push(r);}
  }));
 }else if(kind==='reactor'){
  const data=await json(s.feed);if(!Array.isArray(data.items))throw Error('Microsoft Reactor 未返回活动列表');
  for(const e of data.items){if(e.isTestEvent||Date.parse(e.endDateTimeUtc)<Date.now())continue;const r=activityRecord(s,{title:e.title,url:'https://developer.microsoft.com/reactor/events/'+e.id,start:e.startDateTimeUtc,end:e.endDateTimeUtc,format:'online',description:[e.title,...(e.tags||[]).map(t=>typeof t==='string'?t:t.name)].join(' '),location:'线上直播',timezone:'UTC'});if(r)items.push(r);}
 }else if(kind==='nvidia'){
  const data=await json(s.feed);if(!Array.isArray(data))throw Error('NVIDIA 未返回活动日历');
  const date=value=>{if(/^\d{4}-\d{2}-\d{2}/.test(value||''))return value.slice(0,10);const m=String(value).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);return m?day(m[3].length===2?2000+Number(m[3]):Number(m[3]),+m[1],+m[2]):null;};
  for(const e of data){if(!e.url)continue;const r=activityRecord(s,{title:e.title,url:e.url,start:date(e.startDate),end:date(e.endDate),format:/virtual|online/i.test(e.location+' '+e.venue)?'online':'offline',location:[e.location,e.venue].filter(Boolean).join(' · '),description:e.title,timezone:'见原站'});if(r)items.push(r);}
 }else if(kind==='devpost'){
  const data=await json(s.feed);if(!Array.isArray(data.hackathons))throw Error('Devpost 未返回公开比赛列表');
  for(const e of data.hackathons){const p=e.submission_period_dates||'',year=p.match(/(20\d{2})/)?.[1],last=p.split(' - ').at(-1);const deadline=englishDate(last)||englishDate(last+', '+year)||englishDate((p.match(/^[A-Za-z]+/)?.[0]||'')+' '+last);if(!deadline)continue;
   const r=activityRecord(s,{title:e.title,url:e.url,deadline,location:e.displayed_location?.location,format:/online/i.test(e.displayed_location?.location||'')?'online':'offline',kind:'hackathon',description:(e.themes||[]).map(x=>x.name).join('、')+'；提交期：'+p,timezone:'见原站',evidence:p});if(r)items.push(r);
  }
 }else if(kind==='gdg'){
  const html=await read(s.feed),data=jsonScripts(html,'__NEXT_DATA__')[0]?.props?.pageProps?.prerenderData?.upcomingEvents?.results;
  if(!Array.isArray(data))throw Error('GDG 未返回公开场次');
  for(const e of data.slice(0,activityPolicy.maxDetails)){const parsed=parseEventJsonLd(await read(e.url),s,e.url);items.push(...parsed);}
 }else if(kind==='luma'){
  const html=await read(s.feed),data=jsonScripts(html,'__NEXT_DATA__')[0]?.props?.pageProps?.initialData?.data;
  if(!data)throw Error('Luma 未返回公开日历');
  const urls=new Set(s.details||[]);for(const e of (Array.isArray(data.upcoming)?data.upcoming:data.upcoming?.entries)||[]){const slug=e.event?.url||e.url;if(slug)urls.add(new URL(slug,'https://luma.com/').href);}
  for(const url of [...urls].slice(0,activityPolicy.maxDetails))items.push(...parseEventJsonLd(await read(url),s,url));
 }else if(kind==='hackertrip'){
  const html=await read(s.feed),urls=[...new Set([...html.matchAll(/href=["'](\/hackathon\/[^"'#?]+)["']/g)].filter(x=>!/^\/hackathon\/(city|theme)\//.test(x[1])).map(x=>new URL(x[1],s.website).href))];
  if(!urls.length)throw Error('黑客松搜索未返回可核验活动链接');
  for(const url of urls.slice(0,activityPolicy.maxDetails))items.push(...parseEventJsonLd(await read(url),s,url));
 }else if(kind==='wrc'){
  const html=await read(s.feed),links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g)].filter(x=>/世界机器人大会/.test(plain(x[2]))&&/\d{4}/.test(plain(x[2]))).map(x=>new URL(x[1],s.website).href);
  const urls=[...new Set([...links.filter(u=>/\/news\/latestnews\//.test(u)).sort((a,b)=>Number(b.match(/(\d+)\.html/)?.[1]||0)-Number(a.match(/(\d+)\.html/)?.[1]||0)).slice(0,2),'https://www.worldrobotconference.com/news/latestnews/3218.html'])];
  for(const url of urls){const body=plain(await read(url)),m=body.match(/(20\d{2})世界机器人大会将于(\d{1,2})月(\d{1,2})日?至(\d{1,2})日/);
   if(!m)continue;const start=day(+m[1],+m[2],+m[3]),end=day(+m[1],+m[2],+m[4]);const row=activityRecord(s,{title:m[1]+' 世界机器人大会',url,start,end,location:'北京经济技术开发区',description:m[0],evidence:m[0]});if(row)items.push(row);break;
  }
 }else if(kind==='wic'){
  const html=await read(s.feed),href=[...html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g)].find(x=>/大会简介|博览会简介/.test(plain(x[2])))?.[1];
  if(!href)throw Error('WIC 未找到当届简介');const url=new URL(href,s.website).href;items=parseActivityPage(await read(url),{...s,eventUrl:url});
 }else{const html=await read(s.feed);items=parseActivityPage(html,s);recognized=items.length>0;}
 if(!recognized||(!items.length&&!['weekly','weekly-search','luma','gdg','devpost'].includes(kind)))throw Error('未解析到可核验活动日期，保留上次结果');
 const recent=items.filter(x=>activityEnd(x.activityCandidate)>=Date.now()-activityPolicy.historyDays*86400000);
 const filtered=s.filterAI?recent.filter(x=>new RegExp(activityPolicy.aiPattern,'i').test(x.title+' '+x.summary)):recent;
 const unique=[...new Map(filtered.map(x=>[x.url+':'+(x.activityCandidate.date||x.activityCandidate.registrationDeadline),x])).values()];
 unique.sort((a,b)=>{const time=x=>Date.parse(x.activityCandidate.startAt||x.activityCandidate.date||x.activityCandidate.registrationDeadline);const af=time(a)>=Date.now(),bf=time(b)>=Date.now();return Number(bf)-Number(af)||(af?time(a)-time(b):time(b)-time(a));});
 return unique.slice(0,activityPolicy.maxEventsPerSource);
}

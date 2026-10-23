import {parseFeed,plain,stableId} from './feed.mjs';
import {publishedEditions,editionText} from './distribution.mjs';

const FEED_HOSTS=['feeds.fireside.fm','feed.xyzfm.space','api.substack.com','feeds.megaphone.fm','feeds.simplecast.com','feeds.transistor.fm','lexfridman.com','feeds.buzzsprout.com','rss.art19.com','anchor.fm','feeds.acast.com','feeds.redcircle.com','feeds.captivate.fm','feeds.libsyn.com','feeds.soundon.fm','feeds.podcastmirror.com','feeds.soundcloud.com','feeds.spreaker.com','podcast.rss.com','pinecast.com','www.pinecast.com','www.omnycontent.com','omnycontent.com','feeds.omny.fm','feed.podbean.com','rss.com','feeds.feedburner.com','podcasts.files.bbci.co.uk','apple.dwarkesh-podcast.workers.dev'];
const PAGE_HOSTS=['podcasts.apple.com','itunes.apple.com','www.youtube.com','youtube.com','m.youtube.com','www.xiaoyuzhoufm.com','xiaoyuzhoufm.com'];
export function publicUrl(value){
 let u;try{u=new URL(value);}catch{throw Error('请粘贴完整的节目链接');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||u.hostname.endsWith('.')||u.href.length>1800)throw Error('链接格式不支持');
 u.hash='';return u;
}
export function allowedFeed(value){
 const u=publicUrl(value),h=u.hostname.toLowerCase();
 return FEED_HOSTS.includes(h)||/^[a-z0-9-]+\.(?:substack\.com|libsyn\.com|podbean\.com|buzzsprout\.com|pinecast\.co)$/.test(h)||(h==='www.ximalaya.com'&&/^\/album\/\d+\.xml$/.test(u.pathname))||(h==='www.youtube.com'&&u.pathname==='/feeds/videos.xml'&&/^UC[\w-]{22}$/.test(u.searchParams.get('channel_id')||''));
}
/** Public podcast hosts only; validate every redirect before issuing a request. */
export async function subscriptionRead(value,fetcher=fetch,{page=false,feed=false}={}){
 let u=publicUrl(value);
 for(let hops=0;hops<4;hops++){
  if(!allowedFeed(u.href)&&!(page&&PAGE_HOSTS.includes(u.hostname)))throw Error('暂不支持该 RSS 域名，请使用 Apple Podcasts 节目链接');
  const r=await fetcher(u.href,{redirect:'manual',headers:{'User-Agent':'DayDayAI/1.0 RSS reader','Accept':'application/rss+xml,application/atom+xml,application/xml,text/xml,application/json,text/html;q=0.8,*/*;q=0.5'},signal:AbortSignal.timeout(18000)});
  if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');await r.body?.cancel();if(!location)throw Error('节目地址跳转异常');u=publicUrl(new URL(location,u).href);continue;}
  if(!r.ok){await r.body?.cancel();throw Error(`节目平台暂时无法读取（HTTP ${r.status}）`);}
  const reader=r.body?.getReader();if(!reader)throw Error('节目平台返回空内容');
  let text='',bytes=0;const decoder=new TextDecoder();
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4_000_000)throw Error('节目内容超过读取上限');text+=decoder.decode(value,{stream:true});if(feed&&(text.match(/<\/(?:item|entry)>/g)||[]).length>=18)break;}}finally{await reader.cancel().catch(()=>{});}
  return text+decoder.decode();
 }
 throw Error('节目链接跳转次数过多');
}
export function feedTitle(xml){return plain(xml.match(/<(?:channel|feed)\b[^>]*>[\s\S]*?<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').slice(0,180);}
export async function showFromFeed(feed,{name='',website='',platform='播客',language=''}={},fetcher=fetch){
 if(!allowedFeed(feed))throw Error('暂不支持这个托管平台，请换用支持的平台 RSS 或 Apple Podcasts 链接');
 const xml=await subscriptionRead(feed,fetcher,{feed:true});
 const id='show-'+await stableId(feed),title=feedTitle(xml)||name;
 if(!title)throw Error('未识别到节目名称');
 const show={id,name:title,feed,website:website||feed,platform,language,kind:'podcast',color:'#2563eb'};
 const raw=parseFeed(xml,show);
 if(!raw.length)throw Error('没有读到带有有效日期的节目，暂时无法关注');
 const episodes=await Promise.all(raw.map(async e=>({...e,id:await stableId(`${id}:${e.url}`),summary:e.summary.slice(0,320),topics:[platform==='YouTube'?'视频':'播客']})));
 return {show,episodes};
}
export async function resolveShow(value,catalog=[],fetcher=fetch){
 const u=publicUrl(value);
 const appleId=['podcasts.apple.com','itunes.apple.com'].includes(u.hostname)?u.pathname.match(/(?:^|\/)id(\d+)(?:\/|$)/)?.[1]:null;
 const known=catalog.find(s=>s.kind==='podcast'&&(s.feed===u.href||s.website===u.href||s.appleUrl?.split('?')[0]===u.href.split('?')[0]||(appleId&&s.appleUrl?.match(/\/id(\d+)(?:[/?]|$)/)?.[1]===appleId)));
 if(known)return showFromFeed(known.feed,{name:known.name,website:known.appleUrl||known.website,language:known.language,platform:'Apple Podcasts'},fetcher);
 if(['podcasts.apple.com','itunes.apple.com'].includes(u.hostname)){
  const id=u.pathname.match(/(?:^|\/)id(\d+)(?:\/|$)/)?.[1];if(!id)throw Error('请粘贴 Apple Podcasts 节目主页链接');
  const country=/^[a-z]{2}$/.test(u.pathname.split('/')[1])?u.pathname.split('/')[1]:'us';
  let data;
  try{data=JSON.parse(await subscriptionRead(`https://itunes.apple.com/lookup?id=${id}&entity=podcast&country=${country}`,fetcher,{page:true}));}
  catch{throw Error('Apple 节目查询暂不可用，请粘贴该节目的公开 RSS 链接');}
  const p=data.results?.find(x=>String(x.collectionId)===id&&x.feedUrl);
  if(!p)throw Error('Apple Podcasts 暂未返回这个节目的 RSS');
  return showFromFeed(p.feedUrl,{name:p.collectionName,website:p.collectionViewUrl||u.href,platform:'Apple Podcasts'},fetcher);
 }
 if(['www.youtube.com','youtube.com','m.youtube.com'].includes(u.hostname)){
  let id=u.pathname.match(/^\/channel\/(UC[\w-]{22})(?:\/|$)/)?.[1]||u.searchParams.get('channel_id');
  if(!id){
   if(!/^\/(?:@[^/?]+|c\/[^/?]+|user\/[^/?]+)(?:\/(?:videos|featured|podcasts))?\/?$/.test(u.pathname))throw Error('请粘贴 YouTube 频道主页，不是单条视频链接');
   u.hostname='www.youtube.com';u.search='';
   const html=await subscriptionRead(u.href,fetcher,{page:true});
   id=html.match(/"externalId"\s*:\s*"(UC[\w-]{22})"/)?.[1]||html.match(/channel_id=(UC[\w-]{22})/)?.[1]||html.match(/<meta[^>]*itemprop="channelId"[^>]*content="(UC[\w-]{22})"/)?.[1];
  }
  if(!/^UC[\w-]{22}$/.test(id||''))throw Error('没有识别到频道 ID，请使用 youtube.com/channel/… 链接');
  return showFromFeed(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`,{website:`https://www.youtube.com/channel/${id}`,platform:'YouTube'},fetcher);
 }
 if(['www.xiaoyuzhoufm.com','xiaoyuzhoufm.com'].includes(u.hostname))throw Error('小宇宙主页暂不提供可直接读取的订阅入口，请粘贴同一节目的 Apple Podcasts 或 RSS 链接');
 if(!allowedFeed(u.href))throw Error('请使用 Apple Podcasts、YouTube 频道或支持的公开 RSS 链接');
 return showFromFeed(u.href,{},fetcher);
}
export const defaultReminderPreferences={enabled:false,episodes:true,daily:false,weekly:false,time:'08:00',quiet:true};
export function reminderPreferences(input){
 const p={...defaultReminderPreferences,...input};
 if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.time))throw Error('提醒时间格式不正确');
 for(const k of ['enabled','episodes','daily','weekly','quiet'])if(typeof p[k]!=='boolean')throw Error('提醒设置格式不正确');
 return Object.fromEntries(Object.keys(defaultReminderPreferences).map(k=>[k,p[k]]));
}
export function chinaTime(date=new Date()){
 const d=new Date(date.getTime()+8*3600000);return {day:d.toISOString().slice(0,10),time:d.toISOString().slice(11,16),hour:d.getUTCHours(),weekday:d.getUTCDay()};
}
export function deliveryDue(p,kind,date=new Date()){
 const c=chinaTime(date);if(!p.enabled||(p.quiet&&(c.hour<8||c.hour>=22)))return false;
 if(kind==='episode')return p.episodes;
 return p[kind]&&c.time>=p.time&&(kind!=='weekly'||c.weekday===1);
}
export function briefText(state,kind){
 return editionText(publishedEditions(state,kind)[0],kind);
}
export async function encryptBot(value,key){
 if(!/^[a-f0-9]{64}$/.test(key||''))throw Error('提醒加密尚未配置');
 const k=await crypto.subtle.importKey('raw',Uint8Array.from(key.match(/../g),x=>parseInt(x,16)),{name:'AES-GCM'},false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(JSON.stringify(value))));
 return JSON.stringify({iv:Array.from(iv),data:Array.from(data)});
}
export async function decryptBot(value,key){
 if(!/^[a-f0-9]{64}$/.test(key||''))throw Error('提醒加密尚未配置');
 const k=await crypto.subtle.importKey('raw',Uint8Array.from(key.match(/../g),x=>parseInt(x,16)),{name:'AES-GCM'},false,['decrypt']);
 const x=JSON.parse(value);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(x.iv)},k,new Uint8Array(x.data))));
}

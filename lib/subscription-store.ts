import {env} from 'cloudflare:workers';
import catalog from '../data/catalog.json';
import podcastLinks from '../data/podcast-links.json';
import {stableId} from './feed.mjs';
import {resolveShow,showFromFeed,defaultReminderPreferences,reminderPreferences,encryptBot,decryptBot,normalizedReminderPreferences,briefText} from './subscriptions.mjs';
import {sendFeishu,notificationText,validateWebhook} from './feishu.mjs';
import {publicState} from './news-store';
import {deliveryParts,deliveryItems,dailyDeliveryItems,dailyDeliveryParts,dailyNoticeId} from './delivery-content.mjs';
import {deliveryPolicy} from '../config/delivery.mjs';
import type {Entry} from './types';

type Runtime={DB?:D1Database;REMINDER_ENCRYPTION_KEY?:string};
const runtime=()=>env as Runtime;
const db=()=>{if(!runtime().DB)throw Error('数据库暂不可用');return runtime().DB!;};
type DeliveryKind='activities'|'episodes'|'hot';
type Reader={id:string;preferences:string;bot:string|null};
type Show={id:string;name:string;feed:string;website:string;platform:string;language:string;kind:string;color:string;artwork?:string};
type ShowRow={id:string;data:string;checked_at:string;error:string|null};
type Prefs={version:number;enabled:boolean;activities:boolean;episodes:boolean;hot:boolean};
async function setting<T>(key:string,fallback:T){const row=await db().prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{value:string}>();return row?JSON.parse(row.value) as T:fallback;}
async function set(key:string,value:unknown){await db().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();}
export async function readerId(request:Request){
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('浏览器关注凭证无效，请刷新页面');
 return stableId('reader:'+token);
}
async function ensureReader(id:string){await db().prepare('INSERT OR IGNORE INTO readers(id,preferences,created_at) VALUES(?,?,?)').bind(id,JSON.stringify(defaultReminderPreferences),new Date().toISOString()).run();}
async function reader(id:string){return db().prepare('SELECT id,preferences,bot FROM readers WHERE id=?').bind(id).first<Reader>();}
export async function limitAction(request:Request,id:string){
 // A small rolling window limits network lookups without retaining raw IP addresses.
 const ip=request.headers.get('cf-connecting-ip')||'unknown',window=Math.floor(Date.now()/60000);
 const key='subscription_rate:'+await stableId(ip)+':'+window;
 const row=await db().prepare("INSERT INTO settings(key,value) VALUES(?,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(settings.value AS INTEGER)+1 RETURNING value").bind(key).first<{value:string}>();
 if(Number(row?.value)>30)throw Error('操作较频繁，请一分钟后再试');
 await ensureReader(id);
}
async function saveShow(show:Show,episodes:Entry[]){
 const at=new Date().toISOString();
 await db().prepare('INSERT INTO shows(id,data,checked_at,error) VALUES(?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at,error=NULL').bind(show.id,JSON.stringify(show),at).run();
 if(episodes.length)await db().batch(episodes.map(e=>db().prepare("INSERT INTO entries(id,kind,source_id,published_at,discovered_at,data) VALUES(?,'episode',?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,published_at=excluded.published_at").bind(e.id,show.id,e.publishedAt,at,JSON.stringify(e))));
}
export async function subscriptionState(id:string){
 const [r,rows,logs]=await Promise.all([reader(id),db().prepare('SELECT s.data,s.checked_at,s.error,f.followed_at,f.mode FROM subscriptions f JOIN shows s ON s.id=f.show_id WHERE f.reader_id=? ORDER BY f.followed_at DESC').bind(id).all<{data:string;checked_at:string;error:string|null;followed_at:string;mode:string}>(),db().prepare('SELECT id,kind,status,created_at AS createdAt,message FROM notices WHERE reader_id=? ORDER BY created_at DESC LIMIT 20').bind(id).all()]);
 const followed=rows.results.map(x=>{
  const show=JSON.parse(x.data) as Show;
  const known=catalog.find(s=>s.feed===show.feed);
  return {...show,artwork:show.artwork||known?.artwork||'',checkedAt:x.checked_at,error:x.error,followedAt:x.followed_at,mode:x.mode};
 });
 const episodes=await db().prepare("SELECT e.data FROM entries e JOIN subscriptions f ON f.show_id=e.source_id WHERE f.reader_id=? AND e.kind='episode' ORDER BY e.published_at DESC LIMIT 100").bind(id).all<{data:string}>();
 const [job,episodeJob]=await Promise.all([setting('subscription_job_status',null),setting('episode_job_status',null)]);
 return {shows:followed,episodes:episodes.results.map(x=>JSON.parse(x.data) as Entry),preferences:normalizedReminderPreferences(r?JSON.parse(r.preferences):{}) as Prefs,connected:!!r?.bot,deliveries:logs.results,job,episodeJob};
}
export async function previewShow(url:string){return resolveShow(url,[...catalog,...podcastLinks.shows]);}
export async function follow(id:string,showId:string,active:boolean,mode='instant'){
 if(!['instant','digest','off'].includes(mode))throw Error('提醒方式不正确');
 const key=id+':'+showId;
 if(!active){await db().prepare('DELETE FROM subscriptions WHERE id=? AND reader_id=?').bind(key,id).run();return;}
 const show=await db().prepare('SELECT id FROM shows WHERE id=?').bind(showId).first();if(!show)throw Error('请先识别节目链接');
 const count=await db().prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE reader_id=?').bind(id).first<{n:number}>();
 const exists=await db().prepare('SELECT id FROM subscriptions WHERE id=?').bind(key).first();
 if(!exists&&(count?.n||0)>=40)throw Error('目前每个浏览器最多关注 40 个节目');
 await db().prepare('INSERT INTO subscriptions(id,reader_id,show_id,followed_at,mode) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode').bind(key,id,showId,new Date().toISOString(),mode).run();
}
export async function resolveAndSave(url:string){
 const value=await previewShow(url);await saveShow(value.show as Show,value.episodes as Entry[]);return {show:value.show,episodes:value.episodes.slice(0,3)};
}
export async function refreshFollowed(id:string,showId:string){
 const row=await db().prepare('SELECT s.* FROM shows s JOIN subscriptions f ON f.show_id=s.id WHERE f.reader_id=? AND s.id=?').bind(id,showId).first<ShowRow>();
 if(!row)throw Error('尚未关注这个节目');
 if(Date.now()-Date.parse(row.checked_at)<5*60000)return {cached:true};
 await updateShow(row);return {cached:false};
}
async function updateShow(row:ShowRow){
 const s=JSON.parse(row.data) as Show;
 try{const result=await showFromFeed(s.feed,s);await saveShow({...s,...result.show} as Show,result.episodes as Entry[]);return true;}
 catch(e){await db().prepare('UPDATE shows SET checked_at=?,error=? WHERE id=?').bind(new Date().toISOString(),e instanceof Error?e.message.slice(0,140):'节目更新失败',row.id).run();return false;}
}
export async function configure(id:string,input:unknown){
 const p=reminderPreferences(input) as Prefs;
 if(p.enabled&&!(await reader(id))?.bot)throw Error('请先连接飞书机器人');
 await db().prepare('UPDATE readers SET preferences=? WHERE id=?').bind(JSON.stringify(p),id).run();
}
export async function connectBot(id:string,webhook:string,secret:string){
 if(!validateWebhook(webhook))throw Error('请填写飞书自定义机器人的 Webhook');
 if(secret.length>200)throw Error('签名密钥格式不正确');
 const value=await encryptBot({webhook,secret},runtime().REMINDER_ENCRYPTION_KEY);
 await db().prepare('UPDATE readers SET bot=? WHERE id=?').bind(value,id).run();
}
export async function disconnectBot(id:string){
 const r=await reader(id);const p={...defaultReminderPreferences,...JSON.parse(r?.preferences||'{}'),enabled:false};
 await db().prepare('UPDATE readers SET bot=NULL,preferences=? WHERE id=?').bind(JSON.stringify(p),id).run();
}
export async function previewMessage(id:string,kind:string){
 if(!['activities','episodes','hot','daily','weekly'].includes(kind))throw Error('请选择分发内容');
 if(kind==='episodes'){
  const s=await subscriptionState(id);return s.episodes.length?notificationText(s.episodes.slice(0,5),true):'';
 }
 const state=await publicState();
 if(kind==='daily'||kind==='weekly')return briefText(state,kind);
 return deliveryParts(deliveryItems(state)[kind as DeliveryKind],kind).map((p:{text:string})=>p.text).join('\n\n—— 下一条 ——\n\n');
}
export async function preparePreview(id:string,kind:string){
 const state=kind==='episodes'?await subscriptionState(id):await publicState();
 const items=deliveryItems(state,kind==='episodes'?(state as {episodes:Entry[]}).episodes:[])[kind as DeliveryKind];
 const parts=items?deliveryParts(items,kind).map((p:{text:string})=>p.text):[await previewMessage(id,kind)].filter(Boolean);
 const text=parts.join('\n\n—— 下一条 ——\n\n');
 await set('subscription_preview:'+id,{kind,text,parts,expiresAt:Date.now()+30*60000});
 return {text};
}
async function deliver(r:Reader,ids:string[],kind:string,text:string){
 if(!r.bot)throw Error('请先连接飞书机器人');
 const bot=await decryptBot(r.bot,runtime().REMINDER_ENCRYPTION_KEY),at=new Date().toISOString();
 let count=0;
 for(let start=0;start<ids.length;start+=50){
  const claims=await db().batch(ids.slice(start,start+50).map(id=>db().prepare("INSERT OR IGNORE INTO notices(id,reader_id,kind,status,created_at,message) VALUES(?,?,?,'sending',?,'等待回执')").bind(id,r.id,kind,at)));
  count+=claims.reduce((n,claim)=>n+(claim.meta.changes||0),0);
 }
 if(count!==ids.length){
  // Job mutex ensures multi-item claims are unique. Never resend an ambiguous claim.
  return {status:'skipped',message:'这条提醒已经处理',count:0};
 }
 const throttleKey='feishu_last_send:'+await stableId(bot.webhook);
 const last=await setting(throttleKey,0);
 const wait=deliveryPolicy.minSendIntervalMs-(Date.now()-last);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
 await set(throttleKey,Date.now());
 let result;
 try{result=await sendFeishu(bot.webhook,bot.secret,text);}catch{result={status:'unknown',message:'未收到明确回执，请核对飞书群；不会自动重复发送'};}
 for(let start=0;start<ids.length;start+=50)await db().batch(ids.slice(start,start+50).map(id=>db().prepare('UPDATE notices SET status=?,message=? WHERE id=? AND reader_id=?').bind(result.status,result.message,id,r.id)));
 return {...result,count};
}
export async function sendPreview(id:string,kind:string){
 const r=await reader(id);if(!r?.bot)throw Error('请先连接飞书机器人');
 const preview=await setting<{kind:string;text:string;parts?:string[];expiresAt:number}|null>('subscription_preview:'+id,null);
 if(kind!=='test'&&(!preview||preview.kind!==kind||preview.expiresAt<Date.now()))throw Error('请先重新预览，再发送');
 const text=kind==='test'?'DayDay AI · 连接测试\n飞书机器人已连接。\n每天一点，跟上 AI。':preview!.text;
 if(!text)throw Error('当前没有可发送的内容');
 const parts=kind==='test'?[text]:preview?.parts||[text];
 const key='subscription_preview_send:'+id;
 const saved=await setting<{text:string;cursor:number}|null>(key,null);let cursor=kind!=='test'&&saved?.text===text?saved.cursor:0,processed=0;
 while(cursor<parts.length&&processed<deliveryPolicy.messagesPerRequest){
  const result=await deliver(r,[id+':manual:'+crypto.randomUUID()],kind,parts[cursor]);
  cursor++;processed++;await set(key,{text,cursor});
  if(result.status!=='sent')return result;
 }
 const complete=cursor===parts.length;return {status:'sent',message:complete?'飞书已接收全部内容':'已发送本批，继续发送剩余内容',complete};
}
type Publication={runId:string;publishedAt:string;hot:Entry[];activities:Entry[]};
async function dispatchEpisodes(r:Reader){
 const p=normalizedReminderPreferences(JSON.parse(r.preferences));let sent=0;
 if(!r.bot||!p.enabled||!p.episodes)return {sent:0,complete:true};
 const rows=await db().prepare(`SELECT e.id,e.data FROM entries e JOIN subscriptions f ON e.source_id=f.show_id
  LEFT JOIN notices n ON n.id=(?||':episode:'||e.id)
  WHERE f.reader_id=? AND e.kind='episode' AND f.mode!='off' AND e.published_at>f.followed_at
  AND e.published_at>? AND n.id IS NULL ORDER BY e.published_at ASC LIMIT 200`).bind(r.id,r.id,new Date(Date.now()-deliveryPolicy.episodeLookbackDays*86400000).toISOString()).all<{id:string;data:string}>();
 const parts=deliveryParts(rows.results.map(x=>JSON.parse(x.data)),'episodes');
 for(const part of parts.slice(0,deliveryPolicy.messagesPerRequest)){
  const result=await deliver(r,part.ids.map((id:string)=>r.id+':episode:'+id),'episodes',part.text);
  if(result.status==='sent')sent++;
 }
 return {sent,complete:parts.length<=deliveryPolicy.messagesPerRequest&&rows.results.length<200};
}
async function dispatchDaily(r:Reader,publication:Publication){
 const p=normalizedReminderPreferences(JSON.parse(r.preferences));let sent=0;
 if(!r.bot||!p.enabled)return {sent:0,complete:true};
 const at=Date.parse(publication.publishedAt),groups=dailyDeliveryItems(publication,at);
 const existing=new Set((await db().prepare('SELECT id FROM notices WHERE reader_id=?').bind(r.id).all<{id:string}>()).results.map(x=>x.id));
 for(const kind of deliveryPolicy.dailyCategories as ('hot'|'activities')[]){
  groups[kind]=p[kind as 'hot'|'activities']?groups[kind].filter((x:Entry)=>{
   const key=r.id+':'+dailyNoticeId(kind,x,at);
   return !existing.has(key)&&!(kind==='activities'&&!key.endsWith(':upcoming')&&existing.has(key+':upcoming'));
  }):[];
 }
 const parts=dailyDeliveryParts(groups,at);
 for(const part of parts.slice(0,deliveryPolicy.messagesPerRequest)){
  const result=await deliver(r,part.ids.map((id:string)=>r.id+':'+id),'daily',part.text);
  if(result.status==='sent')sent++;
 }
 return {sent,complete:parts.length<=deliveryPolicy.messagesPerRequest};
}
// Shared lease serializes daily and episode dispatch, including the robot rate limit.
async function acquireDeliveryLease(){
 const lease=String(Date.now()+240000);
 const lock=await db().prepare("INSERT INTO settings(key,value) VALUES('subscription_job_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key").bind(lease,Date.now()).first();
 return lock?lease:null;
}
async function releaseDeliveryLease(lease:string){await db().prepare("DELETE FROM settings WHERE key='subscription_job_lock' AND value=?").bind(lease).run();}
/** Nightly published hotspots and activities only. Episode polling is independent. */
export async function runSubscriptionJob(){
 const publication=await setting<Publication|null>('nightly_publication',null);
 const nightly=await setting<{day:string;phase:string}|null>('nightly_update',null);
 if(!publication||publication.runId!==nightly?.day||!['subscriptions','complete'].includes(nightly.phase))return {blocked:true,complete:false,reason:'等待本轮网站发布完成'};
 const lease=await acquireDeliveryLease();if(!lease)return {busy:true,complete:false};
 try{
  if(await setting('subscription_completed_run','')===publication.runId)return {complete:true,alreadyCompleted:true};
  if(await setting('subscription_active_run','')!==publication.runId||await setting('subscription_job_phase','')==='shows'){
   await set('subscription_job_phase','readers');await set('subscription_job_cursor','');await set('subscription_active_run',publication.runId);
  }
  const cursor=await setting('subscription_job_cursor','');
  const r=await db().prepare("SELECT id,preferences,bot FROM readers WHERE id>? AND bot IS NOT NULL ORDER BY id LIMIT 1").bind(cursor).first<Reader>();
  if(r){
   const result=await dispatchDaily(r,publication);
   if(result.complete)await set('subscription_job_cursor',r.id);
   await set('subscription_job_status',{checkedAt:new Date().toISOString(),phase:'推送今日热点与活动'});
   return {busy:false,sent:result.sent,complete:false};
  }
  await set('subscription_completed_run',publication.runId);
  await set('subscription_job_status',{checkedAt:new Date().toISOString(),phase:'每日推送完成'});
  return {busy:false,sent:0,complete:true};
 }finally{await releaseDeliveryLease(lease);}
}
type EpisodeRun={id:string;phase:'shows'|'readers'|'complete';cursor:string;checked:number;failed:number;sent:number;startedAt:string;finishedAt?:string};
/** One durable run per 30-minute slot. Unfinished runs resume before a new slot starts. */
export async function runEpisodeJob(date=new Date()){
 const slot=new Date(Math.floor(date.getTime()/(deliveryPolicy.episodePollMinutes*60000))*deliveryPolicy.episodePollMinutes*60000).toISOString();
 const lease=await acquireDeliveryLease();if(!lease)return {busy:true,complete:false};
 try{
  let run=await setting<EpisodeRun|null>('episode_poll_run',null);
  if(run?.phase==='complete'&&run.id===slot)return {complete:true,alreadyCompleted:true,runId:run.id,checked:run.checked,failed:run.failed,sent:run.sent};
  if(!run||run.phase==='complete')run={id:slot,phase:'shows',cursor:'',checked:0,failed:0,sent:0,startedAt:date.toISOString()};
  if(run.phase==='shows'){
   const rows=await db().prepare('SELECT s.* FROM shows s WHERE s.id>? AND EXISTS(SELECT 1 FROM subscriptions f WHERE f.show_id=s.id) ORDER BY s.id LIMIT 4').bind(run.cursor).all<ShowRow>();
   const results=await Promise.all(rows.results.map(row=>updateShow(row)));
   run.checked+=rows.results.length;run.failed+=results.filter(ok=>!ok).length;
   if(rows.results.length===4)run.cursor=rows.results.at(-1)!.id;
   else{run.phase='readers';run.cursor='';}
  }else{
   const r=await db().prepare("SELECT id,preferences,bot FROM readers WHERE id>? AND bot IS NOT NULL ORDER BY id LIMIT 1").bind(run.cursor).first<Reader>();
   if(r){const result=await dispatchEpisodes(r);run.sent+=result.sent;if(result.complete)run.cursor=r.id;}
   else{run.phase='complete';run.finishedAt=new Date().toISOString();}
  }
  await set('episode_poll_run',run);
  await set('episode_job_status',{checkedAt:new Date().toISOString(),phase:run.phase==='complete'?'本轮节目检查完成':run.phase==='shows'?'采集关注节目':'推送节目更新'});
  return {complete:run.phase==='complete',runId:run.id,checked:run.checked,failed:run.failed,sent:run.sent};
 }finally{await releaseDeliveryLease(lease);}
}
export async function subscriptionJobStatus(){
 const run=await setting<EpisodeRun|null>('episode_poll_run',null);
 // Return aggregate progress only; never expose reader IDs or credentials to automation logs.
 return {episodes:run?{runId:run.id,phase:run.phase,checked:run.checked,failed:run.failed,sent:run.sent,startedAt:run.startedAt,finishedAt:run.finishedAt}:null,daily:await setting('subscription_job_status',null),dailyCompletedRun:await setting('subscription_completed_run','')};
}

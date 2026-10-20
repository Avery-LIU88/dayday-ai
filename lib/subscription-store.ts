import {env} from 'cloudflare:workers';
import catalog from '../data/catalog.json';
import podcastLinks from '../data/podcast-links.json';
import {stableId} from './feed.mjs';
import {resolveShow,showFromFeed,defaultReminderPreferences,reminderPreferences,encryptBot,decryptBot,deliveryDue,chinaTime,briefText} from './subscriptions.mjs';
import {sendFeishu,notificationText,validateWebhook} from './feishu.mjs';
import {publicState} from './news-store';
import type {Entry} from './types';

type Runtime={DB?:D1Database;REMINDER_ENCRYPTION_KEY?:string};
const runtime=()=>env as Runtime;
const db=()=>{if(!runtime().DB)throw Error('数据库暂不可用');return runtime().DB!;};
type Reader={id:string;preferences:string;bot:string|null};
type Show={id:string;name:string;feed:string;website:string;platform:string;language:string;kind:string;color:string};
type ShowRow={id:string;data:string;checked_at:string;error:string|null};
type Prefs={enabled:boolean;episodes:boolean;daily:boolean;weekly:boolean;time:string;quiet:boolean};
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
 const followed=rows.results.map(x=>({...JSON.parse(x.data) as Show,checkedAt:x.checked_at,error:x.error,followedAt:x.followed_at,mode:x.mode}));
 const episodes=await db().prepare("SELECT e.data FROM entries e JOIN subscriptions f ON f.show_id=e.source_id WHERE f.reader_id=? AND e.kind='episode' ORDER BY e.published_at DESC LIMIT 100").bind(id).all<{data:string}>();
 const job=await setting('subscription_job_status',null);
 return {shows:followed,episodes:episodes.results.map(x=>JSON.parse(x.data) as Entry),preferences:r?JSON.parse(r.preferences) as Prefs:defaultReminderPreferences as Prefs,connected:!!r?.bot,deliveries:logs.results,job};
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
 try{const result=await showFromFeed(s.feed,s);await saveShow({...s,...result.show} as Show,result.episodes as Entry[]);}
 catch(e){await db().prepare('UPDATE shows SET checked_at=?,error=? WHERE id=?').bind(new Date().toISOString(),e instanceof Error?e.message.slice(0,140):'节目更新失败',row.id).run();}
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
 if(!['episodes','daily','weekly'].includes(kind))throw Error('请选择分发内容');
 if(kind==='episodes'){
  const s=await subscriptionState(id);return s.episodes.length?notificationText(s.episodes.slice(0,5),true):'';
 }
 return briefText((await publicState()).stories,kind);
}
export async function preparePreview(id:string,kind:string){
 const text=await previewMessage(id,kind);
 await set('subscription_preview:'+id,{kind,text,expiresAt:Date.now()+30*60000});
 return {text};
}
async function deliver(r:Reader,ids:string[],kind:string,text:string){
 if(!r.bot)throw Error('请先连接飞书机器人');
 const bot=await decryptBot(r.bot,runtime().REMINDER_ENCRYPTION_KEY),at=new Date().toISOString();
 let count=0;
 for(const id of ids){const claim=await db().prepare("INSERT OR IGNORE INTO notices(id,reader_id,kind,status,created_at,message) VALUES(?,?,?,'sending',?,'等待回执')").bind(id,r.id,kind,at).run();count+=claim.meta.changes||0;}
 if(count!==ids.length){
  // Job mutex ensures multi-item claims are unique. Never resend an ambiguous claim.
  return {status:'skipped',message:'这条提醒已经处理',count:0};
 }
 let result;
 try{result=await sendFeishu(bot.webhook,bot.secret,text);}catch{result={status:'unknown',message:'未收到明确回执，请核对飞书群；不会自动重复发送'};}
 await db().batch(ids.map(id=>db().prepare('UPDATE notices SET status=?,message=? WHERE id=? AND reader_id=?').bind(result.status,result.message,id,r.id)));
 return {...result,count};
}
export async function sendPreview(id:string,kind:string){
 const r=await reader(id);if(!r?.bot)throw Error('请先连接飞书机器人');
 const preview=await setting<{kind:string;text:string;expiresAt:number}|null>('subscription_preview:'+id,null);
 if(kind!=='test'&&(!preview||preview.kind!==kind||preview.expiresAt<Date.now()))throw Error('请先重新预览，再发送');
 const text=kind==='test'?'DayDay AI · 连接测试\n飞书机器人已连接。\n每天一点，跟上 AI。':preview!.text;
 if(!text)throw Error('当前没有可发送的内容');
 return deliver(r,[id+':manual:'+crypto.randomUUID()],kind,text);
}
async function dispatchReader(r:Reader){
 const p=JSON.parse(r.preferences) as Prefs,date=new Date(),clock=chinaTime(date);let sent=0;
 if(!r.bot||!p.enabled)return 0;
 if(deliveryDue(p,'episode',date)){
  const digestKey=r.id+':digest:'+clock.day;
  const digestDone=!!await db().prepare('SELECT id FROM notices WHERE id=?').bind(digestKey).first();
  const rows=await db().prepare(`SELECT e.id,e.data,f.mode FROM entries e JOIN subscriptions f ON e.source_id=f.show_id
   LEFT JOIN notices n ON n.id=(?||':episode:'||e.id)
   WHERE f.reader_id=? AND e.kind='episode' AND (f.mode='instant' OR (?=1 AND f.mode='digest')) AND e.published_at>f.followed_at
   AND e.published_at>? AND n.id IS NULL ORDER BY e.published_at ASC LIMIT 40`).bind(r.id,r.id,!digestDone&&clock.time>=p.time?1:0,new Date(Date.now()-7*86400000).toISOString()).all<{id:string;data:string;mode:string}>();
  for(const mode of ['instant','digest']){
   if(mode==='digest'&&(clock.time<p.time||digestDone))continue;
   const chosen=rows.results.filter(x=>x.mode===mode);
   for(let start=0;start<chosen.length;start+=8){
    const chunk=chosen.slice(start,start+8);
    const result=await deliver(r,chunk.map(x=>r.id+':episode:'+x.id),'episodes',notificationText(chunk.map(x=>JSON.parse(x.data)),mode==='digest'));
    if(result.status==='sent')sent++;
   }
   if(mode==='digest'&&chosen.length)await db().prepare("INSERT OR IGNORE INTO notices(id,reader_id,kind,status,created_at,message) VALUES(?,?,'episodes','processed',?,'今日节目汇总已处理，详情见单条回执')").bind(digestKey,r.id,date.toISOString()).run();
  }
 }
 for(const kind of ['daily','weekly']){
  if(!deliveryDue(p,kind,date))continue;
  const key=r.id+':'+kind+':'+clock.day;
  if(await db().prepare('SELECT id FROM notices WHERE id=?').bind(key).first())continue;
  const text=await previewMessage(r.id,kind);if(!text)continue;
  const result=await deliver(r,[key],kind,text);if(result.status==='sent')sent++;
 }
 return sent;
}
/** Shared hourly job, bounded batches. No user secrets are returned to the task. */
export async function runSubscriptionJob(){
 const lease=String(Date.now()+240000);
 const lock=await db().prepare("INSERT INTO settings(key,value) VALUES('subscription_job_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key").bind(lease,Date.now()).first();
 if(!lock)return {busy:true};
 try{
  const minute=Math.floor(Date.now()/60000);
  await db().prepare("DELETE FROM settings WHERE key LIKE 'subscription_rate:%' AND CAST(substr(key,-8) AS INTEGER)<?").bind(minute-60).run();
  const phase=await setting('subscription_job_phase','shows'),cursor=await setting('subscription_job_cursor','');
  if(phase==='shows'){
   const rows=await db().prepare('SELECT s.* FROM shows s WHERE s.id>? AND EXISTS(SELECT 1 FROM subscriptions f WHERE f.show_id=s.id) ORDER BY s.id LIMIT 4').bind(cursor).all<ShowRow>();
   await Promise.all(rows.results.map(row=>updateShow(row)));
   if(rows.results.length===4)await set('subscription_job_cursor',rows.results.at(-1)!.id);
   else{await set('subscription_job_phase','readers');await set('subscription_job_cursor','');}
   await set('subscription_job_status',{checkedAt:new Date().toISOString(),phase:'采集节目'});
   return {busy:false,checked:rows.results.length,complete:false};
  }
  const rows=await db().prepare("SELECT id,preferences,bot FROM readers WHERE id>? AND bot IS NOT NULL ORDER BY id LIMIT 5").bind(cursor).all<Reader>();let sent=0;
  for(const r of rows.results)try{sent+=await dispatchReader(r);}catch{await db().prepare("INSERT INTO notices(id,reader_id,kind,status,created_at,message) VALUES(?,?,?,'failed',?,'提醒处理失败，请检查机器人设置')").bind(r.id+':error:'+chinaTime().day,r.id,'system',new Date().toISOString()).run().catch(()=>{});}
  const complete=rows.results.length<5;
  await set('subscription_job_cursor',complete?'':rows.results.at(-1)!.id);
  if(complete)await set('subscription_job_phase','shows');
  await set('subscription_job_status',{checkedAt:new Date().toISOString(),phase:complete?'本轮完成':'处理提醒'});
  return {busy:false,checkedReaders:rows.results.length,sent,complete};
 }finally{await db().prepare("DELETE FROM settings WHERE key='subscription_job_lock' AND value=?").bind(lease).run();}
}

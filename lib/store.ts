import { env } from "cloudflare:workers";
import catalog from "../data/catalog.json";
import seed from "../data/seed.json";
import type { Entry, Follow, Health, Preferences, Snapshot, Source } from "./types";
import { readSource } from "./feed.mjs";
import { sendFeishu, notificationText, validateWebhook } from "./feishu.mjs";

export const sources = catalog as unknown as Source[];
const initial = seed as unknown as {entries: Entry[]; health: Health[]; collectedAt: string | null};
const defaults: Preferences = { enabled: false, digestTime: "08:00", quiet: true };
type Runtime = { DB?: D1Database; FEISHU_WEBHOOK?: string; FEISHU_SECRET?: string };
const runtime = () => env as Runtime;
export function database() { const db = runtime().DB; if (!db) throw new Error("数据库尚未就绪"); return db; }
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await database().prepare("SELECT value FROM settings WHERE key=?").bind(key).first<{value:string}>();
  return row ? JSON.parse(row.value) as T : fallback;
}
export async function setSetting(key: string, value: unknown) {
  await database().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,JSON.stringify(value)).run();
}
export async function snapshot(): Promise<Omit<Snapshot,"user">> {
  let entries = initial.entries, follows: Follow[] = [], saved: string[] = [], preferences = defaults;
  let health = initial.health, collectedAt = initial.collectedAt, databaseReady = true;
  let deliveries: Snapshot["deliveries"] = [];
  try {
    const db = database();
    const [stored, f, s, prefs, h, at, d] = await Promise.all([
      db.prepare("SELECT data FROM entries ORDER BY published_at DESC LIMIT 1200").all<{data:string}>(),
      db.prepare("SELECT show_id AS showId, followed_at AS followedAt, mode FROM follows").all<Follow>(),
      db.prepare("SELECT entry_id FROM saved").all<{entry_id:string}>(),
      getSetting("preferences", defaults), getSetting("health", initial.health),getSetting("collectedAt",initial.collectedAt),
      db.prepare("SELECT id,status,created_at AS createdAt,message FROM deliveries ORDER BY created_at DESC LIMIT 15").all<Snapshot["deliveries"][number]>(),
    ]);
    entries = [...new Map([...initial.entries, ...stored.results.map(r=>JSON.parse(r.data) as Entry)].map(e=>[e.id,e])).values()];
    follows=f.results; saved=s.results.map(r=>r.entry_id); preferences=prefs; health=h; collectedAt=at; deliveries=d.results;
  } catch { databaseReady = false; }
  return {entries:entries.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)),sources,follows,saved,preferences,health,collectedAt,databaseReady,feishuConnected:validateWebhook(runtime().FEISHU_WEBHOOK),deliveries};
}
export async function saveEntry(id: string, active: boolean) {
  const db=database();
  const exists = initial.entries.some(e=>e.id===id) || await db.prepare("SELECT id FROM entries WHERE id=?").bind(id).first();
  if (!exists) throw new Error("内容不存在");
  if (active) await db.prepare("INSERT OR IGNORE INTO saved(entry_id,created_at) VALUES(?,?)").bind(id,new Date().toISOString()).run();
  else await db.prepare("DELETE FROM saved WHERE entry_id=?").bind(id).run();
}
export async function followShow(id: string, active: boolean, mode: string) {
  if (!sources.some(s=>s.id===id && s.kind==="podcast")) throw new Error("节目不存在");
  const db=database();
  if (active) await db.prepare("INSERT INTO follows(show_id,followed_at,mode) VALUES(?,?,?) ON CONFLICT(show_id) DO UPDATE SET mode=excluded.mode").bind(id,new Date().toISOString(),mode).run();
  else await db.prepare("DELETE FROM follows WHERE show_id=?").bind(id).run();
}
async function insertEntries(items: Entry[], discovered: string) {
  const db=database(); let added=0;
  for (let i=0;i<items.length;i+=60) {
    const results = await db.batch(items.slice(i,i+60).map(e=>db.prepare("INSERT OR IGNORE INTO entries(id,kind,source_id,published_at,discovered_at,data) VALUES(?,?,?,?,?,?)").bind(e.id,e.kind,e.sourceId,e.publishedAt,discovered,JSON.stringify(e))));
    added += results.reduce((sum,r)=>sum+(r.meta.changes??0),0);
  }
  return added;
}
export async function sync() {
  const db=database(); const now=Date.now();
  const lock = await db.prepare("INSERT INTO settings(key,value) VALUES('sync_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key").bind(String(now+5*60*1000),now).first();
  if (!lock) return {busy:true,added:0,health:[]};
  const runId=crypto.randomUUID(), startedAt=new Date().toISOString(); let added=0;
  await db.prepare("INSERT INTO runs(id,started_at,added,details) VALUES(?,?,0,'[]')").bind(runId,startedAt).run();
  try {
    if (!(await getSetting("seeded",false))) {await insertEntries(initial.entries,initial.collectedAt || startedAt);await setSetting("seeded",true);}
    const health: Health[]=[];
    for(let i=0;i<sources.length;i+=4) await Promise.all(sources.slice(i,i+4).map(async s=>{
      try {
        const items = await readSource(s) as Entry[];
        added += await insertEntries(items,startedAt);
        health.push({id:s.id,ok:true,count:items.length,checkedAt:new Date().toISOString()});
      } catch(e) { health.push({id:s.id,ok:false,error:e instanceof Error ? e.message.slice(0,120) : "采集失败",checkedAt:new Date().toISOString()}); }
    }));
    await setSetting("health",health);await setSetting("collectedAt",startedAt);
    await db.prepare("UPDATE runs SET finished_at=?,added=?,details=? WHERE id=?").bind(new Date().toISOString(),added,JSON.stringify(health),runId).run();
    return {busy:false,added,health};
  } finally { await db.prepare("DELETE FROM settings WHERE key='sync_lock'").run(); }
}
function chinaClock(date=new Date()) {
  const shifted=new Date(date.getTime()+8*3600*1000);
  return {day:shifted.toISOString().slice(0,10),hour:shifted.getUTCHours(),time:shifted.toISOString().slice(11,16)};
}
export async function dispatch(test=false) {
  const {FEISHU_WEBHOOK:url,FEISHU_SECRET:secret}=runtime();
  if (!validateWebhook(url)) throw new Error("请先配置飞书机器人 Webhook");
  const db=database();
  if (test) {
    const id=`test:${crypto.randomUUID()}`;
    await db.prepare("INSERT INTO deliveries(id,status,created_at,message) VALUES(?,'sending',?,'测试消息')").bind(id,new Date().toISOString()).run();
    let result;
    try { result=await sendFeishu(url,secret,"知更 AI · 连接测试\n飞书机器人已连接。关注节目并开启提醒后，新一期更新会发送到这里。"); }
    catch {result={status:"unknown",message:"未收到明确回执，请检查飞书群后再操作"};}
    await db.prepare("UPDATE deliveries SET status=?,message=? WHERE id=?").bind(result.status,result.message,id).run();
    return result;
  }
  const prefs=await getSetting("preferences",defaults);
  if(!prefs.enabled)return {status:"disabled",count:0};
  const clock=chinaClock();
  if(prefs.quiet && (clock.hour>=22 || clock.hour<8))return {status:"quiet",count:0};
  const rows=await db.prepare(`SELECT e.id,e.data,f.mode FROM entries e JOIN follows f ON e.source_id=f.show_id
    LEFT JOIN deliveries d ON d.id=e.id WHERE e.kind='episode' AND e.published_at>f.followed_at
    AND e.published_at>? AND f.mode!='off' AND d.id IS NULL ORDER BY e.published_at ASC LIMIT 60`).bind(new Date(Date.now()-7*86400000).toISOString()).all<{id:string;data:string;mode:string}>();
  const last=await getSetting("digestDay","");
  const chosen=rows.results.filter(r=>r.mode==="instant" || (clock.time>=prefs.digestTime && last!==clock.day)).slice(0,8);
  if(!chosen.length)return {status:"empty",count:0};
  const claimed: typeof chosen=[];
  for(const row of chosen) {
    const r=await db.prepare("INSERT OR IGNORE INTO deliveries(id,status,created_at,message) VALUES(?,'sending',?,'发送中')").bind(row.id,new Date().toISOString()).run();
    if(r.meta.changes)claimed.push(row);
  }
  if(!claimed.length)return {status:"empty",count:0};
  const text=notificationText(claimed.map(r=>JSON.parse(r.data)),claimed.some(r=>r.mode==="digest"));
  let result;
  try {result=await sendFeishu(url,secret,text);} catch {result={status:"unknown",message:"发送结果未确认；为避免重复通知，需人工核对"};}
  await db.batch(claimed.map(r=>db.prepare("UPDATE deliveries SET status=?,message=? WHERE id=?").bind(result.status,result.message,r.id)));
  if(result.status==="sent" && claimed.some(r=>r.mode==="digest"))await setSetting("digestDay",clock.day);
  return {...result,count:claimed.length};
}

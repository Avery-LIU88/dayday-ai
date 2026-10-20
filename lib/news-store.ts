import {env} from 'cloudflare:workers';
import catalog from '../data/news-sources.json';
import seed from '../data/news-seed.json';
import {clusterEntries,hotStories,topicNames} from './dayday-core.mjs';
import {collectSource,extractSnippet,relevant} from './news-collector.mjs';
import {appendSnapshot,trendFor,indexSnapshots} from './event-trends.mjs';
import {buildDailyEditions} from './daily-brief.mjs';
import type {Entry,Health} from './types';
export const newsSources=catalog;
type Check=Health&{lastSuccessAt?:string;rawCount?:number};
type NewsEntry=Entry&{dateLabel?:string};
type TrendSnapshot={at:string;events:{keys:string[];heat:number}[]};
type Runtime={DB?:D1Database;ADMIN_TOKEN?:string};
const runtime=()=>env as Runtime;
const database=()=>{const db=runtime().DB;if(!db)throw Error('数据库未连接');return db;};
async function setting<T>(key:string,fallback:T):Promise<T>{const row=await database().prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{value:string}>();return row?JSON.parse(row.value):fallback;}
async function set(key:string,value:unknown){await database().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();}
const initial=seed as unknown as {entries:NewsEntry[];health:Check[];collectedAt:string};
export async function publicState(){
 let entries=initial.entries,health=initial.health,collectedAt=initial.collectedAt,databaseReady=true;
 let trendHistory:TrendSnapshot[]=[];
 try{const [rows,h,at,history]=await Promise.all([database().prepare("SELECT data FROM entries WHERE kind='article' ORDER BY published_at DESC LIMIT 1800").all<{data:string}>(),setting<Check[]>('news_health',[]),setting('news_collected_at',initial.collectedAt),setting<TrendSnapshot[]>('news_trends_v1',[])]);const ids=new Set(newsSources.map(s=>s.id));const all=[...initial.entries,...rows.results.map(r=>JSON.parse(r.data) as NewsEntry)].filter(e=>ids.has(e.sourceId));entries=[...new Map(all.map(e=>[`${e.sourceId}:${e.url}`,e])).values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,1800);health=[...new Map([...initial.health,...h].map(x=>[x.id,x])).values()];collectedAt=at;trendHistory=history;}catch{databaseReady=false;}
 entries=entries.filter(e=>relevant(e,newsSources.find(s=>s.id===e.sourceId)||{})).map(e=>({...e,summary:extractSnippet(e.summary)}));
 let dailyHistory:ReturnType<typeof buildDailyEditions>=[];
 try{dailyHistory=await setting('news_daily_editions_v1',[]);}catch{}
 const trendIndex=indexSnapshots(trendHistory);
 const stories=clusterEntries(entries,newsSources).map(s=>({...s,trend:trendFor(s,trendHistory,trendIndex)})),healthyIds=new Set(health.filter(h=>h.ok&&Date.now()-Date.parse(h.checkedAt)<48*3600000).map(h=>h.id));
 return {stories,daily:buildDailyEditions(stories,entries,collectedAt,dailyHistory),hot:hotStories(stories),ranking:{version:2,windowHours:24,asOf:new Date().toISOString()},sources:newsSources,health,collectedAt,databaseReady,topics:topicNames,pipeline:{mode:'规则评分 · 原文摘要',processed:entries.length,lastSuccessAt:health.filter(h=>h.ok).map(h=>h.checkedAt).sort().at(-1)||null},stats:{registered:newsSources.filter(s=>s.scope!=='截图栏目').length,configured:newsSources.filter(s=>s.adapter!=='directory').length,healthy:new Set(newsSources.filter(s=>healthyIds.has(s.id)).map(s=>s.publisher)).size,healthyEndpoints:healthyIds.size,articles:entries.length,stories:stories.length}};
}
export type NewsState=Awaited<ReturnType<typeof publicState>>;
async function insert(items:NewsEntry[],at:string){let added=0;const db=database();for(let i=0;i<items.length;i+=40){const results=await db.batch(items.slice(i,i+40).map(e=>db.prepare("INSERT INTO entries(id,kind,source_id,published_at,discovered_at,data) VALUES(?,'article',?,?,?,?) ON CONFLICT(id) DO UPDATE SET published_at=excluded.published_at,data=excluded.data WHERE entries.data!=excluded.data").bind(e.id,e.sourceId,e.publishedAt,at,JSON.stringify(e))));added+=results.reduce((n,r)=>n+(r.meta.changes||0),0);}return added;}
/** Eight sources per batch keeps requests bounded; failures preserve last content. */
export async function refreshNews(){const db=database(),now=Date.now(),lease=String(now+240000);const lock=await db.prepare("INSERT INTO settings(key,value) VALUES('news_sync_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key").bind(lease,now).first();if(!lock)return {busy:true,added:0};const startedAt=new Date().toISOString();try{
 if(!await setting('news_seeded_v1',false)){await insert(initial.entries,startedAt);await set('news_seeded_v1',true);}
 const active=newsSources.filter(s=>s.adapter!=='directory'&&s.feed),cursor=await setting('news_cursor',0),batch=active.slice(cursor,cursor+8),checks=new Map((await setting<Check[]>('news_health',initial.health)).map(h=>[h.id,h]));let added=0;
 if(cursor===0)await set('news_round_started_at',startedAt);
 await Promise.all(batch.map(async s=>{const checkedAt=new Date().toISOString();try{const {items,rawCount}=await collectSource(s);added+=await insert(items as NewsEntry[],startedAt);checks.set(s.id,{id:s.id,ok:true,count:items.length,rawCount,checkedAt,lastSuccessAt:checkedAt});}catch(e){checks.set(s.id,{...checks.get(s.id),id:s.id,ok:false,checkedAt,error:e instanceof Error?e.message.slice(0,120):'更新失败'});}}));
 const next=cursor+batch.length>=active.length?0:cursor+batch.length;await set('news_health',[...checks.values()]);await set('news_cursor',next);const completedAt=next===0?new Date().toISOString():null;if(completedAt){const roundStart=await setting('news_round_started_at','');if(roundStart&&active.every(s=>(checks.get(s.id)?.checkedAt||'')>=roundStart)){const state=await publicState();const history=await setting<TrendSnapshot[]>('news_trends_v1',[]);await set('news_trends_v1',appendSnapshot(history,state.stories,completedAt));}await set('news_collected_at',completedAt);const editionState=await publicState();await set('news_daily_editions_v1',editionState.daily);}await db.prepare('INSERT INTO runs(id,started_at,finished_at,added,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),startedAt,new Date().toISOString(),added,JSON.stringify({sourceIds:batch.map(s=>s.id),next})).run();return {busy:false,added,checked:batch.length,next,complete:next===0,completedAt};
 }finally{await db.prepare("DELETE FROM settings WHERE key='news_sync_lock' AND value=?").bind(lease).run();}}
export function authorizedUpdater(request:Request){const token=runtime().ADMIN_TOKEN;return !!token&&token.length>=32&&request.headers.get('authorization')===`Bearer ${token}`;}

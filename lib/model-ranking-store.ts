import {env} from 'cloudflare:workers';
import seed from '../data/model-rankings.json';
import priceSeed from '../data/model-costs.json';
import mediaSeed from '../data/model-media.json';
import type {MediaSnapshot} from './model-board-types';
import {fetchMediaSnapshot} from './model-media.mjs';
import {fetchCostSnapshot} from './model-cost.mjs';
import {fetchModelSnapshot} from './model-ranking-fetch.mjs';
import type {ModelSnapshot,ModelHealth} from './model-ranking-types';
const db=()=>(env as {DB?:D1Database}).DB;
const initial=seed as ModelSnapshot;
async function read<T>(key:string,fallback:T):Promise<T>{
 const row=await db()?.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{value:string}>();
 return row?JSON.parse(row.value):fallback;
}
async function write(key:string,value:unknown){
 const database=db();if(!database)throw Error('Database unavailable');
 await database.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();
}
export async function modelRankings(){
 try{
  const [stored,health]=await Promise.all([read<ModelSnapshot>('model_rankings_v1',initial),read<ModelHealth|null>('model_rankings_health_v1',null)]);
  const [cachedPrices,cachedMedia]=await Promise.all([read('model_prices_v1',priceSeed),read<MediaSnapshot>('model_media_v1',mediaSeed as MediaSnapshot)]);
  return {snapshot:Date.parse(stored.updatedAt)>Date.parse(initial.updatedAt)?stored:initial,health,prices:Date.parse(cachedPrices.updatedAt)>Date.parse(priceSeed.updatedAt)?cachedPrices:priceSeed,media:Date.parse(cachedMedia.updatedAt)>Date.parse(mediaSeed.updatedAt)?cachedMedia:mediaSeed};
 }catch{return {snapshot:initial,health:null,prices:priceSeed,media:mediaSeed};}
}
/** Called once after a completed scheduled news round; never fetches on visitor requests. */
export async function refreshModelRankings(){
 const checkedAt=new Date().toISOString();
 // Price failures retain the prior valid snapshot and do not block capability updates.
 await Promise.allSettled([fetchCostSnapshot().then(snapshot=>write('model_prices_v1',snapshot)),fetchMediaSnapshot().then(snapshot=>write('model_media_v1',snapshot))]);
 try{
  const snapshot=await fetchModelSnapshot();
  await write('model_rankings_v1',snapshot);
  await write('model_rankings_health_v1',{ok:true,checkedAt});
  return {ok:true,updatedAt:snapshot.updatedAt};
 }catch{
  // Failed downloads/invalid archives cannot overwrite the last complete snapshot.
  try{await write('model_rankings_health_v1',{ok:false,checkedAt,error:'本次同步未完成，保留上次有效成绩'});}catch{}
  return {ok:false};
 }
}

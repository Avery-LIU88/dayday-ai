import {env} from 'cloudflare:workers';
import catalog from '../data/news-sources.json';
import seed from '../data/news-seed.json';
import {getSetting,runPipeline,pipelineStatus,stages} from './news-pipeline.mjs';
import type {clusterEntries} from './dayday-core.mjs';
import type {buildDailyEditions} from './daily-brief.mjs';
import type {buildWeeklyEditions} from './weekly-brief.mjs';
import type {Health} from './types';
import {policy} from '../config/pipeline.mjs';
export const newsSources=catalog;
export type Activity={date?:string;endDate?:string;startAt?:string;endAt?:string;registrationDeadline?:string;location?:string;format?:string;kind?:string;url:string;originalUrl?:string;trackedId?:string;status?:string;timezone?:string;note?:string};
type Story=ReturnType<typeof clusterEntries>[number]&{activity?:Activity|null;activityListing?:boolean;trend:{at:string;heat:number}[];takeaway?:string;bullets?:string[];priorityScore?:number;priority?:{version:number;score:number;eligible:boolean;contributions:Record<string,number>;exclusions:string[]};primaryEvidence?:{url:string;source:string}[]};
export type NewsState={activities?:Story[];stories:Story[];hot:Story[];daily:ReturnType<typeof buildDailyEditions>;weekly:ReturnType<typeof buildWeeklyEditions>;sources:typeof catalog;health:(Health&{lastSuccessAt?:string|null})[];collectedAt:string;processedAt?:string;databaseReady:boolean;topics:string[];ranking:{version:number;windowHours:number;asOf:string;mode?:string;weights?:Record<string,number>;minimumImportance?:number;heatSaturation?:number};pipeline:{mode:string;processed:number;lastSuccessAt:string|null;pending?:number};stats:{registered:number;configured:number;healthy:number;healthyEndpoints:number;articles:number;stories:number}};
type Runtime={DB?:D1Database;ADMIN_TOKEN?:string;DEEPSEEK_API_KEY?:string};
const runtime=()=>env as Runtime;
const database=()=>{const db=runtime().DB;if(!db)throw Error('数据库未连接');return db;};
/** Read the published snapshot only. Never invokes collection, grouping or scoring. */
export async function publicState():Promise<NewsState>{
 const empty:NewsState={stories:[],hot:[],daily:[],weekly:[],sources:newsSources,health:[],collectedAt:'',databaseReady:true,topics:['公司动态','论文与研究','媒体资讯','Newsletter','开发者平台','线上发布会','线下活动','黑客松','投融资','招聘','政策监管'],ranking:{version:3,windowHours:24,asOf:''},pipeline:{mode:'等待首批处理完成',processed:0,lastSuccessAt:null},stats:{registered:0,configured:0,healthy:0,healthyEndpoints:0,articles:0,stories:0}};
 try{return await getSetting(database(),'news_publication_v3',empty) as NewsState;}catch{return {...empty,databaseReady:false};}
}
export async function refreshNews(stage='auto',itemIds?:string[],sourceIds?:string[],options:{windowEnd?:string}={}){return runPipeline(database(),newsSources,seed,runtime().DEEPSEEK_API_KEY,stage,itemIds,sourceIds,options);}
export async function processingStatus(){return pipelineStatus(database());}
export async function modelConnection(){try{const response=await fetch(policy.baseUrl+'/models',{headers:{Authorization:`Bearer ${runtime().DEEPSEEK_API_KEY}`},redirect:'manual',signal:AbortSignal.timeout(15000)});const text=await response.text();let models:string[]=[];try{models=JSON.parse(text).data?.map((m:{id:string})=>m.id)||[];}catch{}return {status:response.status,modelAvailable:models.includes(policy.model),models,redirect:response.headers.get('location')?.split('?')[0]||null};}catch(e){return {error:String(e instanceof Error?e.name+': '+e.message:'network error').replace(/sk-[a-zA-Z0-9_-]+/g,'[redacted]').slice(0,200)};}}
export async function processingItem(id:string){const db=database();return {item:await db.prepare('SELECT id,source_id,published_at,status,analysis,duplicate_of,event_id,error,updated_at FROM pipeline_items WHERE id=?').bind(id).first(),steps:(await db.prepare('SELECT stage,status,result,version,updated_at FROM pipeline_steps WHERE item_id=?').bind(id).all()).results};}
export {stages};
export function authorizedUpdater(request:Request){const token=runtime().ADMIN_TOKEN;return !!token&&token.length>=32&&request.headers.get('authorization')===`Bearer ${token}`;}

import {env} from 'cloudflare:workers';
import {authorizedUpdater,refreshNews,publicState} from '../../../lib/news-store';
import {refreshModelRankings} from '../../../lib/model-ranking-store';
import {runEpisodeJob,runSubscriptionJob} from '../../../lib/subscription-store';
import {runNightlyUpdate} from '../../../lib/nightly-update.mjs';
import {schedulerStatus,schedulerStep,setSchedulerOwner} from '../../../lib/scheduler-store.mjs';
import {validJob} from '../../../lib/scheduler-contract.mjs';
export const dynamic='force-dynamic';
const runtime=()=>env as {DB?:D1Database;SCHEDULER_TOKEN?:string};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function schedulerAuthorized(request:Request){const key=runtime().SCHEDULER_TOKEN;return !!key&&key.length>=32&&request.headers.get('authorization')===`Bearer ${key}`;}
export async function GET(request:Request){
  if(!schedulerAuthorized(request)&&!authorizedUpdater(request))return reply({error:'Unauthorized'},401);
  const db=runtime().DB;if(!db)return reply({error:'Database unavailable'},503);
  return reply(await schedulerStatus(db));
}
export async function POST(request:Request){
  const admin=authorizedUpdater(request),scheduler=schedulerAuthorized(request);
  if(!admin&&!scheduler)return reply({error:'Unauthorized'},401);
  const db=runtime().DB;if(!db)return reply({error:'Database unavailable'},503);
  let input;
  try{if(Number(request.headers.get('content-length')||0)>2048)throw Error();const body=await request.text();if(body.length>2048)throw Error();input=JSON.parse(body);if(!input||typeof input!=='object'||Array.isArray(input))throw Error();}catch{return reply({error:'Invalid request'},400);}
  if(input.action==='owner'){
    if(!admin)return reply({error:'Operator authorization required'},403);
    try{return reply(await setSchedulerOwner(db,input.kind,input.owner));}catch{return reply({error:'Invalid owner'},400);}
  }
  if(input.action!=='step'||!scheduler)return reply({error:'Scheduler authorization required'},403);
  try{validJob(input);}catch{return reply({error:'Invalid or expired job'},422);}
  try{
    const result=await schedulerStep(db,input,{
      daily:(job:{scheduledAt:string;runId:string;trigger:string})=>runNightlyUpdate(db,{news:()=>refreshNews(),read:publicState,models:refreshModelRankings,subscriptions:runSubscriptionJob},new Date(job.scheduledAt),{owner:'cloudflare',expectedRunId:job.runId,manual:job.trigger==='manual'}),
      episodes:(job:{scheduledAt:string;runId:string})=>runEpisodeJob(new Date(job.scheduledAt),{owner:'cloudflare',expectedRunId:job.runId}),
    });
    return reply(result);
  }catch{return reply({error:'Batch failed; durable progress retained'},503);}
}

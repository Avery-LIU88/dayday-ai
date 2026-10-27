import {deliveryPolicy} from '../config/delivery.mjs';
import {getSetting,settingStatement} from './news-pipeline.mjs';
export function nightlyClock(date=new Date()){
 const china=new Date(date.getTime()+8*3600000);
 return {day:china.toISOString().slice(0,10),hour:china.getUTCHours()};
}
/** One durable daily run; requests resume phases, never start extra collections. */
/** @param {{owner?:string,expectedRunId?:string,manual?:boolean}} options */
export async function runNightlyUpdate(db,actions,date=new Date(),options={}){
 const clock=nightlyClock(date),lease=String(Date.now()+deliveryPolicy.leaseMs);
 const manual=options.manual===true;
 if(manual&&(options.owner!=='cloudflare'||options.expectedRunId!==`manual-${date.toISOString()}`))throw Error('Invalid manual run identity');
 const runId=manual?options.expectedRunId:clock.day;
 const lock=await db.prepare("INSERT INTO settings(key,value) VALUES('nightly_update_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key").bind(lease,Date.now()).first();
 if(!lock)return {busy:true,complete:false};
 try{
  if(await getSetting(db,'scheduler_owner_daily','legacy')!==(options.owner||'legacy'))return {complete:true,skipped:true,reason:'managed_by_other_scheduler'};
  let run=await getSetting(db,'nightly_update',null);
  if(options.expectedRunId&&run&&run.day!==options.expectedRunId){
   if(run.phase!=='complete')return {complete:false,blocked:true,reason:'previous_run_pending'};
   const previousTime=Date.parse(run.startedAt||run.day+'T13:00:00Z');
   if(previousTime>date.getTime())return {complete:true,skipped:true,reason:'superseded'};
  }
  if(!run||run.phase==='complete'){
   if(run?.day===runId)return {complete:true,alreadyCompleted:true,day:run.day,publishedAt:run.publishedAt};
   if(!manual&&clock.hour<deliveryPolicy.startHour)return {complete:true,skipped:true,reason:'每天北京时间 21:00 启动一次',nextStart:clock.day+'T21:00:00+08:00'};
   run={day:runId,phase:'news',startedAt:date.toISOString(),trigger:manual?'manual':'cron'};
   await settingStatement(db,'nightly_update',run).run();
  }
  // Old 08:00/20:00 tasks must not accidentally collect or dispatch. An
  // unfinished nightly run can resume after midnight until 08:00.
  if(!manual&&clock.hour>=8&&clock.hour<deliveryPolicy.startHour)return {complete:true,skipped:true,reason:'本轮等待夜间任务继续',resumePending:true};
  const persist=()=>settingStatement(db,'nightly_update',run).run();
  if(run.phase==='news'){
   const result=await actions.news({windowEnd:run.startedAt});if(result.busy)return result;
   // Manual acceptance completes one source sweep plus its bounded processing.
   // Regular nightly runs finish only eligible work in their fixed 24-hour window.
   const boundedManual=manual&&result.nextStage==='analyze';
   if(!result.complete&&!boundedManual)return {...result,phase:'news'};
   const state=await actions.read();
   if(!state.processedAt||state.processedAt!==result.publishedAt||Date.parse(state.processedAt)<Date.parse(run.startedAt))throw Error('尚未读到本轮已发布结果');
   run={...run,phase:'models',publishedAt:state.processedAt,pending:result.pending||0,...(boundedManual?{boundedManual:true}:{})};
   await db.batch([
    settingStatement(db,'nightly_publication',{runId:run.day,publishedAt:state.processedAt,hot:state.hot||[],activities:state.activities||[]}),
    settingStatement(db,'nightly_update',run),
    ...(boundedManual?[settingStatement(db,'pipeline_phase','collect')]:[]),
   ]);
   return {complete:false,phase:'models',publishedAt:run.publishedAt,pending:run.pending};
  }
  if(run.phase==='models'){
   await actions.models();run.phase='subscriptions';await persist();
   return {complete:false,phase:run.phase,publishedAt:run.publishedAt};
  }
  const result=await actions.subscriptions();if(result.busy||result.blocked)return {...result,complete:false};
  if(result.complete){run.phase='complete';run.finishedAt=new Date().toISOString();await persist();}
  return {...result,phase:run.phase,publishedAt:run.publishedAt,pending:run.pending};
 }finally{await db.prepare("DELETE FROM settings WHERE key='nightly_update_lock' AND value=?").bind(lease).run();}
}

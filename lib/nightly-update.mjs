import {deliveryPolicy} from '../config/delivery.mjs';
import {getSetting,settingStatement} from './news-pipeline.mjs';
export function nightlyClock(date=new Date()){
 const china=new Date(date.getTime()+8*3600000);
 return {day:china.toISOString().slice(0,10),hour:china.getUTCHours()};
}
/** One durable daily run; requests resume phases, never start extra collections. */
export async function runNightlyUpdate(db,actions,date=new Date()){
 const clock=nightlyClock(date),lease=String(Date.now()+deliveryPolicy.leaseMs);
 const lock=await db.prepare("INSERT INTO settings(key,value) VALUES('nightly_update_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key").bind(lease,Date.now()).first();
 if(!lock)return {busy:true,complete:false};
 try{
  let run=await getSetting(db,'nightly_update',null);
  if(!run||run.phase==='complete'){
   if(run?.day===clock.day)return {complete:true,alreadyCompleted:true,day:run.day,publishedAt:run.publishedAt};
   if(clock.hour<deliveryPolicy.startHour)return {complete:true,skipped:true,reason:'每天北京时间 21:00 启动一次',nextStart:clock.day+'T21:00:00+08:00'};
   run={day:clock.day,phase:'news',startedAt:date.toISOString()};
   await settingStatement(db,'nightly_update',run).run();
  }
  // Old 08:00/20:00 tasks must not accidentally collect or dispatch. An
  // unfinished nightly run can resume after midnight until 08:00.
  if(clock.hour>=8&&clock.hour<deliveryPolicy.startHour)return {complete:true,skipped:true,reason:'本轮等待夜间任务继续',resumePending:true};
  const persist=()=>settingStatement(db,'nightly_update',run).run();
  if(run.phase==='news'){
   const result=await actions.news();if(result.busy)return result;
   if(!result.complete)return {...result,phase:'news'};
   const state=await actions.read();
   if(!state.processedAt||state.processedAt!==result.publishedAt||Date.parse(state.processedAt)<Date.parse(run.startedAt))throw Error('尚未读到本轮已发布结果');
   await settingStatement(db,'nightly_publication',{runId:run.day,publishedAt:state.processedAt,hot:state.hot||[],activities:state.activities||[]}).run();
   run={...run,phase:'models',publishedAt:state.processedAt,pending:result.pending||0};await persist();
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

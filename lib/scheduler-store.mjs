import {getSetting,settingStatement} from './news-pipeline.mjs';
import {validJob} from './scheduler-contract.mjs';

export const ownerKey=kind=>'scheduler_owner_'+kind;
export const runKey=job=>'scheduler_run_'+job.id+(job.mode==='probe'?'_probe':'');
export const schedulerOwner=(db,kind)=>getSetting(db,ownerKey(kind),'legacy');
const write=(db,key,value)=>settingStatement(db,key,value).run();

export async function schedulerStatus(db) {
  return {version:1,owners:{daily:await schedulerOwner(db,'daily'),episodes:await schedulerOwner(db,'episodes')},
    daily:await getSetting(db,'scheduler_latest_daily',null),episodes:await getSetting(db,'scheduler_latest_episodes',null),
    probes:{daily:await getSetting(db,'scheduler_probe_daily',null),episodes:await getSetting(db,'scheduler_probe_episodes',null)},retention:await getSetting(db,'retention_status',null)};
}
export async function setSchedulerOwner(db,kind,owner) {
  if(!['daily','episodes'].includes(kind)||!['legacy','cloudflare'].includes(owner))throw Error('Invalid owner');
  // Both executors check ownership under their existing business lock.
  await write(db,ownerKey(kind),owner);return {kind,owner};
}
async function saveRun(db,job,run) {
  await db.batch([settingStatement(db,runKey(job),run),settingStatement(db,(job.mode==='probe'?'scheduler_probe_':'scheduler_latest_')+job.kind,run)]);
}
export async function receiptSummary(db,kind,since,until) {
  const rows=await db.prepare('SELECT status,COUNT(*) n FROM notices WHERE kind=? AND created_at>=? AND created_at<=? GROUP BY status').bind(kind==='daily'?'daily':'episodes',since,until).all();
  const summary={sent:0,failed:0,unknown:0,sending:0};
  for(const row of rows.results)if(Object.hasOwn(summary,row.status))summary[row.status]=row.n;
  return summary; // Counts notified items, not physical Feishu message batches.
}
export async function schedulerStep(db,input,actions,now=Date.now()) {
  const job=validJob(input,now),key=runKey(job),lease=String(now+300000);
  const lock=await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key').bind('scheduler_lock_'+job.kind,lease,now).first();
  if(!lock)return {complete:false,busy:true,reason:'scheduler_busy'};
  try {
    let run=await getSetting(db,key,null);
    if(run?.complete)return run;
    const owner=await schedulerOwner(db,job.kind);
    run={...run,...job,startedAt:run?.startedAt||new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),batches:run?.batches||0,complete:false};
    if(job.mode==='probe'){
      run={...run,complete:true,outcome:'probe',owner,finishedAt:new Date(now).toISOString()};await saveRun(db,job,run);return run;
    }
    if(owner!=='cloudflare')return {...run,complete:true,skipped:true,outcome:'inactive',owner};
    await saveRun(db,job,run);
    let result;
    try {result=await actions[job.kind](job);}
    catch {await saveRun(db,job,{...run,lastError:'backend_error'});throw Error('Backend batch failed; progress retained');}
    if(result.busy)return {complete:false,busy:true,reason:'business_busy',runId:job.runId};
    if(result.blocked)return {complete:false,blocked:true,reason:result.reason||'business_blocked',runId:job.runId};
    const at=new Date().toISOString();
    run={...run,batches:run.batches+1,updatedAt:at,phase:result.phase,checked:result.checked,failedSources:result.failed,
      pending:result.pending||0,complete:!!result.complete,skipped:!!result.skipped,alreadyCompleted:!!result.alreadyCompleted,publishedAt:result.publishedAt,lastError:null};
    if(run.complete){
      run.receipts=await receiptSummary(db,job.kind,run.startedAt,at);
      run.finishedAt=at;
      run.outcome=run.skipped?'skipped':run.alreadyCompleted?'already_completed':run.pending||run.failedSources||run.receipts.failed||run.receipts.unknown||run.receipts.sending?'attention':'complete';
      if(job.kind==='daily'){
        const publication=await getSetting(db,'news_publication_v3',null);
        run.website={processedAt:publication?.processedAt||null,hot:publication?.hot?.length||0,activities:publication?.activities?.length||0};
      }
    }
    await saveRun(db,job,run);return run;
  } finally {await db.prepare('DELETE FROM settings WHERE key=? AND value=?').bind('scheduler_lock_'+job.kind,lease).run();}
}

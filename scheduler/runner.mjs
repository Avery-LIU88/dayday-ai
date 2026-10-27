import {scheduledJob,schedulerLimits} from '../lib/scheduler-contract.mjs';

// One HTTP call advances a bounded batch. Workflows, not timers, persist the next step.
export async function advanceWorkflow(payload,step,env,{fetcher=fetch,now=Date.now,fatal=message=>new Error(message)}={}) {
  const job={...scheduledJob(payload.kind,payload.scheduledAt,payload.trigger),trigger:payload.trigger,mode:payload.mode};
  if(!['cron','manual'].includes(job.trigger)||!['probe','active'].includes(job.mode))throw fatal('Invalid workflow payload');
  const origin=new URL(env.SITE_ORIGIN);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw fatal('Invalid Site origin');
  if(!env.SCHEDULER_TOKEN||env.SCHEDULER_TOKEN.length<32)throw fatal('Scheduler secret missing');
  const limit=schedulerLimits[job.kind];
  for(let index=0;index<limit.steps;index++){
    const result=await step.do('batch-'+index,{retries:{limit:5,delay:'30 seconds',backoff:'exponential'},timeout:'4 minutes'},async()=>{
      if(now()-Date.parse(job.scheduledAt)>limit.lifetimeMs)throw fatal('Job deadline exceeded; resume requires operator review');
      let response;
      try{response=await fetcher(new URL('/api/scheduler',origin),{method:'POST',headers:{Authorization:'Bearer '+env.SCHEDULER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({...job,action:'step'}),redirect:'manual',signal:AbortSignal.timeout(180000)});}
      catch{throw Error('Site connection interrupted; resume saved progress');}
      if(!response.ok){
        await response.body?.cancel();
        if(response.status===429||response.status>=500)throw Error('Temporary Site error '+response.status);
        throw fatal('Site rejected scheduler request '+response.status);
      }
      let data;try{data=await response.json();}catch{throw Error('Invalid Site response');}
      if(data.busy)throw Error('Site lease busy');
      if(data.blocked)throw fatal('Site run blocked: '+String(data.reason||'unknown'));
      if(typeof data.complete!=='boolean'||data.runId!==job.runId)throw fatal('Unexpected Site run identity');
      return data;
    });
    if(result.complete)return result;
  }
  throw fatal('Batch limit exceeded; saved Site progress retained');
}

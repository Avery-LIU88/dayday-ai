import {WorkflowEntrypoint,WorkflowEvent,WorkflowStep} from 'cloudflare:workers';
import {NonRetryableError} from 'cloudflare:workflows';
import {advanceWorkflow} from './runner.mjs';
import {cronKinds,scheduledJob} from '../lib/scheduler-contract.mjs';

type Params={kind:'daily'|'episodes';scheduledAt:string;trigger:'cron'|'manual';mode:'probe'|'active'};
interface Env {SITE_ORIGIN:string;SCHEDULER_TOKEN:string;SCHEDULER_MODE:'probe'|'active';UPDATES:Workflow<Params>}
export class DaydayUpdate extends WorkflowEntrypoint<Env,Params> {
  async run(event:WorkflowEvent<Params>,step:WorkflowStep){
    try{
      const result=await advanceWorkflow(event.payload,step,this.env,{fatal:message=>new NonRetryableError(message)});
      console.log(JSON.stringify({event:'workflow_finished',instanceId:event.instanceId,kind:result.kind,runId:result.runId,trigger:result.trigger,outcome:result.outcome,complete:result.complete,publishedAt:result.publishedAt,receipts:result.receipts}));
      return result;
    }catch(error){console.error(JSON.stringify({event:'workflow_failed',instanceId:event.instanceId,kind:event.payload.kind,scheduledAt:event.payload.scheduledAt,message:error instanceof Error?error.message:'Workflow failed'}));throw error;}
  }
}
export default {
  async scheduled(controller:ScheduledController,env:Env,ctx:ExecutionContext){
    const kind=cronKinds[controller.cron as keyof typeof cronKinds] as Params['kind']|undefined;
    if(!kind)throw Error('Unexpected cron expression');
    const job=scheduledJob(kind,controller.scheduledTime),mode=env.SCHEDULER_MODE;
    if(!['probe','active'].includes(mode))throw Error('Invalid scheduler mode');
    const id=job.id+(mode==='probe'?'-probe':'');
    ctx.waitUntil((async()=>{
      try{await env.UPDATES.create({id,params:{kind,scheduledAt:job.scheduledAt,trigger:'cron',mode}});}
      catch(error){
        // get() alone does not prove an instance exists. Read status before treating a duplicate as success.
        try{await (await env.UPDATES.get(id)).status();}catch{throw error;}
      }
      console.log(JSON.stringify({event:'cron_trigger',cron:controller.cron,scheduledAt:job.scheduledAt,kind,instanceId:id,mode}));
    })());
  },
  fetch(){return new Response('Not found',{status:404});},
};

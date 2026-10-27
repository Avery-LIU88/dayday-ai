// Shared by the external Cron/Workflow and the Site. No platform credentials.
export const cronKinds = {'0 * * * *':'episodes','0 13 * * *':'daily'};
export const schedulerLimits = {
  daily: {steps:400, lifetimeMs:4*3600000},
  episodes: {steps:100, lifetimeMs:55*60000},
};
export function scheduledJob(kind, scheduledAt, trigger='cron') {
  if(!Object.hasOwn(schedulerLimits,kind))throw Error('Invalid job kind');
  const time=new Date(scheduledAt),ms=time.getTime();
  const manualDaily=kind==='daily'&&trigger==='manual';
  if(!Number.isFinite(ms)||(!manualDaily&&(time.getUTCMinutes()||time.getUTCSeconds()||time.getUTCMilliseconds()||(kind==='daily'&&time.getUTCHours()!==13))))throw Error('Invalid scheduled time');
  const iso=time.toISOString(),day=new Date(ms+8*3600000).toISOString().slice(0,10);
  if(manualDaily)return {kind,scheduledAt:iso,runId:`manual-${iso}`,id:`daily-manual-${iso.replace(/[:.]/g,'-')}`};
  return {kind,scheduledAt:iso,runId:kind==='daily'?day:iso,id:kind==='daily'?`daily-${day}`:`episodes-${iso.replace(/[:.]/g,'-')}`};
}
export function validJob(input, now=Date.now()) {
  const job=scheduledJob(input?.kind,input?.scheduledAt,input?.trigger);
  if(input?.runId!==job.runId||!['cron','manual'].includes(input?.trigger)||!['probe','active'].includes(input?.mode))throw Error('Invalid job identity');
  if(Date.parse(job.scheduledAt)>now+60000)throw Error('Future job');
  if(now-Date.parse(job.scheduledAt)>schedulerLimits[job.kind].lifetimeMs)throw Error('Job deadline exceeded');
  return {...job,trigger:input.trigger,mode:input.mode};
}

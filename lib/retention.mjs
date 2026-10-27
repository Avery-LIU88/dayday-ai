import {retentionPolicy as policy} from '../config/retention.mjs';
import {getSetting,setSetting} from './settings-json.mjs';

export function retainedIssues(issues,now=Date.now()) {
  const cutoff=new Date(now-policy.contentDays*86400000).toISOString().slice(0,10);
  return issues.filter(x=>(x.endDate||x.date)>=cutoff);
}
// Run only after the daily publication and delivery finish. Bounded batches
// continue through the existing Workflow, never through another polling Cron.
export async function runRetention(db,now=Date.now()) {
  if(!await getSetting(db,'retention_enabled',false))return {complete:true,enabled:false};
  const day=n=>new Date(now-n*86400000).toISOString(), old=day(policy.contentDays), raw=day(policy.rawDays), log=day(policy.logDays), limit=policy.batchRows;
  const terminal="status IN ('grouped','filtered','archived')";
  // Missing/uncertain activity dates are retained rather than guessed away.
  const ended=`COALESCE(json_extract(raw,'$.activityListing'),0)=0 OR julianday(COALESCE(json_extract(raw,'$.activityCandidate.endAt'),json_extract(raw,'$.activityCandidate.endDate')||'T23:59:59+08:00',json_extract(raw,'$.activityCandidate.date')||'T23:59:59+08:00',json_extract(raw,'$.activityCandidate.registrationDeadline'))) < julianday(?)`;
  const jobs=[
    ['raw',`UPDATE pipeline_items SET raw=json_remove(raw,'$.summary') WHERE id IN (SELECT id FROM pipeline_items WHERE ${terminal} AND updated_at<? AND COALESCE(json_extract(raw,'$.activityListing'),0)=0 AND json_type(raw,'$.summary') IS NOT NULL LIMIT ?)`,[raw,limit]],
    ['items',`DELETE FROM pipeline_items WHERE id IN (SELECT id FROM pipeline_items WHERE ${terminal} AND published_at<? AND updated_at<? AND (${ended}) AND NOT EXISTS (SELECT 1 FROM pipeline_items other WHERE other.duplicate_of=pipeline_items.id AND other.status IN ('collected','analyzed','deduplicated','error')) LIMIT ?)`,[old,old,old,limit]],
    ['events',`DELETE FROM pipeline_events WHERE id IN (SELECT e.id FROM pipeline_events e WHERE e.updated_at<? AND NOT EXISTS (SELECT 1 FROM pipeline_items i WHERE i.event_id=e.id) AND NOT EXISTS (SELECT 1 FROM pipeline_events child WHERE child.parent_id=e.id) LIMIT ?)`,[old,limit]],
    ['steps','DELETE FROM pipeline_steps WHERE id IN (SELECT id FROM pipeline_steps WHERE updated_at<? LIMIT ?)',[log,limit]],
    ['runs','DELETE FROM runs WHERE id IN (SELECT id FROM runs WHERE finished_at<? LIMIT ?)',[log,limit]],
    ['entries',"DELETE FROM entries WHERE id IN (SELECT id FROM entries WHERE kind='episode' AND published_at<? AND NOT EXISTS (SELECT 1 FROM saved WHERE saved.entry_id=entries.id) LIMIT ?)",[old,limit]],
    // Retain IDs and receipt status indefinitely; unknown/reserved payloads remain.
    ['noticeBodies',"UPDATE notices SET message='' WHERE id IN (SELECT id FROM notices WHERE status='sent' AND created_at<? AND message!='' LIMIT ?)",[log,limit]],
    ['modelBodies',"UPDATE pipeline_calls SET response=NULL,usage=NULL WHERE id IN (SELECT id FROM pipeline_calls WHERE status='received' AND created_at<? AND response IS NOT NULL LIMIT ?)",[raw,limit]],
    ['limits','DELETE FROM feedback_limits WHERE key IN (SELECT key FROM feedback_limits WHERE expires_at<? LIMIT ?)',[now,limit]],
    ['schedulerRuns',"DELETE FROM settings WHERE key IN (SELECT key FROM settings WHERE key GLOB 'scheduler_run_*' AND json_valid(value) AND json_extract(value,'$.complete')=1 AND json_extract(value,'$.finishedAt')<? LIMIT ?)",[log,limit]],
  ];
  const results=await db.batch(jobs.map(([,sql,args])=>db.prepare(sql).bind(...args)));
  const counts=Object.fromEntries(jobs.map(([name],i)=>[name,results[i].meta?.changes||0]));
  // Cloud D1 disallows storage PRAGMAs; use its query metadata instead.
  const measurement=await db.prepare('SELECT 1 AS retention_check').all();
  const allocatedBytes=Number.isFinite(measurement.meta?.size_after)?measurement.meta.size_after:null;
  const report={enabled:true,complete:Object.values(counts).every(n=>n<limit),checkedAt:new Date(now).toISOString(),counts,allocatedBytes,capacityWarning:allocatedBytes===null?null:allocatedBytes>=policy.warningBytes};
  await setSetting(db,'retention_status',report);return report;
}

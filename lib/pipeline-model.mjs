import {policy} from '../config/pipeline.mjs';
export class PipelinePause extends Error { constructor(code,message){super(message);this.code=code;} }
export const chinaDay=(now=Date.now())=>new Date(now+8*3600000).toISOString().slice(0,10);
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function usageCost(usage,pricing=policy.pricing){
  const input=usage?.prompt_tokens,output=usage?.completion_tokens;
  if(!Number.isInteger(input)||input<0||!Number.isInteger(output)||output<0)return null;
  const hit=Math.min(input,Math.max(0,usage.prompt_cache_hit_tokens||0));
  return Math.ceil((input-hit)*pricing.input+hit*pricing.cachedInput+output*pricing.output);
}
export async function budgetStatus(db,now=Date.now()){
  const day=chinaDay(now),row=await db.prepare('SELECT COALESCE(SUM(charge_micro),0) AS charged, COUNT(*) AS calls FROM pipeline_calls WHERE day=?').bind(day).first();
  return {day,currency:'CNY',limit:policy.dailyBudgetCny,accountedCny:row.charged/1e6,calls:row.calls,pricing:'peak_conservative'};
}
/** Reservation and receipt share one row: a crash can never free an unknown bill. */
export async function modelJSON(db,apiKey,purpose,system,items,{fetcher=fetch,now=Date.now(),config=policy}={}){
  if(!apiKey)throw new PipelinePause('missing_key','模型密钥尚未配置');
  const messages=[{role:'system',content:system},{role:'user',content:JSON.stringify({items})}];
  const payload={model:config.model,messages,response_format:{type:'json_object'},thinking:{type:'disabled'},stream:false,max_tokens:config.maxOutputTokens};
  const key=await digest(JSON.stringify({version:config.version,purpose,payload}));
  const prior=await db.prepare('SELECT * FROM pipeline_calls WHERE id=?').bind(key).first();
  if(prior?.response){try{return JSON.parse(prior.response);}catch{throw new PipelinePause('invalid_response','已保存的模型响应格式错误，需核对后重试');}}
  if(prior)throw new PipelinePause(prior.status==='reserved'?'uncertain_call':prior.status,'该调用已有未完成或失败回执，已阻止重复计费');
  // UTF-8 bytes upper-bound tokenizer input; generous per-message overhead.
  const maxInput=new TextEncoder().encode(JSON.stringify(messages)).length+2048;
  const reserve=Math.ceil(maxInput*config.pricing.input+config.maxOutputTokens*config.pricing.output);
  const day=chinaDay(now),at=new Date(now).toISOString();
  const claim=await db.prepare(`INSERT INTO pipeline_calls(id,day,purpose,model,status,charge_micro,reserved_micro,created_at)
    SELECT ?,?,?,?,'reserved',?,?,? WHERE (SELECT COALESCE(SUM(charge_micro),0) FROM pipeline_calls WHERE day=?) + ? <= ?
    ON CONFLICT(id) DO NOTHING RETURNING id`).bind(key,day,purpose,config.model,reserve,reserve,at,day,reserve,Math.floor(config.dailyBudgetCny*1e6)).first();
  if(!claim)throw new PipelinePause('budget','今日预算不足，待处理内容已保留');
  let response;
  try{response=await fetcher(config.baseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',redirect:'manual',headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(config.requestTimeoutMs)});}
  catch(error){const detail=String(error?.name+': '+error?.message).replace(/sk-[a-zA-Z0-9_-]+/g,'[redacted]').slice(0,200);await db.prepare("UPDATE pipeline_calls SET status='uncertain',error=? WHERE id=?").bind(detail+'；费用按预留上限保留',key).run();throw new PipelinePause('uncertain_call','模型响应未确认，费用按预留上限保留');}
  if(!response.ok){
    const rejected=[400,401,402,403,404,422,429].includes(response.status);
    await response.body?.cancel();
    await db.prepare('UPDATE pipeline_calls SET status=?,charge_micro=?,error=? WHERE id=?').bind(rejected?'rejected':'uncertain',rejected?0:reserve,`模型 HTTP ${response.status}`,key).run();
    throw new PipelinePause('provider',`模型服务返回 HTTP ${response.status}`);
  }
  let result;
  try{result=await response.json();}catch{throw new PipelinePause('uncertain_call','模型响应未确认，预留费用保留');}
  const raw=result.choices?.[0]?.message?.content||'',cost=usageCost(result.usage,config.pricing);
  await db.prepare('UPDATE pipeline_calls SET status=?,response=?,usage=?,charge_micro=?,error=? WHERE id=?')
    .bind('received',raw,JSON.stringify(result.usage||{}),cost===null?reserve:Math.max(0,cost),result.choices?.[0]?.finish_reason==='length'?'输出长度不足':'',key).run();
  try{return JSON.parse(raw);}catch{throw new PipelinePause('invalid_response','模型输出不是有效 JSON，已保留回执，不重复扣费');}
}

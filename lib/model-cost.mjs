import {organizationIcon} from './model-ranking.mjs';
const providers={openai:'openai',anthropic:'anthropic',google:'deepmind',deepseek:'deepseek',qwen:'alibaba',moonshotai:'moonshot','z-ai':'zai','meta-llama':'meta',xai:'xai',microsoft:'microsoft',nvidia:'nvidia',minimax:'minimax',stepfun:'stepfun',bytedance:'bytedance',tencent:'tencent',baidu:'baidu'};
const normalize=s=>s.toLowerCase().replace(/[\s_-]/g,'');
const price=v=>typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
/** Match exact version names and creator, never infer aliases or thinking configurations. */
export function buildCostSnapshot(payload,updatedAt=new Date().toISOString()){
 if(!Array.isArray(payload?.data))throw Error('Invalid price response');
 const rows=payload.data.flatMap(m=>{
  const provider=providers[m.id?.split('/')[0]],p=price(m.pricing?.prompt),c=price(m.pricing?.completion);
  if(!provider||!m.name||m.id.includes(':')||p===null||c===null||!m.architecture?.output_modalities?.includes('text'))return [];
  // Presets use at most 10k input Tokens and no optional search/media/cache.
  if(m.pricing.request&&Number(m.pricing.request)!==0)return [];
  if(m.pricing.overrides&&(!Array.isArray(m.pricing.overrides)||m.pricing.overrides.some(o=>!Number.isFinite(o.min_prompt_tokens)||o.min_prompt_tokens<=10000)))return [];
  if(m.pricing.internal_reasoning&&price(m.pricing.internal_reasoning)!==c)return [];
  return [{id:m.id,name:m.name.replace(/^[^:]+:\s*/,''),provider,input:p,output:c}];
 });
 if(rows.length<2)throw Error('Insufficient prices');
 return {updatedAt,source:'https://openrouter.ai/api/v1/models',rows};
}
export function joinCostModels(models,prices,inputTokens=1000,outputTokens=1000){
 if(![inputTokens,outputTokens].every(x=>Number.isFinite(x)&&x>=0))return [];
 return models.flatMap(m=>{
  if(!Number.isFinite(m.score))return [];
  const matches=prices.filter(p=>p.provider===organizationIcon(m.organization)&&normalize(p.name)===normalize(m.name));
  if(matches.length!==1)return [];
  const p=matches[0],cost=p.input*inputTokens+p.output*outputTokens;
  return Number.isFinite(cost)?[{...m,priceID:p.id,input:p.input,output:p.output,cost}]:[];
 }).sort((a,b)=>a.cost-b.cost||b.score-a.score);
}
export function frontierIDs(rows){
 return new Set(rows.filter(a=>!rows.some(b=>b.cost<=a.cost&&b.score>=a.score&&(b.cost<a.cost||b.score>a.score))).map(r=>r.id));
}
export async function fetchCostSnapshot(fetcher=fetch){
 const response=await fetcher('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Price fetch failed');
 return buildCostSnapshot(await response.json());
}

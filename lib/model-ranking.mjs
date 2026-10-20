// Only Epoch-administered individual evaluations and Epoch's own ECI are imported.
// External benchmark CSVs in the same download retain their separate licenses.
export const EPOCH_DOWNLOAD='https://epoch.ai/data/benchmark_data.zip';
export const EPOCH_SOURCE='https://epoch.ai/benchmarks/use-this-data';
export const benchmarks=[
 {id:'eci',category:'overall',name:'Epoch ECI',file:'epoch_capabilities_index/eci_scores.csv',unit:'ECI',description:'Epoch 综合能力指数，保留原始刻度，不是百分制。',url:'https://epoch.ai/eci'},
 {id:'swe',category:'coding',name:'SWE-bench Verified',file:'swe_bench_verified.csv',unit:'%',description:'解决真实 GitHub 项目的软件问题。',url:'https://epoch.ai/benchmarks/swe-bench-verified'},
 {id:'gpqa',category:'research',name:'GPQA Diamond',file:'gpqa_diamond.csv',unit:'%',description:'研究生难度的科学问答。',url:'https://epoch.ai/benchmarks/gpqa-diamond'},
 {id:'frontier',category:'research',name:'FrontierMath T1–3 v2',file:'frontiermath_tiers_1_3_v2.csv',unit:'%',description:'高难度数学问题。',url:'https://epoch.ai/benchmarks/frontiermath-tiers-1-3-v2'},
 {id:'simpleqa',category:'knowledge',name:'SimpleQA Verified',file:'simpleqa_verified.csv',unit:'%',description:'事实性短问答的正确率。',url:'https://epoch.ai/benchmarks/simple-qa-verified'},
];
export function parseCSV(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(field);field='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}
  else field+=c;
 }
 if(quoted)throw Error('Incomplete CSV');
 if(field||row.length){row.push(field);rows.push(row);}
 const headers=(rows.shift()||[]).map(s=>s.replace(/^\uFEFF/,''));
 return rows.map(cells=>Object.fromEntries(headers.map((h,i)=>[h,cells[i]??''])));
}
const number=value=>value!==undefined&&value!==null&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
const date=value=>value&&Number.isFinite(Date.parse(value))?value:null;
const safeURL=value=>{try{return new URL(value).protocol==='https:'?value:null;}catch{return null;}};
export function rankedRows(rows){
 const sorted=[...rows].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
 let rank=0,last=null;
 return sorted.map((row,i)=>{const displayed=row.score.toFixed(2);if(displayed!==last){rank=i+1;last=displayed;}return {...row,rank};});
}
export function buildModelSnapshot(files,updatedAt){
 const metadata=new Map(parseCSV(files['model_metadata.csv']||'').filter(r=>r.model_version).map(r=>[r.model_version,r]));
 const boards=benchmarks.map(spec=>{
  if(!files[spec.file])throw Error(`Missing ${spec.file}`);
  const records=parseCSV(files[spec.file]),isECI=spec.id==='eci',unique=new Map();
  for(const r of records){
   const raw=number(isECI?r.eci:r.mean_score),id=isECI?r.Model:r['Model version'];
   if(!id||raw===null||(!isECI&&(raw<0||raw>1)))continue;
   const meta=metadata.get(id),row={
    id,name:isECI?(r['Display name']||id):(meta?.display_name||meta?.model_group||id),
    configuration:isECI?(r.model_versions||''):id,
    organization:r.Organization||meta?.organization||'',
    score:isECI?raw:raw*100,releaseDate:date(isECI?r.date:r['Release date']),
    evaluatedAt:isECI?null:date(r['Started at']),logURL:safeURL(r['Log viewer']),
    intervalLow:isECI?number(r.eci_ci_low):null,intervalHigh:isECI?number(r.eci_ci_high):null,
    standardError:isECI?null:number(r.stderr),
   };
   // Keep the latest evaluation of the exact configuration, never cherry-pick its highest score.
   const existing=unique.get(id);
   if(!existing||(row.evaluatedAt||'')>(existing.evaluatedAt||''))unique.set(id,row);
  }
  if(unique.size<2)throw Error(`Insufficient data: ${spec.id}`);
  const rows=rankedRows([...unique.values()]);
  return {...spec,rows,evaluatedAt:rows.map(r=>r.evaluatedAt).filter(Boolean).sort().at(-1)||null};
 });
 return {version:1,updatedAt,source:EPOCH_SOURCE,boards};
}
export function organizationIcon(org){
 const aliases=[[/openai/i,'openai'],[/anthropic/i,'anthropic'],[/google|deepmind/i,'deepmind'],[/deepseek/i,'deepseek'],[/alibaba|qwen/i,'alibaba'],[/moonshot/i,'moonshot'],[/zhipu|z\.ai/i,'zai'],[/meta/i,'meta'],[/xai|x\.ai|spacex/i,'xai'],[/microsoft/i,'microsoft'],[/nvidia/i,'nvidia'],[/minimax/i,'minimax'],[/stepfun/i,'stepfun'],[/bytedance/i,'bytedance'],[/tencent/i,'tencent'],[/baidu/i,'baidu']];
 return aliases.find(([pattern])=>pattern.test(org))?.[1]||null;
}

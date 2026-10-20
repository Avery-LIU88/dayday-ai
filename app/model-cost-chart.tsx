'use client';
import {useMemo,useState} from 'react';
import {ExternalLink} from 'lucide-react';
import {joinCostModels,frontierIDs} from '../lib/model-cost.mjs';
import {organizationIcon} from '../lib/model-ranking.mjs';
import icons from '../data/source-icons.json';
import type {ModelRow} from '../lib/model-ranking-types';
export type PriceSnapshot={updatedAt:string;source:string;rows:{id:string;name:string;provider:string;input:number;output:number}[]};
const manifest=icons as Record<string,{path:string}>;
const money=(n:number)=>`$${n.toFixed(n<.01?4:3)}`;
export default function ModelCostChart({models,prices,scoreUpdatedAt}:{models:ModelRow[];prices:PriceSnapshot;scoreUpdatedAt:string}){
 const [preset,setPreset]=useState('balanced'),[focused,setFocused]=useState<string|null>(null),[onlyFrontier,setOnlyFrontier]=useState(true);
 const volumes=preset==='input'?[10000,1000]:preset==='output'?[1000,5000]:[1000,1000];
 const rows=useMemo(()=>joinCostModels(models,prices.rows,volumes[0],volumes[1]) as (ModelRow&{cost:number;priceID:string;input:number;output:number})[],[models,prices,volumes[0],volumes[1]]);
 const frontier=useMemo(()=>frontierIDs(rows),[rows]),visible=onlyFrontier?rows.filter(r=>frontier.has(r.id)):rows;
 const chosen=visible.find(r=>r.id===focused)||rows.filter(r=>frontier.has(r.id)).sort((a,b)=>b.score-a.score)[0];
 const maxCost=Math.max(.001,...visible.map(r=>r.cost))*1.08,minScore=Math.floor(Math.min(...visible.map(r=>r.score))/20)*20,maxScore=Math.ceil(Math.max(...visible.map(r=>r.score))/20)*20;
 const x=(cost:number)=>72+cost/maxCost*790,y=(score:number)=>405-(score-minScore)/Math.max(1,maxScore-minScore)*345;
 const front=rows.filter(r=>frontier.has(r.id)).sort((a,b)=>a.cost-b.cost);
 return <div className="cost-view">
  <div className="model-toolbar"><div className="model-benchmark-title"><h2>能力 × 成本</h2><span>语言模型 · ECI × OpenRouter 报价</span></div><label className="cost-preset">估算用量<select aria-label="估算 Token 用量" value={preset} onChange={e=>setPreset(e.target.value)}><option value="balanced">输入 1,000 / 输出 1,000 Tokens</option><option value="input">输入 10,000 / 输出 1,000 Tokens</option><option value="output">输入 1,000 / 输出 5,000 Tokens</option></select></label></div>
  <div className="cost-chart-card"><div className="cost-chart-caption"><span>越靠左上，能力越高、费用越低</span><label><input type="checkbox" checked={onlyFrontier} onChange={e=>setOnlyFrontier(e.target.checked)}/>仅看效率前沿</label></div>
   {rows.length>1?<div className="cost-svg-scroll"><svg viewBox="0 0 920 480" role="group" aria-label="语言模型能力与估算费用散点图">
    <text x="72" y="25" className="cost-axis-title">能力（ECI）</text>
    {[0,1,2,3,4].map(i=>{const value=minScore+(maxScore-minScore)*i/4;return <g key={`y${i}`}><line x1="72" x2="862" y1={y(value)} y2={y(value)} className="cost-grid"/><text x="57" y={y(value)+4} textAnchor="end" className="cost-tick">{value.toFixed(0)}</text></g>;})}
    {[0,1,2,3,4].map(i=>{const value=maxCost*i/4;return <g key={`x${i}`}><line y1="60" y2="405" x1={x(value)} x2={x(value)} className="cost-grid"/><text x={x(value)} y="433" textAnchor="middle" className="cost-tick">{money(value)}</text></g>;})}
    <text x="862" y="464" textAnchor="end" className="cost-axis-title">估算 API 费用（美元）</text>
    <polyline points={front.map(r=>`${x(r.cost)},${y(r.score)}`).join(' ')} className="cost-frontier"/>
    {visible.map(r=>{const id=organizationIcon(r.organization),path=typeof id==='string'?manifest[id]?.path:null;return <g key={r.id} role="button" tabIndex={0} aria-label={`${r.name}，ECI ${r.score.toFixed(2)}，估算 ${money(r.cost)}`} onClick={()=>setFocused(r.id)} onFocus={()=>setFocused(r.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setFocused(r.id);}}} className={`cost-point ${chosen?.id===r.id?'active':''}`}><title>{r.name} · {r.score.toFixed(2)} ECI · {money(r.cost)}</title><circle cx={x(r.cost)} cy={y(r.score)} r={chosen?.id===r.id?17:13} className={frontier.has(r.id)?'on-frontier':''}/>{path?<image href={path} x={x(r.cost)-9} y={y(r.score)-9} width="18" height="18"/>:<text x={x(r.cost)} y={y(r.score)+4} textAnchor="middle" fontSize="10">{r.organization.slice(0,1)}</text>}</g>;})}
    {chosen&&visible.some(r=>r.id===chosen.id)&&<text x={x(chosen.cost)>700?x(chosen.cost)-23:x(chosen.cost)+23} y={y(chosen.score)-21} textAnchor={x(chosen.cost)>700?'end':'start'} className="cost-point-label">{chosen.name}</text>}
   </svg></div>:<p className="model-no-results">暂无可比的能力与价格数据。</p>}
   {chosen&&<div className="cost-selection"><div><strong>{chosen.name}</strong><span>{chosen.organization}{frontier.has(chosen.id)?' · 效率前沿':''}</span></div><div><strong>{chosen.score.toFixed(2)}</strong><span>ECI 指数</span></div><div><strong>{money(chosen.cost)}</strong><span>估算费用</span></div><a href={`https://openrouter.ai/${chosen.priceID}`} target="_blank" rel="noopener noreferrer" aria-label={`查看 ${chosen.name} 报价`}><ExternalLink size={18}/></a></div>}
  </div>
  <details className="model-method cost-method"><summary>数据与计算方式</summary><div><p>能力使用 Epoch AI ECI，报价来自 OpenRouter。仅匹配同一厂商、同一模型名称与版本；这不是 Artificial Analysis 或 Vals 的实测任务成本。</p><p>估算费用 = 输入 Tokens × 输入单价 + 输出 Tokens × 输出单价。输出量需包括计费的推理 Tokens；不含工具、缓存优惠、税费。价格可能随供应商路由变化，ECI 模型分组也不保证与当前服务的推理配置一致。</p><p>蓝线连接当前数据中不存在“更便宜且能力更高”替代项的模型；不代表所有任务的性价比排名。图像、视频、语音单位不同，不混入此图。</p><p>能力同步：{new Date(scoreUpdatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}；报价同步：{new Date(prices.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}。</p><p><a href="https://epoch.ai/eci" target="_blank" rel="noopener noreferrer">Epoch AI（CC BY）</a> · <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">OpenRouter 报价</a> · <a href="https://www.vals.ai/benchmarks/gpqa" target="_blank" rel="noopener noreferrer">Vals GPQA 图表参考（已归档）</a></p></div></details>
  <div className="cost-list"><div className="cost-list-head"><span>模型</span><span>ECI</span><span>估算费用</span></div>{[...visible].sort((a,b)=>b.score-a.score).map(r=><button key={r.id} className={chosen?.id===r.id?'selected':''} onClick={()=>setFocused(r.id)}><span>{r.name}{frontier.has(r.id)&&<small>效率前沿</small>}</span><span>{r.score.toFixed(2)}</span><span>{money(r.cost)}</span></button>)}</div>
 </div>;
}

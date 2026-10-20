'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Code2,Image,Video,AudioLines,Coins,Trophy,Search,ChevronRight,ExternalLink,X} from 'lucide-react';
import seed from '../data/model-rankings.json';
import priceSeed from '../data/model-costs.json';
import mediaSeed from '../data/model-media.json';
import assets from '../data/model-brand-assets.json';
import ModelCostChart,{type PriceSnapshot} from './model-cost-chart';
import icons from '../data/source-icons.json';
import {organizationIcon} from '../lib/model-ranking.mjs';
import type {ModelSnapshot,ModelHealth} from '../lib/model-ranking-types';
import type {DisplayBoard,DisplayRow,MediaSnapshot} from '../lib/model-board-types';
const categories=[{id:'overall',label:'综合',icon:Trophy},{id:'coding',label:'编程',icon:Code2},{id:'image',label:'图像',icon:Image},{id:'video',label:'视频',icon:Video},{id:'voice',label:'语音',icon:AudioLines},{id:'cost',label:'成本',icon:Coins}];
const manifest=icons as Record<string,{path:string}>,brandAssets=assets as Record<string,string>;
const date=(value:string|null)=>value?new Date(value).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}):'未提供';
function timestamp(value:string){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));return `${p.month}/${p.day}　${p.hour}:${p.minute}更新`;}
function ModelIcon({row}:{row:DisplayRow}){
 const [failed,setFailed]=useState(false),id=organizationIcon(row.organization),path=brandAssets[row.sourceIcon||'']||brandAssets[row.organization]||(typeof id==='string'?manifest[id]?.path:null);
 return path&&!failed?<span className="model-brand-icon"><img src={path} alt="" width={32} height={32} onError={()=>setFailed(true)}/></span>:<span className="model-brand-icon model-brand-unknown" aria-hidden="true"/>;
}
function scoreText(row:DisplayRow,board:DisplayBoard){return `${row.score.toFixed(board.decimals)}${board.unit==='%'?'%':''}`;}
function epochBoards(snapshot:ModelSnapshot):DisplayBoard[]{return snapshot.boards.filter(b=>b.category==='overall'||b.category==='coding').map(b=>({...b,label:b.id==='eci'?'综合能力':'代码修复',metric:b.id==='eci'?'ECI 指数':'解决率',decimals:2,sourceName:'Epoch AI',source:snapshot.source,license:'CC BY',updatedAt:snapshot.updatedAt}));}
export default function ModelLeaderboard(){
 const [snapshot,setSnapshot]=useState(seed as ModelSnapshot),[media,setMedia]=useState(mediaSeed as MediaSnapshot),[health,setHealth]=useState<ModelHealth|null>(null),[category,setCategory]=useState('overall'),[benchmark,setBenchmark]=useState('eci'),[query,setQuery]=useState(''),[limit,setLimit]=useState(30),[selected,setSelected]=useState<DisplayRow|null>(null);
 const [prices,setPrices]=useState(priceSeed as PriceSnapshot);
 const dialog=useRef<HTMLDialogElement>(null),lastFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>{const controller=new AbortController();fetch('/api/models',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json() as Promise<{snapshot:ModelSnapshot;health:ModelHealth|null;prices?:PriceSnapshot;media?:MediaSnapshot}>;}).then(data=>{
  if(data.snapshot?.version===1&&data.snapshot.boards?.length)setSnapshot(current=>Date.parse(data.snapshot.updatedAt)>=Date.parse(current.updatedAt)?data.snapshot:current);
  setHealth(data.health);
  if(data.prices?.rows?.length)setPrices(current=>Date.parse(data.prices!.updatedAt)>=Date.parse(current.updatedAt)?data.prices!:current);
  if(data.media?.version===1&&data.media.boards?.length)setMedia(current=>Date.parse(data.media!.updatedAt)>=Date.parse(current.updatedAt)?data.media!:current);
 }).catch(()=>{});return()=>controller.abort();},[]);
 useEffect(()=>{if(selected)dialog.current?.showModal();else{dialog.current?.close();lastFocus.current?.focus();}},[selected]);
 const allBoards=useMemo(()=>[...epochBoards(snapshot),...media.boards],[snapshot,media]);
 const boards=allBoards.filter(b=>b.category===category),board=boards.find(b=>b.id===benchmark)||boards[0];
 const rows=useMemo(()=>board?.rows.filter(r=>`${r.name} ${r.configuration} ${r.organization}`.toLowerCase().includes(query.trim().toLowerCase()))||[],[board,query]);
 function changeCategory(id:string){setCategory(id);setBenchmark(allBoards.find(b=>b.category===id)?.id||'');setQuery('');setLimit(30);setSelected(null);}
 const max=board?.unit==='%'?100:Math.max(1,...(board?.rows.map(r=>r.score)||[]));
 const updatedAt=category==='cost'?prices.updatedAt:board?.updatedAt||snapshot.updatedAt;
 const stale=board?.evaluatedAt&&Date.now()-Date.parse(board.evaluatedAt)>60*86400000;
 return <section className="model-leaderboard">
  <header className="heading"><h1>模型榜单</h1><time className="news-updated-at" dateTime={updatedAt}>{timestamp(updatedAt)}</time></header>
  <nav className="model-categories" aria-label="模型应用场景">{categories.map(({id,label,icon:Icon})=><button key={id} aria-pressed={category===id} className={category===id?'selected':''} onClick={()=>changeCategory(id)}><Icon size={19}/>{label}</button>)}</nav>
  {category==='cost'?<ModelCostChart models={snapshot.boards.find(b=>b.id==='eci')?.rows||[]} prices={prices} scoreUpdatedAt={snapshot.updatedAt}/>:board&&<>
   {boards.length>1&&<nav className="model-subcategories" aria-label="评测任务">{boards.map(b=><button key={b.id} className={board.id===b.id?'selected':''} aria-pressed={board.id===b.id} onClick={()=>{setBenchmark(b.id);setLimit(30);setSelected(null);}}>{b.label}</button>)}</nav>}
   <div className="model-toolbar"><div className="model-benchmark-title"><h2>{board.id==='eci'?'综合能力':board.id==='swe'?'代码修复':board.name}</h2><span>{board.sourceName}{board.evaluatedAt?` · ${date(board.evaluatedAt)} 榜单`:''}</span></div><label className="model-search"><Search size={18}/><input type="search" aria-label="搜索模型或公司" placeholder="搜索模型或公司" value={query} onChange={e=>{setQuery(e.target.value);setLimit(30);}}/></label></div>
   {stale&&<p className="model-sync-note">此项最近评测较早，尚未覆盖近期新模型。</p>}
   {health&&!health.ok&&['overall','coding'].includes(category)&&Date.parse(health.checkedAt)>Date.parse(snapshot.updatedAt)&&<p className="model-sync-note" role="status">本次同步未完成，展示上次有效成绩。</p>}
   <div className="model-table" role="table" aria-label={`${board.name}模型排名`}>
    <div className="model-table-head" role="row"><span role="columnheader">排名</span><span role="columnheader">模型</span><span role="columnheader">{board.metric}</span><span aria-hidden="true"/></div>
    {rows.slice(0,limit).map(row=><div className={`model-rank-row ${row.rank<=3?'model-top-rank':''}`} role="row" key={row.id}>
     <span className="model-rank-number" role="cell">{String(row.rank).padStart(2,'0')}</span>
     <div className="model-identity" role="cell"><ModelIcon key={`${board.id}:${row.id}`} row={row}/><div><button className="model-name" aria-label={`查看 ${row.name} 的评测详情`} onClick={e=>{lastFocus.current=e.currentTarget;setSelected(row);}}>{row.name}</button>{(row.organization||row.preliminary||row.available===false)&&<span className="model-organization">{row.organization}{row.preliminary?' · 初步成绩':''}{row.available===false?' · 已停止服务':''}</span>}</div></div>
     <div className="model-score-cell" role="cell"><strong>{scoreText(row,board)}</strong><div className="model-score-track" aria-hidden="true"><span style={{width:`${Math.max(0,Math.min(100,row.score/max*100))}%`}}/></div></div>
     <span role="cell" className="model-row-arrow"><button aria-label={`展开 ${row.name} 的详情`} onClick={e=>{lastFocus.current=e.currentTarget;setSelected(row);}}><ChevronRight size={17}/></button></span>
    </div>)}
    {!rows.length&&<div className="model-no-results">没有找到匹配的模型<button onClick={()=>setQuery('')}>清除搜索</button></div>}
   </div>
   {rows.length>limit&&<button className="more" onClick={()=>setLimit(limit+30)}>查看更多模型</button>}
   <footer className="model-attribution"><a href={board.source} target="_blank" rel="noopener noreferrer">数据：{board.sourceName} <ExternalLink size={13}/></a><details className="model-method"><summary>评分说明</summary><div><p>{board.description}</p>{board.sourceName==='Epoch AI'?<><p>ECI 使用原始刻度，不是百分制。编程解决率来自 Epoch 自行运行的 SWE-bench Verified；同一配置重复记录取最新成绩。</p><p>缺失成绩不记为零；不同榜单、不同配置不混合平均。</p></>:board.sourceName==='Arena'?<p>Arena 分基于用户盲测偏好的 Bradley–Terry 评级。保留原榜排名、版本与置信区间，各任务独立比较。来源数据按 CC BY 4.0 署名，本站仅做筛选和展示。</p>:<p>TTS Arena 原榜按置信下界排名，兼顾质量与样本不确定性，因此显示评分不一定随排名递减。保留初步成绩、样本数与停用状态。</p>}<p>条形长度以本榜最高分为参照；百分比以 100% 为参照。每天早 8 点、晚 8 点检查上游，顶部是本站成功同步时间，榜单日期单独标注。</p><p>参考：<a href="https://artificialanalysis.ai/" target="_blank" rel="noopener noreferrer">Artificial Analysis</a> · <a href="https://www.vals.ai/benchmarks" target="_blank" rel="noopener noreferrer">Vals</a></p></div></details></footer>
  </>}
  <dialog className="model-detail" ref={dialog} aria-labelledby="model-detail-title" onCancel={()=>setSelected(null)} onClick={e=>{if(e.target===dialog.current)setSelected(null);}}><button className="dialog-close" aria-label="关闭模型详情" onClick={()=>setSelected(null)}><X/></button>{selected&&board&&<>
   <ModelIcon key={selected.id} row={selected}/>{selected.organization&&<p className="model-detail-org">{selected.organization}</p>}<h2 id="model-detail-title">{selected.name}</h2>
   <div className="model-detail-score"><strong>{scoreText(selected,board)}</strong><span>{board.metric} · 第 {selected.rank} 名</span></div>
   <dl><dt>模型版本 / 配置</dt><dd>{selected.configuration||'按 Epoch 综合指数的模型分组'}</dd>{selected.releaseDate&&<><dt>模型发布时间</dt><dd>{date(selected.releaseDate)}</dd></>}{selected.evaluatedAt&&<><dt>{board.sourceName==='Arena'?'榜单日期':'评测时间'}</dt><dd>{date(selected.evaluatedAt)}</dd></>}{selected.intervalLow!==null&&selected.intervalHigh!==null&&<><dt>置信区间</dt><dd>{selected.intervalLow.toFixed(board.decimals)} – {selected.intervalHigh.toFixed(board.decimals)}</dd></>}{selected.uncertainty!=null&&<><dt>评分不确定性</dt><dd>± {selected.uncertainty}</dd></>}{selected.standardError!==null&&<><dt>标准误差</dt><dd>± {(selected.standardError*100).toFixed(2)} 个百分点</dd></>}{selected.samples!=null&&<><dt>盲测样本数</dt><dd>{selected.samples.toLocaleString('zh-CN')}</dd></>}{selected.preliminary&&<><dt>成绩状态</dt><dd>初步成绩，样本较少</dd></>}{selected.available===false&&<><dt>服务状态</dt><dd>已停止服务，保留原榜历史成绩</dd></>}<dt>数据来源</dt><dd>{board.sourceName}</dd><dt>本站同步时间</dt><dd>{new Date(board.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</dd></dl>
   <p className="model-detail-note">{board.description}</p><div className="model-detail-links"><a className="secondary" href={board.url} target="_blank" rel="noopener noreferrer">查看原始榜单 <ExternalLink size={15}/></a>{selected.modelURL&&<a href={selected.modelURL} target="_blank" rel="noopener noreferrer">模型官网 <ExternalLink size={15}/></a>}{selected.logURL&&<a href={selected.logURL} target="_blank" rel="noopener noreferrer">评测记录 <ExternalLink size={15}/></a>}</div>
  </>}</dialog>
 </section>;
}

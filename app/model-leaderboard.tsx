'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Code2,Image,Video,AudioLines,Coins,Trophy,Search,ChevronRight,ExternalLink,X,Clock3} from 'lucide-react';
import seed from '../data/model-rankings.json';
import priceSeed from '../data/model-costs.json';
import ModelCostChart,{type PriceSnapshot} from './model-cost-chart';
import OfficialBoard,{officialBoards,type OfficialCategory} from './model-official-board';
import icons from '../data/source-icons.json';
import {organizationIcon} from '../lib/model-ranking.mjs';
import type {ModelSnapshot,ModelBoard,ModelRow,ModelHealth} from '../lib/model-ranking-types';
const categories=[{id:'overall',label:'综合',icon:Trophy},{id:'coding',label:'编程',icon:Code2},{id:'image',label:'图像',icon:Image},{id:'video',label:'视频',icon:Video},{id:'voice',label:'语音',icon:AudioLines},{id:'cost',label:'成本',icon:Coins}];
const manifest=icons as Record<string,{path:string}>;
const date=(value:string|null)=>value?new Date(value).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}):'未提供';
function timestamp(value:string){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));return `${p.month}/${p.day}　${p.hour}:${p.minute}更新`;}
function ModelIcon({organization}:{organization:string}){
 const [failed,setFailed]=useState(false),id=organizationIcon(organization),path=typeof id==='string'?manifest[id]?.path:null;
 return path&&!failed?<span className="model-brand-icon"><img src={path} alt="" width={32} height={32} onError={()=>setFailed(true)}/></span>:null;
}
function scoreText(row:ModelRow,board:ModelBoard){return `${row.score.toFixed(2)}${board.unit==='%'?'%':''}`;}
export default function ModelLeaderboard(){
 const [snapshot,setSnapshot]=useState(seed as ModelSnapshot),[health,setHealth]=useState<ModelHealth|null>(null),[category,setCategory]=useState('overall'),[benchmark,setBenchmark]=useState('eci'),[query,setQuery]=useState(''),[limit,setLimit]=useState(30),[selected,setSelected]=useState<ModelRow|null>(null);
 const [prices,setPrices]=useState(priceSeed as PriceSnapshot),[overallSource,setOverallSource]=useState('aa');
 const dialog=useRef<HTMLDialogElement>(null),lastFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>{const controller=new AbortController();fetch('/api/models',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json() as Promise<{snapshot:ModelSnapshot;health:ModelHealth|null;prices?:PriceSnapshot}>;}).then(data=>{if(data.snapshot?.version===1&&data.snapshot.boards?.length){setSnapshot(current=>Date.parse(data.snapshot.updatedAt)>=Date.parse(current.updatedAt)?data.snapshot:current);setHealth(data.health);if(data.prices?.rows?.length)setPrices(current=>Date.parse(data.prices!.updatedAt)>=Date.parse(current.updatedAt)?data.prices!:current);}}).catch(()=>{});return()=>controller.abort();},[]);
 useEffect(()=>{if(selected)dialog.current?.showModal();else{dialog.current?.close();lastFocus.current?.focus();}},[selected]);
 const boards=snapshot.boards.filter(b=>b.category===category),board=boards.find(b=>b.id===benchmark)||boards[0];
 const rows=useMemo(()=>board?.rows.filter(r=>`${r.name} ${r.configuration} ${r.organization}`.toLowerCase().includes(query.trim().toLowerCase()))||[],[board,query]);
 function changeCategory(id:string){setCategory(id);setBenchmark(snapshot.boards.find(b=>b.category===id)?.id||'');setQuery('');setLimit(30);setSelected(null);}
 const max=board?.unit==='%'?100:Math.max(1,...(board?.rows.map(r=>r.score)||[]));
 const stale=board?.evaluatedAt&&Date.now()-Date.parse(board.evaluatedAt)>60*86400000;
 const official=(category in officialBoards)&&(category!=='overall'||overallSource==='aa');
 return <section className="model-leaderboard">
  <header className="heading"><h1>模型榜单</h1>{!official&&<time className="news-updated-at" dateTime={category==='cost'?prices.updatedAt:snapshot.updatedAt}>{timestamp(category==='cost'?prices.updatedAt:snapshot.updatedAt)}</time>}</header>
  <nav className="model-categories" aria-label="模型应用场景">{categories.map(({id,label,icon:Icon})=><button key={id} aria-pressed={category===id} className={category===id?'selected':''} onClick={()=>changeCategory(id)}><Icon size={20}/>{label}</button>)}</nav>
  {category==='overall'&&<div className="model-source-switch" aria-label="综合榜来源"><button className={overallSource==='aa'?'selected':''} onClick={()=>setOverallSource('aa')}>Artificial Analysis</button><button className={overallSource==='epoch'?'selected':''} onClick={()=>setOverallSource('epoch')}>Epoch AI</button></div>}
  {official?<OfficialBoard key={category} category={category as OfficialCategory}/>:category==='cost'?<ModelCostChart models={snapshot.boards.find(b=>b.id==='eci')?.rows||[]} prices={prices} scoreUpdatedAt={snapshot.updatedAt}/>:board&&<>
   <div className="model-toolbar">
    <div className="model-benchmark-title">{boards.length>1?<label className="model-benchmark-select"><span className="sr-only">选择评测</span><select aria-label="选择评测" value={board.id} onChange={e=>{setBenchmark(e.target.value);setLimit(30);setSelected(null);}}>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>:<h2>{board.name}</h2>}<span>{board.id==='eci'?'综合能力指数':'Epoch AI 独立评测'}</span></div>
    <label className="model-search"><Search size={18}/><input type="search" aria-label="搜索模型或公司" placeholder="搜索模型或公司" value={query} onChange={e=>{setQuery(e.target.value);setLimit(30);}}/></label>
   </div>
   <div className="model-board-note"><p>{board.description}</p>{board.evaluatedAt&&<span className={stale?'model-old-evaluation':''}>最近评测 {date(board.evaluatedAt)}{stale?' · 尚未覆盖近期新模型':''}</span>}</div>
   {health&&!health.ok&&Date.parse(health.checkedAt)>Date.parse(snapshot.updatedAt)&&<p className="model-sync-note" role="status"><Clock3 size={15}/>本次同步未完成，正在展示上次有效成绩。</p>}
   <div className="model-table" role="table" aria-label={`${board.name}模型排名`}>
    <div className="model-table-head" role="row"><span role="columnheader">排名</span><span role="columnheader">模型</span><span role="columnheader">{board.unit==='%'?'正确率':'ECI 指数'}</span><span aria-hidden="true"/></div>
    {rows.slice(0,limit).map(row=><div className={`model-rank-row ${row.rank<=3?'model-top-rank':''}`} role="row" key={row.id}>
     <span className="model-rank-number" role="cell">{String(row.rank).padStart(2,'0')}</span>
     <div className="model-identity" role="cell"><ModelIcon organization={row.organization}/><div><button className="model-name" aria-label={`查看 ${row.name} 的评测详情`} onClick={e=>{lastFocus.current=e.currentTarget;setSelected(row);}}>{row.name}</button><span className="model-organization">{row.organization}</span></div></div>
     <div className="model-score-cell" role="cell"><strong>{scoreText(row,board)}</strong><div className="model-score-track" aria-hidden="true"><span style={{width:`${Math.max(0,Math.min(100,row.score/max*100))}%`}}/></div></div>
     <span role="cell" className="model-row-arrow"><button aria-label={`展开 ${row.name} 的详情`} onClick={e=>{lastFocus.current=e.currentTarget;setSelected(row);}}><ChevronRight size={17}/></button></span>
    </div>)}
    {!rows.length&&<div className="model-no-results">没有找到匹配的模型<button onClick={()=>setQuery('')}>清除搜索</button></div>}
   </div>
   {rows.length>limit&&<button className="more" onClick={()=>setLimit(limit+30)}>查看更多模型</button>}
   {category==='coding'&&<div className="official-more"><a href="https://artificialanalysis.ai/leaderboards/models" target="_blank" rel="noopener noreferrer">Artificial Analysis 编程指标 <ExternalLink size={14}/></a><a href="https://www.vals.ai/benchmarks" target="_blank" rel="noopener noreferrer">Vals 编程评测 <ExternalLink size={14}/></a></div>}
   <footer className="model-attribution"><a href={snapshot.source} target="_blank" rel="noopener noreferrer">数据：Epoch AI <ExternalLink size={13}/></a><details className="model-method"><summary>评分说明</summary><div><p>综合榜沿用 Epoch ECI 原始指数与模型分组，不代表百分制或正确率。分类榜采用 Epoch 自行运行的对应评测；各项独立排序，不混合平均。</p><p>分类榜按具体版本和配置展示。同一配置有重复记录时使用最新评测，不挑最高成绩。缺失成绩不计零分、不参与该项排名；显示成绩相同则并列。</p><p>条形图用于比较当前榜内成绩。ECI 条长以当前最高分为参照，百分比成绩以 100% 为参照。不同榜单不能直接横比。</p><p>每天随早 8 点、晚 8 点采集任务检查上游。顶部时间是成功同步时间，模型发布时间、评测时间分别记录；同步不代表重新评测。</p><p>来源：Epoch AI, Capabilities &amp; benchmarking。按 CC BY 署名；仅展示 Epoch 自有指数与自行评测成绩。</p><a href="https://epoch.ai/benchmarks" target="_blank" rel="noopener noreferrer">查看评测方法 <ExternalLink size={13}/></a></div></details></footer>
  </>}
  <dialog className="model-detail" ref={dialog} aria-labelledby="model-detail-title" onCancel={()=>setSelected(null)} onClick={e=>{if(e.target===dialog.current)setSelected(null);}}><button className="dialog-close" aria-label="关闭模型详情" onClick={()=>setSelected(null)}><X/></button>{selected&&board&&<>
   <ModelIcon organization={selected.organization}/><p className="model-detail-org">{selected.organization}</p><h2 id="model-detail-title">{selected.name}</h2>
   <div className="model-detail-score"><strong>{scoreText(selected,board)}</strong><span>{board.name} · 第 {selected.rank} 名</span></div>
   <dl><dt>模型版本 / 配置</dt><dd>{selected.configuration||'按 Epoch 综合指数的模型分组'}</dd><dt>模型发布时间</dt><dd>{date(selected.releaseDate)}</dd><dt>评测时间</dt><dd>{board.id==='eci'?'综合多项评测，无单一评测时间':date(selected.evaluatedAt)}</dd>{selected.intervalLow!==null&&selected.intervalHigh!==null&&<><dt>ECI 置信区间</dt><dd>{selected.intervalLow.toFixed(2)} – {selected.intervalHigh.toFixed(2)}</dd></>}{selected.standardError!==null&&<><dt>标准误差</dt><dd>± {(selected.standardError*100).toFixed(2)} 个百分点</dd></>}<dt>本站同步时间</dt><dd>{new Date(snapshot.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</dd></dl>
   <p className="model-detail-note">{board.description}{board.id==='eci'?' 相近成绩应结合置信区间判断。':' 评测表现取决于任务和运行配置。'}</p>
   <div className="model-detail-links"><a className="secondary" href={board.url} target="_blank" rel="noopener noreferrer">查看原始榜单 <ExternalLink size={15}/></a>{selected.logURL&&<a href={selected.logURL} target="_blank" rel="noopener noreferrer">评测记录 <ExternalLink size={15}/></a>}</div>
  </>}</dialog>
 </section>;
}

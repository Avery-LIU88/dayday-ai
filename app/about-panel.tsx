'use client';
import {useState} from 'react';
import {Satellite,Flame,Newspaper,CalendarDays,ArrowRight,Pause,Play,Check,Layers,Radio} from 'lucide-react';
import type {NewsState} from '../lib/news-store';
import icons from '../data/source-icons.json';
const manifest=icons as Record<string,{path:string}>;
const sourceNodes=[{id:'openai',name:'OpenAI',x:55,y:45},{id:'anthropic',name:'Anthropic',x:140,y:112},{id:'deepmind',name:'Google',x:45,y:183},{id:'36kr',name:'36氪',x:155,y:253},{id:'arxiv',name:'arXiv',x:55,y:315},{id:'github',name:'GitHub',x:213,y:40}];
const descriptions=[{title:'采集',text:'从公司官方、媒体、论文与开发者平台汇入公开动态。'},{title:'筛选去重',text:'筛选 AI 相关内容，识别重复链接与相近报道。'},{title:'聚合排序',text:'同一事件合并展示，综合重要性、一手证据、热度与时效，选出今日必知。'},{title:'热点与简报',text:'浏览今日热点，或用日报、周报回顾值得关注的进展。'}];
export default function AboutPanel({data,onBrowse,onSources}:{data:NewsState;onBrowse:()=>void;onSources:()=>void}){
 const [paused,setPaused]=useState(false),[step,setStep]=useState(0);
 const stages=[{...descriptions[0],number:data.stats.healthy,unit:'个近期可用发布者'},{...descriptions[1],number:data.pipeline.processed,unit:'条已处理动态'},{...descriptions[2],number:data.stats.stories,unit:'个聚合事件'},{...descriptions[3],number:data.daily.length,unit:'期日报归档'}];
 return <div className="about-panel"><header className="about-intro"><p>DayDay AI</p><h2>每天一点，<span>跟上 AI。</span></h2><div><p>把分散的信息，整理成值得你关注的事。</p><button onClick={onBrowse}>浏览今日热点 <ArrowRight size={17}/></button></div></header>
  <section className={`signal-river ${paused?'is-paused':''}`} aria-label="从信息源到热点与简报的处理流程"><div className="river-top"><span>一条信息的旅程</span><button onClick={()=>setPaused(!paused)} aria-pressed={paused} aria-label={paused?'播放流程动画':'暂停流程动画'}>{paused?<Play size={15}/>:<Pause size={15}/>}</button></div>
   <div className="river-visual"><svg viewBox="0 0 1160 360" role="img" aria-label="多个信息源经过筛选去重，聚合为事件，再形成热点、日报与周报"><defs><linearGradient id="river-line"><stop stopColor="var(--line)"/><stop offset="1" stopColor="var(--accent)"/></linearGradient><pattern id="river-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="var(--line)" opacity=".35"/></pattern></defs><rect width="1160" height="360" fill="url(#river-dots)"/>
    {sourceNodes.map((node,i)=>{const d=`M ${node.x+28} ${node.y} C 300 ${node.y}, 295 180, 405 180`;return <g key={node.id}><path d={d} className="river-line"/><path d={d} className="river-signal" style={{animationDelay:`${i*-.9}s`}}/><g className="river-source" style={{animationDelay:`${i*-.9}s`}}><rect x={node.x-22} y={node.y-22} width="44" height="44" rx="11" fill="white" stroke="#dce1e8"/>{manifest[node.id]&&<image href={manifest[node.id].path} x={node.x-13} y={node.y-13} width="26" height="26"/>}<title>{node.name}</title></g></g>;})}
    <path d="M 495 180 L 715 180" className="river-line"/><path d="M 495 180 L 715 180" className="river-signal river-middle"/>
    {[80,180,280].map((y,i)=><g key={y}><path d={`M 805 180 C 900 180, 900 ${y}, 970 ${y}`} className="river-line"/><path d={`M 805 180 C 900 180, 900 ${y}, 970 ${y}`} className="river-signal" style={{animationDelay:`${i*-.8}s`}}/></g>)}
    <rect x="405" y="135" width="90" height="90" rx="24" className="river-node"/><g color="var(--accent)"><Satellite x="429" y="159" width="42" height="42"/></g><text x="450" y="254" textAnchor="middle" className="river-label">筛选去重</text>
    <rect x="715" y="135" width="90" height="90" rx="24" className="river-node"/><g color="var(--accent)"><Layers x="741" y="161" width="38" height="38"/></g><text x="760" y="254" textAnchor="middle" className="river-label">聚合排序</text>
    {[{y:80,label:'今日热点',Icon:Flame},{y:180,label:'每日简报',Icon:Newspaper},{y:280,label:'周报',Icon:CalendarDays}].map(({y,label,Icon})=><g key={label}><rect x="970" y={y-27} width="150" height="54" rx="9" className="river-output"/><g color="var(--accent)"><Icon x="987" y={y-10} width="20" height="20"/></g><text x="1020" y={y+5} className="river-output-label">{label}</text></g>)}
    <text x="70" y="356" className="river-small">信息源</text><text x="572" y="162" className="river-small">同一件事，只看一次</text>
   </svg></div>
   <div className="about-stages">{stages.map((stage,i)=><button key={stage.title} onClick={()=>setStep(i)} className={step===i?'active':''} aria-pressed={step===i}><span className="about-stage-top"><small>0{i+1}</small><strong>{stage.title}</strong></span><span className="about-figure">{stage.number.toLocaleString('zh-CN')}<small>{stage.unit}</small></span></button>)}</div><p className="about-stage-description" aria-live="polite">{stages[step].text}</p>
  </section>
  <div className="about-bottom"><div><Radio size={21}/><strong>早 8 点 · 晚 8 点</strong><span>每天更新两次</span></div><div><Check size={21}/><strong>免费阅读</strong><span>无需注册</span></div><button onClick={onSources}>查看信息源 <ArrowRight size={17}/></button></div>
  <details className="about-method"><summary>了解筛选与热度依据</summary><div><p>热度按去重后的独立发布者数计算；重要性由 DeepSeek 判断。时效、可靠性单独记录，不相加成总分。</p><p>先用规则过滤明显无关内容，再提炼中文要点、去重和判断事件关系。页面读取已完成的处理结果，保留原文入口。</p><p>以上数量是当前已处理内容与近期来源状态；动画为流程示意。</p></div></details>
 </div>;
}

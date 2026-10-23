'use client';
import {useMemo,useState} from 'react';
import {Bookmark,ExternalLink,Search,Flame,ArrowUpRight,ChevronDown,Layers3,Clock3} from 'lucide-react';
import EventTrend from './event-trend';
import SourceMark from './source-mark';
import type {NewsState} from '../lib/news-store';
type Story=NewsState['stories'][number];

const time=(iso:string)=>new Date(iso).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
const stamp=(iso:string)=>new Date(iso).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
function publishers(s:Story){return [...new Map(s.links.map(l=>[l.publisher||l.sourceId,l])).values()];}
function Sources({story}:{story:Story}){
 const all=publishers(story);
 return <span className="event-sources real-sources">{all.slice(0,2).map(l=><SourceMark key={l.publisher||l.sourceId} publisher={l.publisher||l.sourceId} name={l.source}/>)}{all.length>2&&<span className="source-count">+{all.length-2}</span>}</span>;
}
export function EventScore({story}:{story:Story}){
 return <div className="event-insight"><EventTrend story={story} expanded/><p>{story.scoreParts.heat} 家发布者报道 · 重要性 {story.scoreParts.importance}/100 · {story.verification}</p><p>首页综合重要性、一手证据、报道覆盖与时效排序；日报按重要性排序。</p>{story.priority&&!story.priority.eligible&&<p>未入选今日热点：{story.priority.exclusions.join('；')}。</p>}{!!story.primaryEvidence?.length&&<p>一手材料：{story.primaryEvidence.map(e=><a key={e.url} href={e.url} target="_blank" rel="noopener noreferrer">{e.source} ↗ </a>)}</p>}</div>;
}
export default function TodayHot({data,saved,onSelect,onSave}:{data:NewsState;saved:Story[];onSelect:(s:Story)=>void;onSave:(s:Story)=>void}){
 const [category,setCategory]=useState('全部'),[query,setQuery]=useState(''),[sort,setSort]=useState('score'),[limit,setLimit]=useState(20);
 const categories=['全部','模型与产品','开源与开发','研究与论文','商业与政策'];
 function matches(s:Story,c:string){const text=s.title+' '+s.tags.join(' ');return c==='全部'||(c==='模型与产品'&&/公司动态|产品发布|模型|model|GPT|Claude|Gemini/i.test(text))||(c==='开源与开发'&&/开发者平台|开源|Agent|framework|toolkit/i.test(text))||(c==='研究与论文'&&/论文|技术报告|研究|research|paper|benchmark/i.test(text))||(c==='商业与政策'&&/投融资|融资|收购|政策|监管|商业|funding|acquisition|valuation|regulat|ban\b/i.test(text));}
 const events=useMemo(()=>{const selected=data.hot.filter(s=>matches(s,category)&&`${s.title} ${s.summary} ${s.source}`.toLowerCase().includes(query.trim().toLowerCase()));return sort==='time'?selected.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)):selected;},[data.hot,category,query,sort]);
 const featured=sort==='score'?events.slice(0,3):[],rest=events.slice(featured.length,limit);
 const isSaved=(s:Story)=>saved.some(x=>x.id===s.id);
 function reset(){setQuery('');setCategory('全部');setLimit(20);}
 return <div className="today-hot">
  <div className="hot-toolbar"><nav className="hot-categories" aria-label="热点分类">{categories.map(c=><button key={c} aria-pressed={category===c} className={category===c?'active':''} onClick={()=>{setCategory(c);setLimit(20);}}>{c}</button>)}</nav></div>
  <div className="hot-query"><label className="search"><Search size={17}/><input aria-label="搜索热点事件" placeholder="搜索事件、公司或产品" type="search" value={query} onChange={e=>{setQuery(e.target.value);setLimit(20);}}/></label><select aria-label="热点排序" value={sort} onChange={e=>{setSort(e.target.value);setLimit(20);}}><option value="score">今日必知优先</option><option value="time">最新报道优先</option></select></div>
  <div className="hot-section-tools">{featured.length>0&&<Flame className="focus-flame" size={21} role="img" aria-label="今日焦点"/>}<details className="ranking-method"><summary>排序依据 <ChevronDown size={14}/></summary><div className="method-popover"><h3>先选值得看的，再决定先看什么</h3><p>选取过去24小时有实质新进展、重要性达到{data.ranking.minimumImportance??60}的事件；传闻和公开材料不足的内容保留在主题页。</p>{data.ranking.weights&&<p>重要性 {Math.round(data.ranking.weights.importance*100)}% · 一手证据与可信度 {Math.round(data.ranking.weights.reliability*100)}% · 报道覆盖 {Math.round(data.ranking.weights.heat*100)}% · 时效 {Math.round(data.ranking.weights.recency*100)}%。</p>}<p>一手来源及报道中直接支持事件的一手引用获得加分。报道数量采用递减加分，同一发布者和已识别重复内容不重复增加热度。趋势线仍显示报道覆盖变化。</p></div></details></div>
  {featured.length>0&&<section className="hot-focus" aria-label="今日焦点"><div className="focus-grid">{featured.map((s,i)=><article className={`focus-card focus-${i+1}`} key={s.id}><div className="focus-top"><span className="focus-rank">{String(i+1).padStart(2,'0')}</span><span className="event-category">{s.topic}</span></div><h3><button onClick={()=>onSelect(s)}>{s.title}</button></h3><p className="focus-summary">{s.summary||'来源未提供公开摘要，点击查看原文。'}</p><p className="focus-why"><span>关注理由</span>{s.why}</p><button className="trend-trigger" aria-label={`查看${s.title}的热度趋势`} onClick={()=>onSelect(s)}><EventTrend story={s}/></button><div className="focus-footer"><Sources story={s}/><button className={`event-save ${isSaved(s)?'is-saved':''}`} aria-label={`${isSaved(s)?'取消收藏':'收藏'}：${s.title}`} aria-pressed={isSaved(s)} onClick={()=>onSave(s)}><Bookmark size={17}/></button></div><div className="focus-bottom"><span><Clock3 size={12}/>{time(s.publishedAt)} 最新报道</span><span>{s.verification}</span></div></article>)}</div></section>}
  {rest.length>0&&<section className="event-ranking" aria-label="事件榜单"><div className="event-list-heading"><h2>{featured.length?'更多热点':'事件榜单'}</h2><span>{sort==='score'?'按今日必知优先级排序':'按最新报道排序'}</span></div>{rest.map((s,i)=><article className="event-row" key={s.id}><div className="event-rank">{String(i+featured.length+1).padStart(2,'0')}</div><div className="event-body"><button className="trend-trigger row-trend" aria-label={`查看${s.title}的热度趋势`} onClick={()=>onSelect(s)}><EventTrend story={s}/></button><div className="event-row-top"><span className="event-category">{s.topic}</span><span className="event-time">{stamp(s.publishedAt)}</span></div><h3><button onClick={()=>onSelect(s)}>{s.title}</button></h3>{s.summary&&<p className="event-summary">{s.summary}</p>}<p className="event-why"><span>为什么关注</span>{s.why}</p><div className="event-row-footer"><details className="event-reports"><summary><Sources story={s}/><ChevronDown size={14}/></summary><ul>{s.links.map(l=><li key={`${l.sourceId}:${l.url}`}><a href={l.url} target="_blank" rel="noopener noreferrer"><SourceMark publisher={l.publisher||l.sourceId} name={l.source}/><ExternalLink size={12}/></a><time>{stamp(l.publishedAt)}</time></li>)}</ul></details><div className="event-row-actions"><button className={isSaved(s)?'is-saved':''} aria-pressed={isSaved(s)} onClick={()=>onSave(s)}><Bookmark size={15}/>{isSaved(s)?'已收藏':'收藏'}</button><button onClick={()=>onSelect(s)}>事件详情 <ArrowUpRight size={15}/></button></div></div></div></article>)}</section>}
  {!events.length&&<div className="empty bordered"><Layers3 size={30}/><h2>过去24小时暂无匹配事件</h2><p>调整筛选条件，或前往「主题」浏览历史内容。</p>{(query||category!=='全部')&&<button className="secondary" onClick={reset}>清除筛选</button>}</div>}
  {events.length>limit&&<button className="more" onClick={()=>setLimit(limit+20)}>查看更多事件 <ChevronDown size={16}/></button>}
 </div>;
}

'use client';
import {useRef,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight,ExternalLink,ArrowDown,ChevronDown} from 'lucide-react';
import type {NewsState} from '../lib/news-store';
import {briefSections,briefSection,groupBriefArticles} from '../lib/daily-layout.mjs';
import SourceMark from './source-mark';

const dateObject=(date:string)=>new Date(`${date}T12:00:00+08:00`);
const formattedDate=(date:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(dateObject(date));
const weekday=(date:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'}).format(dateObject(date));
const updateText=(iso:string)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));return `${p.month}/${p.day} ${p.hour}:${p.minute}更新`;};
type Development={title:string;summary:string;url:string;source:string;publisher:string;firstPublishedAt:string};
type Article={id:string;title:string;summary:string;url:string;source:string;publisher:string;topic:string;section?:string;firstPublishedAt:string;developments?:Development[]};
type Edition={date:string;endDate?:string;updatedAt:string;articles:Article[]};
const shortDate=(date:string)=>date.slice(5).replace('-','/');
const rangeText=(e:Edition)=>`${e.date.replaceAll('-','/')} — ${e.endDate?.replaceAll('-','/')}`;
function jumpTo(id:string){
 const target=document.getElementById(id);
 if(!target)return;
 target.focus({preventScroll:true});
 target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function BriefArticle({article,lead=false,index=0,weekly=false}:{article:Article;lead?:boolean;index?:number;weekly?:boolean}){
 const Heading=lead?'h2':'h3';
 return <article id={`daily-article-${index}`} tabIndex={-1} aria-labelledby={`daily-title-${index}`} className={`brief-story ${lead?'brief-lead':''}`}>
  {lead&&<div className="brief-story-label">{weekly?'本周头条':'头条'}<span>{briefSections.find(s=>s.id===briefSection(article))?.label}</span></div>}
  <Heading id={`daily-title-${index}`}><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a></Heading>
  {article.summary&&<p>{article.summary}</p>}
  <footer><a href={article.url} target="_blank" rel="noopener noreferrer" className="brief-original"><SourceMark publisher={article.publisher} name={article.source}/><span>原文</span><ExternalLink size={14}/></a></footer>
  {weekly&&!!article.developments?.length&&<details className="brief-developments"><summary>本周相关进展 · {article.developments.length}</summary><ol>{article.developments.map(d=><li key={d.url}><time dateTime={d.firstPublishedAt}>{new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(new Date(d.firstPublishedAt))}</time><div><a href={d.url} target="_blank" rel="noopener noreferrer">{d.title}<ExternalLink size={12}/></a><span>{d.source}</span></div></li>)}</ol></details>}
 </article>;
}
export default function DailyBrief({data,period='daily'}:{data:NewsState;period?:'daily'|'weekly'}){
 const weekly=period==='weekly',name=weekly?'周报':'日报';
 const editions:Edition[]=weekly?data.weekly:data.daily;
 const published=editions.filter((e:Edition,i:number)=>e.articles.length>0||(weekly&&i===0));
 const latest=published[0]?.date||editions[0]?.date;
 const [chosen,setChosen]=useState(''),[archiveOpen,setArchiveOpen]=useState(false);
 const top=useRef<HTMLDivElement>(null);
 const date=chosen||latest||'';
 const issue=editions.find((e:Edition)=>e.date===date);
 const older=published.find((e:Edition)=>e.date<date);
 const newer=[...published].reverse().find((e:Edition)=>e.date>date);
 const articles:Article[]=issue?.articles||[];
 const sections=groupBriefArticles(articles);
 const months=[...new Set(published.map((e:Edition)=>String(e.date).slice(0,7)))] as string[];
 function choose(value:string){setChosen(value);setArchiveOpen(false);top.current?.scrollIntoView({block:'start'});}
 return <div className="daily-layout" ref={top}>
  <aside className={`brief-archive ${archiveOpen?'archive-open':''}`} aria-label={`往期${name}`}>
   <div className="brief-archive-heading"><h2>往期</h2><CalendarDays size={18}/></div>
   <button className="brief-archive-toggle" aria-expanded={archiveOpen} aria-controls="daily-archive-list" onClick={()=>setArchiveOpen(!archiveOpen)}>往期{name} <ChevronDown size={16}/></button>
   <nav id="daily-archive-list" className="brief-archive-list" aria-label={weekly?'按周查看周报':'按日期查看日报'}>
    {months.map(month=><section className="brief-month" key={month}>
     <h3>{month.slice(0,4)} 年 {Number(month.slice(5))} 月</h3>
     {published.filter((e:Edition)=>e.date.startsWith(month)).map((e:Edition)=><button key={e.date} className={`brief-archive-day ${weekly?'brief-archive-week':''} ${date===e.date?'selected':''}`} aria-current={date===e.date?'date':undefined} onClick={()=>choose(e.date)}>
      {weekly?<span className="brief-week-range">{shortDate(e.date)} — {shortDate(e.endDate||e.date)}</span>:<span className="brief-day-number">{e.date.slice(8)}<small>{weekday(e.date)}</small></span>}
      <span className="brief-archive-title">{e.articles[0]?.title||'本期周报待更新'}</span>
     </button>)}
    </section>)}
    {!months.length&&<p className="brief-archive-none">暂无往期</p>}
   </nav>
  </aside>
  <section className="daily-newspaper" aria-label={`AI ${name}`}>
   <div className="brief-navigation">
    {issue?.updatedAt&&<time className="brief-updated" dateTime={issue.updatedAt}>{updateText(issue.updatedAt)}</time>}
   </div>
   <header className="brief-masthead">
    <div><div className="brief-name">DayDay AI</div><h1>AI {name}</h1><div className="brief-edition-date">{date&&<time dateTime={date}>{weekly&&issue?rangeText(issue):formattedDate(date)}</time>}</div></div>
    {date&&!weekly&&<div className="brief-calendar-stamp" aria-hidden="true"><span>{Number(date.slice(5,7))} 月</span><strong>{date.slice(8)}</strong><small>{weekday(date)}</small></div>}
   </header>
   {articles.length?<>
    <div className={`brief-front-page ${articles.length===1?'single-story':''}`}>
     <BriefArticle article={articles[0]} lead weekly={weekly}/>
     {articles.length>1&&<section className="brief-highlights" aria-labelledby="daily-highlights-heading"><h2 id="daily-highlights-heading">{weekly?'本周看点':'今日看点'}</h2><ol>{articles.slice(1,4).map((article:Article,index:number)=><li key={article.id}><button onClick={()=>jumpTo(`daily-article-${index+1}`)}><span>{String(index+1).padStart(2,'0')}</span><strong>{article.title}</strong><ArrowDown size={15}/></button></li>)}</ol></section>}
    </div>
    {sections.length>0&&<nav className="brief-contents" aria-label="本期分类"><h2>本期分类</h2><div>{sections.map((section,index)=><button key={section.id} onClick={()=>jumpTo(`daily-section-${section.id}`)}><span className="brief-section-number">{String(index+1).padStart(2,'0')}</span><span>{section.label}</span><small>{section.articles.length} 件</small><ArrowDown size={14}/></button>)}</div></nav>}
    <div className="brief-sections">{sections.map((section,index)=><section key={section.id} id={`daily-section-${section.id}`} className="brief-category" tabIndex={-1} aria-labelledby={`daily-section-title-${section.id}`}><header><span>{String(index+1).padStart(2,'0')}</span><h2 id={`daily-section-title-${section.id}`}>{section.label}</h2></header>{section.articles.map(({article,index:articleIndex}:{article:Article;index:number})=>articleIndex===0?<button key={article.id} className="brief-lead-reference" onClick={()=>jumpTo('daily-article-0')}><span>{weekly?'本周头条':'本期头条'}</span><strong>{article.title}</strong><ChevronRight size={16}/></button>:<BriefArticle key={article.id} article={article} index={articleIndex} weekly={weekly}/>)}</section>)}</div>
    <div className="brief-end"><span>本期完</span></div>
   </>:<div className="brief-empty"><h2>{date===editions[0]?.date?'本期简报待更新':weekly?'这一周暂无周报':'这一天暂无简报'}</h2><p>可以从往期选择其他日期。</p>{older&&<button onClick={()=>choose(older.date)}>阅读上一期 <ChevronRight size={15}/></button>}</div>}
   <nav className="brief-pagination" aria-label={`翻阅${name}`}><button disabled={!older} onClick={()=>older&&choose(older.date)}><ChevronLeft size={17}/>上一期{older&&<span>{older.date.slice(5).replace('-','/')}</span>}</button><button disabled={!newer} onClick={()=>newer&&choose(newer.date)}>下一期{newer&&<span>{newer.date.slice(5).replace('-','/')}</span>}<ChevronRight size={17}/></button></nav>
  </section>
 </div>;
}

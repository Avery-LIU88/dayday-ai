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
type Edition=NewsState['daily'][number];
type Article=Edition['articles'][number];
function jumpTo(id:string){
 const target=document.getElementById(id);
 if(!target)return;
 target.focus({preventScroll:true});
 target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function BriefArticle({article,lead=false,index=0}:{article:Article;lead?:boolean;index?:number}){
 const Heading=lead?'h2':'h3';
 return <article id={`daily-article-${index}`} tabIndex={-1} aria-labelledby={`daily-title-${index}`} className={`brief-story ${lead?'brief-lead':''}`}>
  {lead&&<div className="brief-story-label">头条<span>{briefSections.find(s=>s.id===briefSection(article))?.label}</span></div>}
  <Heading id={`daily-title-${index}`}><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a></Heading>
  {article.summary&&<p>{article.summary}</p>}
  <footer><a href={article.url} target="_blank" rel="noopener noreferrer" className="brief-original"><SourceMark publisher={article.publisher} name={article.source}/><span>原文</span><ExternalLink size={14}/></a></footer>
 </article>;
}
export default function DailyBrief({data}:{data:NewsState}){
 const editions=data.daily;
 const published=editions.filter((e:Edition)=>e.articles.length>0);
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
  <aside className={`brief-archive ${archiveOpen?'archive-open':''}`} aria-label="往期日报">
   <div className="brief-archive-heading"><h2>往期</h2><CalendarDays size={18}/></div>
   <button className="brief-archive-toggle" aria-expanded={archiveOpen} aria-controls="daily-archive-list" onClick={()=>setArchiveOpen(!archiveOpen)}>往期日报 <ChevronDown size={16}/></button>
   <nav id="daily-archive-list" className="brief-archive-list" aria-label="按日期查看日报">
    {months.map(month=><section className="brief-month" key={month}>
     <h3>{month.slice(0,4)} 年 {Number(month.slice(5))} 月</h3>
     {published.filter((e:Edition)=>e.date.startsWith(month)).map((e:Edition)=><button key={e.date} className={`brief-archive-day ${date===e.date?'selected':''}`} aria-current={date===e.date?'date':undefined} onClick={()=>choose(e.date)}>
      <span className="brief-day-number">{e.date.slice(8)}<small>{weekday(e.date)}</small></span>
      <span className="brief-archive-title">{e.articles[0].title}</span>
     </button>)}
    </section>)}
    {!months.length&&<p className="brief-archive-none">暂无往期</p>}
   </nav>
  </aside>
  <section className="daily-newspaper" aria-label="AI 日报">
   <nav className="brief-navigation" aria-label="简报日期">
    <div className="brief-date-controls">
     <button disabled={!older} aria-label="上一期" onClick={()=>older&&choose(older.date)}><ChevronLeft size={18}/></button>
     <CalendarDays size={17} aria-hidden="true"/>
     <input type="date" aria-label="日历选择日报日期" value={date} max={editions[0]?.date} min={editions.at(-1)?.date} onChange={e=>e.target.value&&choose(e.target.value)}/>
     <button disabled={!newer} aria-label="下一期" onClick={()=>newer&&choose(newer.date)}><ChevronRight size={18}/></button>
    </div>
    {date!==latest&&<button className="brief-latest" onClick={()=>choose('')}>最新一期</button>}
    {issue?.updatedAt&&<time className="brief-updated" dateTime={issue.updatedAt}>{updateText(issue.updatedAt)}</time>}
   </nav>
   <header className="brief-masthead">
    <div><div className="brief-name">DayDay AI</div><h1>AI 日报</h1><div className="brief-edition-date">{date&&<time dateTime={date}>{formattedDate(date)}</time>}</div></div>
    {date&&<div className="brief-calendar-stamp" aria-hidden="true"><span>{Number(date.slice(5,7))} 月</span><strong>{date.slice(8)}</strong><small>{weekday(date)}</small></div>}
   </header>
   {articles.length?<>
    <div className={`brief-front-page ${articles.length===1?'single-story':''}`}>
     <BriefArticle article={articles[0]} lead/>
     {articles.length>1&&<section className="brief-highlights" aria-labelledby="daily-highlights-heading"><h2 id="daily-highlights-heading">今日看点</h2><ol>{articles.slice(1,4).map((article:Article,index:number)=><li key={article.id}><button onClick={()=>jumpTo(`daily-article-${index+1}`)}><span>{String(index+1).padStart(2,'0')}</span><strong>{article.title}</strong><ArrowDown size={15}/></button></li>)}</ol></section>}
    </div>
    {sections.length>0&&<nav className="brief-contents" aria-label="本期版面"><h2>本期版面</h2><div>{sections.map((section,index)=><button key={section.id} onClick={()=>jumpTo(`daily-section-${section.id}`)}><span className="brief-section-number">{String(index+1).padStart(2,'0')}</span><span>{section.label}</span><small>{section.articles.length} 件</small><ArrowDown size={14}/></button>)}</div></nav>}
    <div className="brief-sections">{sections.map((section,index)=><section key={section.id} id={`daily-section-${section.id}`} className="brief-category" tabIndex={-1} aria-labelledby={`daily-section-title-${section.id}`}><header><span>{String(index+1).padStart(2,'0')}</span><h2 id={`daily-section-title-${section.id}`}>{section.label}</h2></header>{section.articles.map(({article,index:articleIndex}:{article:Article;index:number})=><BriefArticle key={article.id} article={article} index={articleIndex}/>)}</section>)}</div>
    <div className="brief-end"><span>本期完</span></div>
   </>:<div className="brief-empty"><h2>{date===editions[0]?.date?'本期简报待更新':'这一天暂无简报'}</h2><p>可以从往期或日历选择其他日期。</p>{older&&<button onClick={()=>choose(older.date)}>阅读上一期 <ChevronRight size={15}/></button>}</div>}
   <nav className="brief-pagination" aria-label="翻阅日报"><button disabled={!older} onClick={()=>older&&choose(older.date)}><ChevronLeft size={17}/>上一期{older&&<span>{older.date.slice(5).replace('-','/')}</span>}</button><button disabled={!newer} onClick={()=>newer&&choose(newer.date)}>下一期{newer&&<span>{newer.date.slice(5).replace('-','/')}</span>}<ChevronRight size={17}/></button></nav>
  </section>
 </div>;
}

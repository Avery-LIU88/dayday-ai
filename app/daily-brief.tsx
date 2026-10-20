'use client';
import {useState} from 'react';
import {ChevronLeft,ChevronRight,ExternalLink} from 'lucide-react';
import type {NewsState} from '../lib/news-store';
import SourceMark from './source-mark';

const formattedDate=(date:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date(`${date}T12:00:00+08:00`));
const updateText=(iso:string)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));return `${p.month}/${p.day} ${p.hour}:${p.minute}更新`;};
type Edition=NewsState['daily'][number];
type Article=Edition['articles'][number];
function BriefArticle({article,lead=false,index=0}:{article:Article;lead?:boolean;index?:number}){
 return <article className={`brief-story ${lead?'brief-lead':''}`}>
  <div className="brief-story-label">{lead?'头条':String(index).padStart(2,'0')}<span>{article.topic}</span></div>
  <h2><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a></h2>
  {article.summary&&<p>{article.summary}</p>}
  <footer><a href={article.url} target="_blank" rel="noopener noreferrer" className="brief-original"><SourceMark publisher={article.publisher} name={article.source}/><span>原文</span><ExternalLink size={14}/></a></footer>
 </article>;
}
export default function DailyBrief({data}:{data:NewsState}){
 const editions=data.daily;
 const [chosen,setChosen]=useState('');
 const date=chosen||editions[0]?.date||'';
 const issue=editions.find((e:Edition)=>e.date===date);
 const older=editions.find((e:Edition)=>e.date<date);
 const newer=[...editions].reverse().find((e:Edition)=>e.date>date);
 const articles:Article[]=issue?.articles||[];
 const latest=editions[0]?.date;
 return <section className="daily-newspaper" aria-label="每日简报">
  <nav className="brief-navigation" aria-label="简报日期">
   <div className="brief-date-controls">
    <button disabled={!older} aria-label="上一期" onClick={()=>older&&setChosen(older.date)}><ChevronLeft size={18}/></button>
    <input type="date" aria-label="查看往期简报" value={date} max={latest} min={editions.at(-1)?.date} onChange={e=>e.target.value&&setChosen(e.target.value)}/>
    <button disabled={!newer} aria-label="下一期" onClick={()=>newer&&setChosen(newer.date)}><ChevronRight size={18}/></button>
   </div>
   {date!==latest&&<button className="brief-latest" onClick={()=>setChosen('')}>最新一期</button>}
   {issue?.updatedAt&&<time className="brief-updated" dateTime={issue.updatedAt}>{updateText(issue.updatedAt)}</time>}
  </nav>
  <header className="brief-masthead">
   <div className="brief-name">DayDay AI</div>
   <h1>每日简报</h1>
   <div className="brief-edition-date">{date&&<time dateTime={date}>{formattedDate(date)}</time>}</div>
  </header>
  {articles.length?<>
   <BriefArticle article={articles[0]} lead/>
   {articles.length>1&&<div className="brief-stories">{articles.slice(1).map((article:Article,index:number)=><BriefArticle key={article.id} article={article} index={index+1}/>)}</div>}
   <div className="brief-end"><span>本期完</span></div>
  </>:<div className="brief-empty"><h2>{date===latest?'今日简报待更新':'这一天暂无简报'}</h2><p>{date===latest?'有值得关注的大事时，会整理在这里。':'可以切换日期，阅读其他期简报。'}</p>{older&&<button onClick={()=>setChosen(older.date)}>阅读上一期 <ChevronRight size={15}/></button>}</div>}
 </section>;
}

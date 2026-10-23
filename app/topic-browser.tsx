'use client';
import {useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,Bookmark,ChevronRight,ExternalLink,Search} from 'lucide-react';
import type {NewsState} from '../lib/news-store';
import icons from '../data/source-icons.json';
import {buildTopicDirectory,companyContentTypes} from '../lib/topic-directory.mjs';
import SourceMark from './source-mark';
import {activityCategories,activityTime,activityState,activityEnd,activityOrder} from '../lib/activity-data.mjs';

type Story=NewsState['stories'][number];
type Card={id:string;name:string;publisher:string;kind:string;stories:Story[];match?:RegExp};
const manifest=icons as Record<string,{path:string}>;
const dateText=(iso:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
function BrandIcon({publisher}:{publisher:string}){
 const [failed,setFailed]=useState(false),src=manifest[publisher]?.path;
 return src&&!failed?<span className="topic-brand-icon"><img src={src} alt="" width={40} height={40} loading="lazy" onError={()=>setFailed(true)}/></span>:null;
}
export default function TopicBrowser({data,category,initialPublisher,saved,onSelect,onSave}:{data:NewsState;category:string;initialPublisher?:string;saved:Story[];onSelect:(s:Story)=>void;onSave:(s:Story)=>void}){
 const groups=useMemo<{category:string;cards:Card[]}[]>(()=>buildTopicDirectory(data.stories,data.sources,data.topics),[data]);
 const [selection,setSelection]=useState<{category:string;id:string}|null>(()=>initialPublisher?{
  category:category==='全部'?'公司动态':category,id:initialPublisher}:null);
 const [activityTab,setActivityTab]=useState('即将举行');
 const [search,setSearch]=useState(''),[kind,setKind]=useState('全部事件'),[limit,setLimit]=useState(25);
 const top=useRef<HTMLDivElement>(null);
 const group=selection?groups.find(g=>g.category===selection.category):null;
 const selected:Card|undefined=group?.cards.find((c:Card)=>c.id===selection?.id)
  ||(initialPublisher&&selection?groups.flatMap(g=>g.cards).find((c:Card)=>c.publisher===initialPublisher):undefined);
 const visible=groups.filter(g=>category==='全部'||g.category===category);
 const normalized=search.toLowerCase().trim();
 const eventBase:Story[]=selected?.stories||[];
 const isActivity=activityCategories.includes(selection?.category||category);
 const events:Story[]=eventBase.filter(s=>!isActivity||(s.activity&&(activityTab==='往期活动'?activityEnd(s.activity)<Date.now():activityEnd(s.activity)>=Date.now()))) .filter(s=>(kind==='全部事件'||companyContentTypes(s,selected,data.sources).includes(kind))
  &&`${s.title} ${s.summary}`.toLowerCase().includes(normalized))||[];
 if(isActivity)events.sort((a,b)=>activityTab==='往期活动'?activityOrder(b.activity)-activityOrder(a.activity):activityOrder(a.activity)-activityOrder(b.activity));
 function navigate(next:{category:string;id:string}|null){
  setSelection(next);setActivityTab('即将举行');setKind('全部事件');setSearch('');setLimit(25);
  top.current?.scrollIntoView({block:'start'});top.current?.focus({preventScroll:true});
 }
 return <div className="topic-browser" ref={top} tabIndex={-1}>
  {selected?<div className="topic-detail">
   <button className="topic-back" onClick={()=>navigate(null)}><ArrowLeft size={17}/>{selection?.category}</button>
   <header className="topic-detail-heading"><BrandIcon key={selected.publisher} publisher={selected.publisher}/><div><h2>{selected.name}</h2><span>{selected.stories.length} 条动态</span></div></header>
   <div className="topic-detail-tools">
    {isActivity&&<nav className="topic-kind-tabs" aria-label="活动时间">{['即将举行','往期活动'].map(value=><button key={value} aria-pressed={activityTab===value} className={activityTab===value?'selected':''} onClick={()=>{setActivityTab(value);setLimit(25);}}>{value}</button>)}</nav>}
    {selected.kind==='company'&&<nav className="topic-kind-tabs" aria-label="公司内容类型">{['全部事件','公司 Blog','技术报告','产品发布'].map(value=><button key={value} aria-pressed={kind===value} className={kind===value?'selected':''} onClick={()=>{setKind(value);setLimit(25);}}>{value}</button>)}</nav>}
    <label className="search topic-search"><Search size={17}/><input aria-label="搜索相关事件" placeholder="搜索事件" value={search} onChange={e=>{setSearch(e.target.value);setLimit(25);}}/></label>
   </div>
   <div className="topic-events">{events.slice(0,limit).map(story=><article className="topic-event" key={story.id}>
    <div className="topic-event-meta"><SourceMark publisher={story.links.find(l=>l.id===story.id)?.publisher||story.sourceId} name={story.source}/>{story.activity?<span>{activityState(story.activity)}</span>:<time dateTime={story.publishedAt}>{dateText(story.publishedAt)}</time>}</div>
    <button className="topic-event-title" onClick={()=>onSelect(story)}>{story.title}</button>
    {story.activity&&<div className="activity-facts"><strong>{activityTime(story.activity)}</strong>{story.activity.location&&<span>{story.activity.location}</span>}{story.activity.date&&story.activity.registrationDeadline&&<span>报名截止：{story.activity.registrationDeadline}</span>}{story.activity.note&&<span>{story.activity.note}</span>}</div>}
    {story.summary&&<p>{story.summary}</p>}
    <div className="topic-event-actions"><button aria-pressed={saved.some(s=>s.id===story.id)} onClick={()=>onSave(story)}><Bookmark size={15}/>{saved.some(s=>s.id===story.id)?'已收藏':'收藏'}</button><a href={story.activity?.originalUrl||story.activity?.url||story.url} target="_blank" rel="noopener noreferrer">{story.activity?'活动原页':'原文'}<ExternalLink size={14}/></a></div>
   </article>)}</div>
   {!events.length&&<div className="empty"><h3>{isActivity?'暂无'+activityTab:'暂无相关动态'}</h3>{(kind!=='全部事件'||search)&&<button className="secondary" onClick={()=>{setKind('全部事件');setSearch('');}}>清除筛选</button>}</div>}
   {events.length>limit&&<button className="more" onClick={()=>setLimit(limit+25)}>加载更多（剩余 {events.length-limit} 条）</button>}
  </div>:<>
   <div className="topic-directory-tools"><label className="search topic-search"><Search size={17}/><input aria-label="搜索公司或来源" placeholder="搜索公司、模型或来源" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
   {visible.map(g=>{
    const cards=g.cards.map(card=>activityCategories.includes(g.category)?{...card,stories:[...card.stories].sort((a,b)=>{const af=!!a.activity&&activityEnd(a.activity)>=Date.now(),bf=!!b.activity&&activityEnd(b.activity)>=Date.now();return Number(bf)-Number(af)||(af&&bf?activityOrder(a.activity)-activityOrder(b.activity):0);})}:card).filter((c:Card)=>`${c.name} ${c.publisher}`.toLowerCase().includes(normalized));
    if(!cards.length)return null;
    return <section className="topic-group" key={g.category} aria-label={g.category}>
     <h2>{g.category}</h2>
     <div className="topic-grid">{cards.map((card:Card)=><button className="topic-card" key={card.id} onClick={()=>navigate({category:g.category,id:card.id})}>
      <div className="topic-card-heading"><BrandIcon publisher={card.publisher}/><h3>{card.name}</h3><ArrowUpRight size={17}/></div>
      <p className={card.stories.length?'':'topic-card-empty'}>{card.stories[0]?.title||'暂无动态'}</p>
      <footer>{card.stories[0]?<time dateTime={card.stories[0].publishedAt}>{card.stories[0].activity?activityState(card.stories[0].activity)+' · '+(card.stories[0].activity.date||'提交截止 '+card.stories[0].activity.registrationDeadline):dateText(card.stories[0].publishedAt)}</time>:<span/>}<span>{card.stories.length} 条<ChevronRight size={14}/></span></footer>
     </button>)}</div>
    </section>;
   })}
   {!visible.some(g=>g.cards.some((c:Card)=>`${c.name} ${c.publisher}`.toLowerCase().includes(normalized)))&&<div className="empty"><h3>{search?'没有找到相关主题':'暂无相关动态'}</h3></div>}
  </>}
 </div>;
}

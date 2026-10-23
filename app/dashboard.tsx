'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Satellite,Newspaper,BookOpen,CalendarDays,Layers,Bookmark,Radio,Bell,Trophy,Plug,Info,MessageSquare,Search,ExternalLink,X,Menu,ChevronRight,RefreshCw,ArrowRight,Sun,Moon} from 'lucide-react';
import type {NewsState} from '../lib/news-store';
import SubscriptionPanel from './subscription-panel';
import SourceMark from './source-mark';
import DailyBrief from './daily-brief';
import TopicBrowser from './topic-browser';
import ModelLeaderboard from './model-leaderboard';
import AboutPanel from './about-panel';
import FeedbackPanel from './feedback-panel';
import DistributionPanel from './distribution-panel';
import TodayHot,{EventScore} from './today-hot';
type Story=NewsState['stories'][number];
type View='news'|'daily'|'weekly'|'topics'|'saved'|'following'|'settings'|'ranking'|'agent'|'about'|'feedback';
const groups=[{label:'资讯阅读',items:[['news','今日热点',Newspaper],['daily','每日简报',BookOpen],['weekly','周报',CalendarDays],['topics','主题',Layers],['saved','收藏',Bookmark]]},{label:'节目订阅',items:[['following','我的关注',Radio],['settings','提醒设置',Bell]]},{label:'模型',items:[['ranking','模型榜单',Trophy]]},{label:'更多',items:[['agent','Agent 接入',Plug],['about','关于',Info],['feedback','反馈',MessageSquare]]}] as const;
const labels=Object.fromEntries(groups.flatMap(g=>g.items.map(([id,label])=>[id,label])));
const dateText=(iso:string)=>new Date(iso).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const updateText=(iso:string)=>{const date=new Date(iso);if(!Number.isFinite(date.getTime()))return '暂无更新时间';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}更新`;};
function sourceStatus(source:NewsState['sources'][number],data:NewsState){const check=data.health.find(h=>h.id===source.id);if(source.adapter==='directory')return '待接入';if(!check)return '待核验';if(!check.ok)return '更新异常';if(Date.now()-Date.parse(check.checkedAt)>48*3600000)return '待刷新';return check.count===0?'已接通 · 暂无相关内容':'已接通';}
function loadSaved():Story[]{try{const raw=JSON.parse(localStorage.getItem('dayday-bookmarks-v1')||'[]');return Array.isArray(raw)?raw.filter(s=>s&&typeof s.id==='string'&&typeof s.title==='string'&&/^https?:\/\//.test(s.url)):[];}catch{return [];}}
export default function Dashboard({initial}:{initial:NewsState}){
 const [data,setData]=useState(initial),[view,setView]=useState<View>('news'),[topic,setTopic]=useState('全部'),[query,setQuery]=useState(''),[source,setSource]=useState('all'),[language,setLanguage]=useState('all'),[subtype,setSubtype]=useState('全部类型'),[sort,setSort]=useState('score'),[limit,setLimit]=useState(25),[saved,setSaved]=useState<Story[]>([]),[selected,setSelected]=useState<Story|null>(null),[showSources,setShowSources]=useState(false),[mobile,setMobile]=useState(false),[dark,setDark]=useState(false),[notice,setNotice]=useState(''),[refreshing,setRefreshing]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),lastPage=useRef<View>('news');
 const [editionDate,setEditionDate]=useState('');
 useEffect(()=>{if(view!=='feedback')lastPage.current=view;},[view]);
 useEffect(()=>{setSaved(loadSaved());const onStorage=()=>setSaved(loadSaved());const onHash=()=>{const [hash,params]=location.hash.slice(1).split('?');if(hash in labels)setView(hash as View);const date=new URLSearchParams(params).get('date')||'';setEditionDate(/^\d{4}-\d{2}-\d{2}$/.test(date)?date:'');};onHash();setDark(localStorage.getItem('dayday-theme')==='dark');window.addEventListener('hashchange',onHash);window.addEventListener('storage',onStorage);return()=>{window.removeEventListener('hashchange',onHash);window.removeEventListener('storage',onStorage);};},[]);
 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';},[dark]);
 useEffect(()=>{if(selected)dialog.current?.showModal();else dialog.current?.close();},[selected]);
 useEffect(()=>{if(!notice)return;const id=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(id);},[notice]);
 useEffect(()=>{setLimit(25);},[query,source,language,topic,view,subtype]);
 async function refresh(){setRefreshing(true);try{const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error();setData(await r.json());setNotice('已读取最新内容');}catch{setNotice('暂时无法刷新，仍可阅读已加载内容');}finally{setRefreshing(false);}}
 function go(next:View){setView(next);setSort(next==='topics'?'time':'score');location.hash=next;setQuery('');setSource('all');setLanguage('all');setSubtype('全部类型');setShowSources(false);setMobile(false);setSelected(null);setLimit(25);window.scrollTo({top:0});}
 function toggleSave(story:Story){const next=saved.some(s=>s.id===story.id)?saved.filter(s=>s.id!==story.id):[story,...saved];try{localStorage.setItem('dayday-bookmarks-v1',JSON.stringify(next));setSaved(next);}catch{setNotice('浏览器存储不可用，收藏未保存');}}
 const relevantSources=useMemo(()=>data.sources.filter(s=>s.scope!=='截图栏目'&&(view!=='topics'||topic==='全部'||s.section===topic||data.stories.some(e=>e.tags.includes(topic)&&e.links.some(l=>l.sourceId===s.id)))),[data,view,topic]);
 const sourceGroups=[...new Map(relevantSources.map(s=>[s.publisher,{id:s.publisher,name:data.sources.find(x=>x.id===s.publisher)?.name||s.name}])).values()];
 const filtered=useMemo(()=>{return (view==='saved'?saved:data.stories).filter(s=>{
 if(view==='topics'&&topic!=='全部'&&!s.tags.includes(topic))return false;
 if(source!=='all'&&!s.links.some(l=>l.sourceId===source||data.sources.find(x=>x.id===l.sourceId)?.publisher===source))return false;
 if(language!=='all'&&s.language!==language)return false;
 if(subtype!=='全部类型'&&!s.tags.includes(subtype))return false;
 return `${s.title} ${s.summary} ${s.source} ${s.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase().trim());
 }).sort((a,b)=>sort==='time'?b.publishedAt.localeCompare(a.publishedAt):b.score-a.score||b.publishedAt.localeCompare(a.publishedAt));},[data,saved,view,topic,source,language,subtype,query,sort]);
 const isReading=['news','daily','weekly','topics','saved'].includes(view);
 function sourceRows(){return <div className="source-list">{relevantSources.filter(s=>`${s.name} ${s.section}`.toLowerCase().includes(query.toLowerCase())).map(s=>{const h=data.health.find(x=>x.id===s.id),status=sourceStatus(s,data);return <div className="source-row" key={s.id}><div><strong>{s.name}</strong><span>{s.section} · {status}{h?.checkedAt?` · ${dateText(h.checkedAt)} 检查`:''}</span>{h?.lastSuccessAt&&<span>最近成功 {dateText(h.lastSuccessAt)}</span>}{status==='更新异常'&&<p>{h?.error||'更新失败'}；保留上次内容。</p>}{s.adapter==='directory'&&<p>{s.notice||(h?.error?.startsWith('HTTP')?'原站限制访问，自动更新尚未接通':'尚未找到带有有效日期的自动更新入口')}</p>}</div><div className="source-buttons">{data.stories.some(e=>e.links.some(l=>l.sourceId===s.id))&&<button onClick={()=>{if(view==='news'){go('topics');setTopic('全部');}setSource(s.publisher);setQuery('');setShowSources(false);}}>查看内容</button>}{s.website&&<a href={s.website} target="_blank" rel="noopener noreferrer">原站 <ExternalLink size={14}/></a>}</div></div>;})}</div>;}
 return <>
 {mobile&&<button className="nav-backdrop" aria-label="关闭导航" onClick={()=>setMobile(false)}/>}
 <aside className={`sidebar ${mobile?'open':''}`}><a className="brand" href="#news" onClick={()=>go('news')}><span className="brand-icon"><Satellite size={26}/></span><span>DayDay AI</span></a><div className="navigation">{groups.map(g=><section className="nav-group" key={g.label}><p className="group-label">{g.label}</p><nav aria-label={g.label}>{g.items.map(([id,label,Icon])=><button className={`nav ${view===id?'active':''}`} aria-current={view===id?'page':undefined} key={id} onClick={()=>go(id)}><Icon size={20}/><span>{label}</span></button>)}</nav></section>)}</div><footer className="sidebar-footer"><p>每天一点，跟上 AI。</p><button onClick={()=>{setDark(!dark);try{localStorage.setItem('dayday-theme',!dark?'dark':'light');}catch{}}}>{dark?<Moon size={16}/>:<Sun size={16}/>} {dark?'深色模式':'浅色模式'}</button></footer></aside>
 <div className="main"><header className="mobile-header"><button aria-label="打开导航" onClick={()=>setMobile(true)}><Menu/></button><strong>DayDay AI</strong></header><main className={`page view-${view}`}>
 {view!=='daily'&&view!=='weekly'&&view!=='ranking'&&<div className="heading"><h1>{view==='feedback'?'说说你的想法':labels[view]}</h1><div className="heading-actions">{view==='news'?<time className="news-updated-at" dateTime={data.collectedAt}>{updateText(data.collectedAt)}</time>:isReading&&view!=='topics'&&<><button className="text-button" onClick={()=>setShowSources(!showSources)}>{showSources?'返回资讯':'信息源'}</button><button className="icon-button" aria-label="刷新资讯" disabled={refreshing} onClick={refresh}><RefreshCw size={18} className={refreshing?'spinning':''}/></button></>}</div></div>}
 {view==='news'&&<p className="positioning">过去24小时，值得你知道的 AI 大事</p>}
 {view==='topics'&&<nav className="category-tabs" aria-label="主题分类">{['全部',...data.topics].map(t=><button key={t} className={topic===t?'selected':''} onClick={()=>{setTopic(t);setSource('all');setSubtype('全部类型');setShowSources(false);}}>{t}</button>)}</nav>}
 {isReading&&<>
 {view==='daily'||view==='weekly'?<DailyBrief key={`${view}:${editionDate}`} data={data} period={view} initialDate={editionDate}/>:showSources&&view!=='news'?<><div className="filter-row"><label className="search"><Search size={18}/><input aria-label="搜索信息源" placeholder="搜索信息源" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>{sourceRows()}</>:view==='topics'?<TopicBrowser key={`${topic}:${source}`} data={data} category={topic} initialPublisher={source==='all'?undefined:source} saved={saved} onSelect={setSelected} onSave={toggleSave}/>:view==='news'?<TodayHot data={data} saved={saved} onSelect={setSelected} onSave={toggleSave}/>:<>
 <div className="reading-layout"><section className="feed">
 <div className="filter-row"><label className="search"><Search size={18}/><input type="search" aria-label="搜索资讯" placeholder="搜索资讯" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="筛选来源" value={source} onChange={e=>setSource(e.target.value)}><option value="all">全部来源</option>{sourceGroups.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select><select aria-label="筛选语言" value={language} onChange={e=>setLanguage(e.target.value)}><option value="all">全部语言</option><option value="zh">中文</option><option value="en">英文</option></select><select aria-label="排序方式" value={sort} onChange={e=>setSort(e.target.value)}><option value="score">重要优先</option><option value="time">时间优先</option></select></div>
 {filtered.length===0?<div className="empty"><h2>{view==='saved'?'还没有收藏':'暂无匹配内容'}</h2><p>{view==='saved'?'在资讯卡片上点击收藏，即可保存在当前浏览器。':'可以调整日期或筛选条件，也可以查看信息源接入状态。'}</p>{view!=='saved'&&<button className="secondary" onClick={()=>{setQuery('');setShowSources(true);}}>查看信息源</button>}</div>:filtered.slice(0,limit).map(s=><article className="article" key={s.id}><div className="meta"><span>{s.source}</span><span>{dateText(s.publishedAt)}{s.dateLabel!=='发布'?` ${s.dateLabel}`:''}</span>{s.coverage>1&&<span>{s.coverage} 个来源</span>}</div><button className="article-title" onClick={()=>setSelected(s)}>{s.title}</button>{s.summary&&<p className="summary">{s.summary}</p>}<footer className="article-footer"><span className="article-topic">{s.topic}</span><div className="actions"><button className={saved.some(x=>x.id===s.id)?'saved':''} aria-pressed={saved.some(x=>x.id===s.id)} onClick={()=>toggleSave(s)}><Bookmark size={16}/>{saved.some(x=>x.id===s.id)?'已收藏':'收藏'}</button><a href={s.url} target="_blank" rel="noopener noreferrer">原文 <ExternalLink size={15}/></a></div></footer></article>)}
 {filtered.length>limit&&<button className="more" onClick={()=>setLimit(limit+25)}>加载更多（剩余 {filtered.length-limit} 条）</button>}
 </section></div>
 </>}
 {view!=='news'&&view!=='daily'&&view!=='weekly'&&view!=='topics'&&view!=='ranking'&&<footer className="page-footer"><span>最近采集 {dateText(data.collectedAt)}</span><span>{data.pipeline.mode}</span></footer>}
 </>}
 {view==='about'&&<AboutPanel data={data} onBrowse={()=>go('news')} onSources={()=>{go('topics');setShowSources(true);}}/>}
 {(view==='following'||view==='settings')&&<SubscriptionPanel view={view}/>}
 {view==='ranking'&&<ModelLeaderboard/>}
 {view==='agent'&&<DistributionPanel/>}
 {view==='feedback'&&<FeedbackPanel from={lastPage.current} onHome={()=>go('news')}/>}
 </main></div>
 <dialog ref={dialog} onCancel={()=>setSelected(null)} onClick={e=>{if(e.target===dialog.current)setSelected(null);}} aria-labelledby="detail-title"><button className="dialog-close" aria-label="关闭详情" onClick={()=>setSelected(null)}><X/></button>{selected&&<><div className="meta">{selected.source} · {dateText(selected.publishedAt)}</div><h2 id="detail-title">{selected.title}</h2><p className="detail-summary">{selected.summary||'此来源未提供公开摘要，请打开原文阅读。'}</p>{selected.scoreVersion>=2?<><p className="detail-why"><strong>为什么关注</strong>{selected.why}</p><EventScore story={selected}/></>:<div className="score-box"><h3>热度趋势</h3><p>此历史收藏暂无趋势记录。</p></div>}{selected.bullets?.length&&<ul>{selected.bullets.map((point,i)=><li key={i}>{point}</li>)}</ul>}<h3>来源与原文</h3><ul className="original-links">{selected.links.map(l=><li key={`${l.sourceId}:${l.url}`}><a href={l.url} target="_blank" rel="noopener noreferrer"><SourceMark publisher={l.publisher||l.sourceId} name={l.source}/> <ExternalLink size={14}/></a></li>)}</ul><div className="dialog-actions"><button className="secondary" onClick={()=>toggleSave(selected)}><Bookmark size={16}/>{saved.some(s=>s.id===selected.id)?'取消收藏':'收藏'}</button><a className="primary" href={selected.url} target="_blank" rel="noopener noreferrer">阅读原文 <ChevronRight size={17}/></a></div></>}</dialog>
 {notice&&<div className="toast" role="status">{notice}</div>}
 </>;
}

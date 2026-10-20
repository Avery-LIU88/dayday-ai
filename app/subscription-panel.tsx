'use client';
import {useEffect,useState} from 'react';
import {ExternalLink,RefreshCw,Plus,Check,Download} from 'lucide-react';
import type {Entry} from '../lib/types';
type Show={id:string;name:string;website:string;platform:string;checkedAt?:string;error?:string;mode?:string};
type Preferences={enabled:boolean;episodes:boolean;daily:boolean;weekly:boolean;time:string;quiet:boolean};
type State={shows:Show[];episodes:Entry[];preferences:Preferences;connected:boolean;deliveries:{id:string;kind:string;status:string;createdAt:string;message:string}[];job:{checkedAt:string;phase:string}|null};
const defaults:Preferences={enabled:false,episodes:true,daily:false,weekly:false,time:'08:00',quiet:true};
const date=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
function browserKey(){
 let key=localStorage.getItem('dayday-reader-key-v1');
 if(!/^[a-f0-9]{64}$/.test(key||'')){key=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem('dayday-reader-key-v1',key);}
 return key!;
}
export default function SubscriptionPanel({view}:{view:'following'|'settings'}){
 const [state,setState]=useState<State|null>(null),[prefs,setPrefs]=useState(defaults),[url,setUrl]=useState(''),[candidate,setCandidate]=useState<{show:Show;episodes:Entry[]}|null>(null),[busy,setBusy]=useState(''),[message,setMessage]=useState(''),[webhook,setWebhook]=useState(''),[secret,setSecret]=useState(''),[kind,setKind]=useState('daily'),[preview,setPreview]=useState(''),[selected,setSelected]=useState('all'),[loading,setLoading]=useState(true);
 async function load(){try{const r=await fetch('/api/subscriptions',{headers:{Authorization:'Bearer '+browserKey()},cache:'no-store'});const s=await r.json() as State & {error?:string};if(!r.ok)throw Error(s.error);setState(s);setPrefs(s.preferences);}catch(e){setMessage(e instanceof Error?e.message:'读取失败');}finally{setLoading(false);}}
 useEffect(()=>{load();},[]);
 async function action<T={message:string;cached?:boolean;text?:string}>(name:string,body:Record<string,unknown>={}){
  setBusy(name);setMessage('');
  try{const r=await fetch('/api/subscriptions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+browserKey()},body:JSON.stringify({action:name,...body})});const value=await r.json() as {error?:string;state:State;result:T};if(!r.ok)throw Error(value.error||'操作失败');setState(value.state);setPrefs(value.state.preferences);return value.result;}
  catch(e){setMessage(e instanceof Error?e.message:'操作失败，请重试');throw e;}finally{setBusy('');}
 }
 async function identify(){try{const result=await action<{show:Show;episodes:Entry[]}>('resolve',{url});setCandidate(result);}catch{setCandidate(null);}}
 async function confirmFollow(){if(!candidate)return;try{await action('follow',{showId:candidate.show.id,active:true,mode:'instant'});setCandidate(null);setUrl('');setMessage('已关注；开启提醒后，只通知后续的新内容');}catch{}}
 async function updateFollow(s:Show,active:boolean,mode=s.mode){try{await action('follow',{showId:s.id,active,mode});if(!active&&selected===s.id)setSelected('all');}catch{}}
 async function saveSettings(){try{await action('preferences',{preferences:prefs});setMessage(prefs.enabled?'提醒已开启':'设置已保存，提醒已暂停');}catch{}}
 async function connect(){try{await action('connect',{webhook:webhook.trim(),secret:secret.trim()});setWebhook('');setSecret('');setMessage('机器人已保存，可以发送连接测试');}catch{}}
 async function send(type:string){try{const r=await action('send',{kind:type});setMessage(r.message);}catch{}}
 async function showPreview(){try{const r=await action('preview',{kind});setPreview(r.text||'当前没有符合条件的内容');}catch{}}
 function download(){const blob=new Blob([preview],{type:'text/plain;charset=utf-8'}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=`DayDay-AI-${kind}.txt`;a.click();URL.revokeObjectURL(href);}
 if(loading)return <p role="status">正在读取…</p>;
 return <div className="subscriptions">
 {message&&<p className="subscription-message" role="status">{message}</p>}
 {!state?<button className="secondary" onClick={load}>重新读取</button>:view==='following'?<>
 <form className="follow-form" onSubmit={e=>{e.preventDefault();identify();}}><label className="sr-only" htmlFor="show-link">节目主页或 RSS 链接</label><input id="show-link" type="url" required maxLength={1800} placeholder="粘贴 Apple Podcasts、YouTube 频道或 RSS 链接" value={url} onChange={e=>{setUrl(e.target.value);setCandidate(null);}}/><button className="primary" disabled={!!busy||!url.trim()} type="submit"><Plus size={17}/>{busy==='resolve'?'识别中…':'添加关注'}</button></form>
 {candidate&&<section className="subscription-box candidate"><div><h2>{candidate.show.name}</h2><p>{candidate.show.platform} · 预览 {candidate.episodes.length} 条最新内容</p>{candidate.episodes[0]&&<p>{candidate.episodes[0].title}</p>}</div><div className="subscription-actions"><button className="secondary" onClick={()=>setCandidate(null)}>取消</button><button className="primary" disabled={!!busy} onClick={confirmFollow}><Check size={16}/>确认关注</button></div></section>}
 {state.shows.length===0?<div className="empty bordered"><h2>关注你想及时看到的节目</h2><p>粘贴节目链接，更新后从这里前往原平台观看或收听。</p></div>:<>
 <div className="follow-grid">{state.shows.map(s=><section className="subscription-box show-card" key={s.id}><h2>{s.name}</h2><p className="show-meta">{s.platform}{s.checkedAt?` · ${date(s.checkedAt)} 检查`:''}</p>{s.error&&<p className="subscription-error">{s.error}；保留已有节目。</p>}<label>更新提醒 <select aria-label={`${s.name}提醒方式`} value={s.mode} disabled={!!busy} onChange={e=>updateFollow(s,true,e.target.value)}><option value="instant">发现更新时</option><option value="digest">每日汇总</option><option value="off">不提醒</option></select></label><div className="subscription-actions"><a href={s.website} target="_blank" rel="noopener noreferrer">节目主页 <ExternalLink size={14}/></a><button aria-label={`检查${s.name}更新`} disabled={!!busy} onClick={async()=>{try{const r=await action('refresh',{showId:s.id});setMessage(r.cached?'刚刚检查过，请稍后再试':'检查完成');}catch{}}}><RefreshCw size={15}/></button><button disabled={!!busy} onClick={()=>updateFollow(s,false)}>取消关注</button></div></section>)}</div>
 <div className="section-heading episode-heading"><h2>节目更新</h2><select aria-label="筛选关注节目" value={selected} onChange={e=>setSelected(e.target.value)}><option value="all">全部节目</option>{state.shows.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
 {state.episodes.filter(e=>selected==='all'||e.sourceId===selected).map(e=><article className="article" key={e.id}><div className="meta">{e.source} · {date(e.publishedAt)}{e.duration?` · ${e.duration} 分钟`:''}</div><a className="article-title" href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a>{e.summary&&<p className="summary">{e.summary}</p>}<footer className="article-footer"><span/><a className="text-button" href={e.url} target="_blank" rel="noopener noreferrer">前往原平台 <ExternalLink size={15}/></a></footer></article>)}
 </>}
 </>:<>
 <section className="subscription-box"><div className="section-heading"><h2>飞书机器人</h2><span>{state.connected?'已连接':'未连接'}</span></div>
 {!state.connected||webhook?<form onSubmit={e=>{e.preventDefault();connect();}} className="bot-form"><label>Webhook<input type="password" autoComplete="off" required placeholder="飞书群 → 群机器人 → 自定义机器人" value={webhook} onChange={e=>setWebhook(e.target.value)}/></label><label>签名密钥（选填）<input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} placeholder="机器人启用了签名校验时填写"/></label><button className="primary" disabled={!!busy}>连接机器人</button></form>:<div className="subscription-actions"><button className="secondary" disabled={!!busy} onClick={()=>send('test')}>发送连接测试</button><button className="text-button" disabled={!!busy} onClick={async()=>{try{await action('disconnect');setMessage('已断开，提醒已暂停');}catch{}}}>断开连接</button></div>}
 </section>
 <section className="subscription-box"><h2>提醒设置</h2><div className="reminder-fields">
 <label className="check-row"><input type="checkbox" checked={prefs.enabled} onChange={e=>setPrefs({...prefs,enabled:e.target.checked})}/>开启飞书提醒</label>
 <label className="check-row"><input type="checkbox" checked={prefs.episodes} onChange={e=>setPrefs({...prefs,episodes:e.target.checked})}/>关注节目更新</label>
 <label className="check-row"><input type="checkbox" checked={prefs.daily} onChange={e=>setPrefs({...prefs,daily:e.target.checked})}/>每日 AI 简报</label>
 <label className="check-row"><input type="checkbox" checked={prefs.weekly} onChange={e=>setPrefs({...prefs,weekly:e.target.checked})}/>每周一 AI 周报</label>
 <label>汇总及简报时间（北京时间） <input type="time" value={prefs.time} onChange={e=>setPrefs({...prefs,time:e.target.value})}/></label>
 <label className="check-row"><input type="checkbox" checked={prefs.quiet} onChange={e=>setPrefs({...prefs,quiet:e.target.checked})}/>22:00–08:00 免打扰</label>
 </div><button className="primary" disabled={!!busy} onClick={saveSettings}>保存设置</button><p className="subscription-help">节目提醒在后台检查发现更新后发送。{state.job?`最近任务：${date(state.job.checkedAt)} · ${state.job.phase}`:'后台任务尚未运行。'}</p></section>
 <section className="subscription-box"><h2>内容分发</h2><div className="subscription-actions"><select aria-label="分发内容" value={kind} onChange={e=>{setKind(e.target.value);setPreview('');}}><option value="daily">每日 AI 简报</option><option value="weekly">AI 周报</option><option value="episodes">关注节目合集</option></select><button className="secondary" disabled={!!busy} onClick={showPreview}>预览</button></div>{preview&&<><pre className="message-preview">{preview}</pre><div className="subscription-actions"><button className="secondary" onClick={download}><Download size={16}/>下载文本</button><button className="primary" disabled={!!busy||!state.connected||preview==='当前没有符合条件的内容'} onClick={()=>send(kind)}>发送到飞书</button></div></>}</section>
 {state.deliveries.length>0&&<section className="subscription-box"><h2>发送记录</h2>{state.deliveries.map(d=><div className="delivery-row" key={d.id}><span>{date(d.createdAt)} · {({test:'连接测试',daily:'每日简报',weekly:'周报',episodes:'节目更新',system:'任务'} as Record<string,string>)[d.kind]||d.kind}</span><strong>{({sent:'已发送',failed:'失败',unknown:'待核对',sending:'等待回执',processed:'已处理'} as Record<string,string>)[d.status]||d.status}</strong><p>{d.message}</p></div>)}</section>}
 </>}
 <p className="subscription-help">无需注册，关注和提醒设置归当前浏览器管理。</p>
 </div>;
}

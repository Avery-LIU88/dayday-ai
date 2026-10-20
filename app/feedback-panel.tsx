'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Check,LoaderCircle,Send,ArrowRight} from 'lucide-react';
const DRAFT_KEY='dayday-feedback-draft-v1';
type Draft={content:string;email:string};
export default function FeedbackPanel({from,onHome}:{from:string;onHome:()=>void}){
 const [draft,setDraft]=useState<Draft>({content:'',email:''}),[status,setStatus]=useState<'idle'|'sending'|'error'|'done'>('idle'),[message,setMessage]=useState(''),[receipt,setReceipt]=useState<number|null>(null);
 const requestKey=useRef<string|null>(null),successRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{try{const d=JSON.parse(sessionStorage.getItem(DRAFT_KEY)||'null');if(d&&typeof d.content==='string'&&typeof d.email==='string')setDraft({content:d.content.slice(0,2000),email:d.email.slice(0,254)});}catch{}},[]);
 useEffect(()=>{if(status==='done')successRef.current?.focus();},[status]);
 function edit(name:keyof Draft,value:string){requestKey.current=null;if(status==='error'){setStatus('idle');setMessage('');}const next={...draft,[name]:value};setDraft(next);try{sessionStorage.setItem(DRAFT_KEY,JSON.stringify(next));}catch{}}
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(status==='sending')return;
  if(draft.content.trim().length<2){setStatus('error');setMessage('请写下反馈内容。');return;}
  setStatus('sending');setMessage('');
  try{
   requestKey.current||=crypto.randomUUID();const form=new FormData();form.set('content',draft.content);form.set('email',draft.email);form.set('submissionKey',requestKey.current);form.set('website',String(new FormData(e.currentTarget).get('website')||''));form.set('pageUrl',`${location.origin}${location.pathname}#${from}`);
   const response=await fetch('/api/feedback',{method:'POST',body:form}),body=await response.json() as {id?:number;error?:string};
   if(!response.ok)throw Error(body.error||'暂时未能发送，请稍后重试。');
   if(typeof body.id!=='number'||!Number.isInteger(body.id)||body.id<1)throw Error('未收到确认，请重试。');
   setReceipt(body.id);setStatus('done');setDraft({content:'',email:''});requestKey.current=null;try{sessionStorage.removeItem(DRAFT_KEY);}catch{}
  }catch(error){setStatus('error');setMessage(error instanceof Error?error.message:'网络暂时无法连接，内容仍保留在表单中。');}
 }
 if(status==='done')return <div className="feedback-success" ref={successRef} tabIndex={-1} role="status"><span className="feedback-success-icon"><Check size={30}/></span><h2>收到了，谢谢你</h2><p>反馈编号 <strong>#{String(receipt).padStart(6,'0')}</strong></p><div><button className="primary" onClick={onHome}>浏览今日热点 <ArrowRight size={16}/></button><button className="text-button" onClick={()=>{setStatus('idle');setReceipt(null);}}>再写一条</button></div></div>;
 return <div className="feedback-panel"><p className="feedback-lead">遇到的问题、希望增加的内容，或任何建议，都可以告诉我们。</p><form onSubmit={submit} className="feedback-form"><fieldset disabled={status==='sending'}>
  <div className="feedback-field"><label htmlFor="fb-content">想说点什么？</label><div className="feedback-textarea"><textarea id="fb-content" required minLength={2} maxLength={2000} rows={8} value={draft.content} onChange={e=>edit('content',e.target.value)} placeholder="比如：某条资讯的来源有误，或希望增加一个信息源……"/><span>{draft.content.length} / 2000</span></div></div>
  <div className="feedback-field"><label htmlFor="fb-email">邮箱 <span>（选填）</span></label><input id="fb-email" type="email" autoComplete="email" maxLength={254} value={draft.email} onChange={e=>edit('email',e.target.value)} placeholder="方便我们与你联系"/></div>
  <div className="feedback-honeypot" aria-hidden="true"><label htmlFor="fb-website">公司网址</label><input id="fb-website" name="website" tabIndex={-1} autoComplete="off"/></div>
  {status==='error'&&<p className="feedback-error" role="alert">{message}</p>}</fieldset><footer><span>提交的信息仅用于处理反馈。</span><button className="primary" type="submit" disabled={status==='sending'||draft.content.trim().length<2}>{status==='sending'?<LoaderCircle size={17} className="spinning"/>:<Send size={17}/>} {status==='sending'?'发送中…':'发送反馈'}</button></footer></form></div>;
}

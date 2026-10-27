import {plain} from './feed.mjs';
import {activityEnd,activityOrder,activityTime,activityNoticeId} from './activity-data.mjs';
import {deliveryPolicy} from '../config/delivery.mjs';
const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const flat=value=>String(value||'').replace(/[\r\n]+/g,' ').trim();
export const deliveryLabels={activities:'活动提醒',episodes:'我的关注更新',hot:'今日热点'};
export function validateActivity(value,input){
 if(!value||!input)return null;
 const {date,evidence,location=''}=value;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)return null;
 const text=flat(input.title+' '+input.excerpt),quote=flat(evidence);
 if(!quote||quote.length>240||!text.includes(quote)||flat(location).length>100||(location&&!text.includes(flat(location))))return null;
 const [y,m,d]=date.split('-').map(Number),month=['January','February','March','April','May','June','July','August','September','October','November','December'][m-1];
 const forms=[`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,`${y}/${m}/${d}`,`${y}年${m}月${d}日`];
 const english=new RegExp(`(?:${month}|${month.slice(0,3)})\\.?\\s+${d}(?:st|nd|rd|th)?(?:,|\\s)+\\s*${y}|${d}\\s+(?:${month}|${month.slice(0,3)})\\.?\\s+${y}`,'i');
 if(!forms.some(x=>quote.includes(x))&&!english.test(quote))return null;
 // The original article is the action link. Never invent registration URLs.
 const url=safeUrl(input.url);if(!url)return null;
 return {date,location:flat(location),evidence:quote,url};
}
export function upcomingActivities(stories,at=Date.now()){
 return stories.filter(s=>s.activity&&s.activity.status!=='cancelled'&&(s.activityListing||s.priority?.quality?.newFact)&&!s.priority?.quality?.uncertain&&!s.priority?.quality?.insufficientEvidence&&activityEnd(s.activity)>=at).sort((a,b)=>activityOrder(a.activity)-activityOrder(b.activity)||a.id.localeCompare(b.id));
}
export function deliveryItems(publication,episodes=[]){
 return {activities:publication?.activities||[],episodes,hot:publication?.hot||[]};
}
export function itemText(item,kind){
 const lines=[flat(item.title)];
 if(kind==='activities'){lines.push(activityTime(item.activity),...(item.activity.status==='tentative'?['日期暂定，以主办方公告为准']:[]),...(item.activity.location?[`地点／平台：${flat(item.activity.location)}`]:[]));if(item.activity.date&&item.activity.registrationDeadline)lines.push('报名截止：'+item.activity.registrationDeadline);}
 else if(kind==='episodes')lines.push(flat(item.source),`发布：${new Date(item.publishedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`);
 if(kind!=='episodes'&&item.takeaway)lines.push(flat(item.takeaway));
 if(kind==='hot'&&item.why)lines.push('值得关注：'+flat(item.why));
 if(kind!=='episodes'&&item.source)lines.push('来源：'+flat(item.source));
 lines.push(safeUrl(kind==='activities'?item.activity.originalUrl||item.activity.url:item.url));
 return lines.filter(Boolean).join('\n');
}
// Plain-text components keep source text inert and avoid accidental mentions/links.
const clean=value=>plain(String(value||'')).replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g,'$1').replace(/https?:\/\/[^\s]+/g,'').trim();
const compact=(value,limit)=>{let length=0,result='';for(const char of clean(value)){const width=char.codePointAt(0)>255?2:1;if(length+width>limit)return result.trimEnd()+'…';result+=char;length+=width;}return result;};
const comparable=value=>clean(value).toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
export function cardSummary(item){
 const title=comparable(item.title),sentences=[],seen=new Set();
 for(const value of [item.takeaway,...(item.bullets||[]),item.summary]){
  let text=clean(value),rawTitle=clean(item.title);
  if(text.startsWith(rawTitle)&&rawTitle)text=text.slice(rawTitle.length).replace(/^[\s，。:：.!！?？—-]+/u,'');
  for(const {segment:sentence} of new Intl.Segmenter('zh-CN',{granularity:'sentence'}).segment(text)){
   const content=sentence.trim(),key=comparable(content);
   if(!key||key===title||title.includes(key)||seen.has(key))continue;
   seen.add(key);sentences.push(content);if(sentences.length===2)break;
  }
  if(sentences.length===2)break;
 }
 return compact(sentences.join(' '),360)||'暂无摘要，点击阅读原文查看。';
}
export function cardPublishedAt(value){
 const time=Date.parse(value);if(!Number.isFinite(time))return '发布时间未提供';
 const date=new Date(time+8*3600000).toISOString();return date.slice(0,10)+' '+date.slice(11,16)+'（北京时间）';
}
export function itemCard(item,kind){
 const title=compact(item.title,80)||'未命名内容';
 const metadata=(compact(item.source,48)||'来源未提供')+' · '+(item.publicationDateKnown===false?'发布时间未提供':cardPublishedAt(item.publishedAt));
 const summary=cardSummary(item),details=[];
 if(kind==='activities'&&item.activity){
  details.push(activityTime(item.activity));
  if(item.activity.status==='tentative')details.push('日期暂定，以主办方公告为准');
  if(item.activity.location)details.push('地点／平台：'+compact(item.activity.location,180));
  if(item.activity.date&&item.activity.registrationDeadline)details.push('报名截止：'+activityTime({registrationDeadline:item.activity.registrationDeadline}).replace(/^提交截止：/,''));
 }
 const url=safeUrl(kind==='activities'?item.activity?.originalUrl||item.activity?.url:item.url);
 const message={msg_type:'interactive',card:{config:{wide_screen_mode:true},header:{template:'blue',title:{tag:'plain_text',content:title}},elements:[
  {tag:'note',elements:[{tag:'plain_text',content:metadata}]},
  {tag:'div',text:{tag:'plain_text',content:summary}},
  ...(details.length?[{tag:'div',text:{tag:'plain_text',content:details.join('\n')}}]:[]),
  ...(url?[{tag:'action',actions:[{tag:'button',text:{tag:'plain_text',content:'阅读原文'},type:'primary',url}]}]:[]),
  {tag:'note',elements:[{tag:'plain_text',content:'DayDay AI · '+deliveryLabels[kind]}]},
 ]}};
 if(new TextEncoder().encode(JSON.stringify(message)).length>deliveryPolicy.maxMessageBytes-200)throw Error('单条提醒超过消息长度，请检查数据');
 return {message,text:[title,metadata,summary,...details,...(url?['阅读原文']:[]),'DayDay AI · '+deliveryLabels[kind]].join('\n')};
}
export function deliveryParts(items,kind){
 return items.map(item=>({ids:[kind==='activities'?activityNoticeId(item):item.id],...itemCard(item,kind)}));
}
// Announce each activity once, then remind once within 24h of its start/deadline.
export function dailyNoticeId(kind,item,at=Date.now()){
 if(kind!=='activities')return kind+':'+item.id;
 const a=item.activity,start=Date.parse(a?.startAt||(a?.date?`${a.date}T00:00:00+08:00`:a?.registrationDeadline?.includes('T')?a.registrationDeadline:`${a?.registrationDeadline}T23:59:59+08:00`));
 const soon=start>=at&&start-at<=86400000;
 return 'activities:'+activityNoticeId(item)+(soon?':upcoming':'');
}
export function dailyDeliveryItems(publication,at=Date.now()){
 return {hot:publication.hot||[],activities:(publication.activities||[]).filter(x=>x.activity?.status!=='cancelled'&&activityEnd(x.activity)>=at)};
}
export function dailyDeliveryParts(groups,at=Date.now()){
 return deliveryPolicy.dailyCategories.flatMap(kind=>(groups[kind]||[]).map(item=>({ids:[dailyNoticeId(kind,item,at)],...itemCard(item,kind)})));
}

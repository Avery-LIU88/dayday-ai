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
export function deliveryParts(items,kind){
 const title='DayDay AI · '+deliveryLabels[kind],parts=[];let part={ids:[],text:title};
 for(const item of items){
  const text=itemText(item,kind),candidate=part.text+'\n\n'+text;
  if(new TextEncoder().encode(JSON.stringify({msg_type:'text',content:{text:candidate}})).length>deliveryPolicy.maxMessageBytes&&part.ids.length){parts.push(part);part={ids:[],text:title};}
  if(new TextEncoder().encode(text).length>deliveryPolicy.maxMessageBytes-300)throw Error('单条提醒超过消息长度，请检查数据');
  part.ids.push(kind==='activities'?activityNoticeId(item):item.id);part.text+='\n\n'+text;
 }
 if(part.ids.length)parts.push(part);return parts;
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
 const title='DayDay AI · 每日推送',parts=[];let part={ids:[],text:title},section='';
 const size=text=>new TextEncoder().encode(JSON.stringify({msg_type:'text',content:{text}})).length;
 for(const kind of deliveryPolicy.dailyCategories)for(const item of groups[kind]||[]){
  const text=itemText(item,kind),heading=`【${deliveryLabels[kind]}】`;
  let addition=(section===kind?'\n\n':'\n\n'+heading+'\n')+text;
  if(size(part.text+addition)>deliveryPolicy.maxMessageBytes&&part.ids.length){parts.push(part);part={ids:[],text:title};section='';addition='\n\n'+heading+'\n'+text;}
  if(size(part.text+addition)>deliveryPolicy.maxMessageBytes)throw Error('单条提醒超过消息长度，请检查数据');
  part.ids.push(dailyNoticeId(kind,item,at));part.text+=addition;section=kind;
 }
 if(part.ids.length)parts.push(part);return parts;
}

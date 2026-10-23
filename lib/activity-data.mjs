// Shared presentation data, with no collection or model work on public reads.
export const activityCategories=['线上发布会','线下活动','黑客松'];
const validTime=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v)&&Number.isFinite(Date.parse(v));
export function publicActivity(value){
 if(!value||(!validTime(value.date)&&!validTime(value.registrationDeadline)))return null;
 const clean={};
 for(const key of ['date','endDate','startAt','endAt','registrationDeadline','location','format','kind','url','originalUrl','trackedId','status','timezone','note'])if(typeof value[key]==='string')clean[key]=value[key];
 // Calendar dates displayed to this audience use Beijing time; ISO instants retain their offsets.
 for(const [time,date] of [['startAt','date'],['endAt','endDate']])if(validTime(clean[time])){clean[date]=new Date(Date.parse(clean[time])+8*3600000).toISOString().slice(0,10);clean.timezone='Asia/Shanghai';}
 if(clean.originalUrl){try{if(new URL(clean.originalUrl).pathname==='/')delete clean.originalUrl;}catch{delete clean.originalUrl;}}
 return clean;
}
export const activityEnd=a=>Date.parse(a?.endAt||(a?.endDate||a?.date?`${a.endDate||a.date}T23:59:59+08:00`:a?.registrationDeadline?.includes('T')?a.registrationDeadline:`${a?.registrationDeadline}T23:59:59+08:00`));
export const activityOrder=a=>Date.parse(a.startAt||a.date||a.registrationDeadline);
export function activityState(a,at=Date.now()){
 if(a?.status==='cancelled')return '已取消';
 if(activityEnd(a)<at)return '已结束';
 if(a?.status==='tentative')return '暂定';
 if(a?.date&&activityOrder(a)<=at)return '进行中';
 return '即将开始';
}
export function activityTime(a){
 const format=v=>v?.includes('T')?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' 北京时间':v;
 if(!a.date)return `提交截止：${format(a.registrationDeadline)}${!a.registrationDeadline?.includes('T')?'（时区见原站）':''}`;
 const start=format(a.startAt||a.date),end=a.endAt||a.endDate;
 return start+(end&&end!==(a.startAt||a.date)?' — '+format(end):'');
}
// Schedule/location changes notify once; title edits and score changes do not.
export function activityNoticeId(item){
 const a=item.activity;if(!a?.format)return item.id; // Legacy date-only notices.
 const value=JSON.stringify([a.date,a.endDate,a.startAt,a.endAt,a.registrationDeadline,a.location,a.status]);
 let hash=2166136261;for(const c of value){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return item.id+':'+(hash>>>0).toString(16);
}

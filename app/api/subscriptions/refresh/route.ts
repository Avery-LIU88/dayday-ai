import {authorizedUpdater} from '../../../../lib/news-store';
import {runEpisodeJob,subscriptionJobStatus,resolveAndSave} from '../../../../lib/subscription-store';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(new URL(request.url).searchParams.get('status')==='1'){
  if(!authorizedUpdater(request))return Response.json({error:'Unauthorized'},{status:401});
  return Response.json(await subscriptionJobStatus(),{headers:{'Cache-Control':'no-store'}});
 }
 return Response.json({purpose:'独立检查我的关注，向已连接机器人并开启节目提醒的读者推送关注之后的新一期。没有更新不发消息；不等待晚间资讯任务，也不发送热点或活动。',method:'POST',authorization:'Use the Site service credential from get_site in BOTH OAI-Sites-Authorization and Authorization bearer headers, only to this Site. If application authorization returns 401, retrieve the existing ADMIN_TOKEN from Sites runtime environment variables for Authorization; do not rotate secrets. Never log credentials.',continueUntil:'POST {} sequentially until complete=true, at most 100 calls. Stop on busy=true or any HTTP error; unfinished runs retain progress. Do not publish, edit source, or run /api/refresh.',interval:'Asia/Shanghai，每小时整点检查一次。同一时间段已完成则跳过，无新增不发消息。',verify:'Read authenticated GET /api/subscriptions/refresh?status=1 and report aggregate checked, failed, sent and complete only.',privacy:'Do not read or print reader tokens, webhook URLs or signing secrets.'},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request){
 if(!authorizedUpdater(request))return Response.json({error:'Unauthorized'},{status:401});
 // Operator-only source verification saves a public show without following it
 // for a reader and without dispatching any notification.
 let input;
 try{if(Number(request.headers.get('content-length')||0)>2048)throw Error();const raw=await request.text();if(raw.length>2048)throw Error();input=raw?JSON.parse(raw):{};if(!input||Array.isArray(input)||typeof input!=='object')throw Error();}catch{return Response.json({error:'无效请求'},{status:400});}
 if(input.verifyUrl!==undefined){
  if(typeof input.verifyUrl!=='string')return Response.json({error:'节目链接格式不正确'},{status:400});
  try{const result=await resolveAndSave(input.verifyUrl);return Response.json({verified:true,show:result.show,episodes:result.episodes},{headers:{'Cache-Control':'no-store'}});}catch(e){return Response.json({verified:false,error:e instanceof Error?e.message.slice(0,180):'节目源暂不可用'},{status:502});}
 }
 try{return Response.json(await runEpisodeJob(),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'节目任务未完成，已有内容保留'},{status:500});}
}

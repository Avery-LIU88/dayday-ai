import {authorizedUpdater} from '../../../../lib/news-store';
import {runSubscriptionJob,resolveAndSave} from '../../../../lib/subscription-store';
export const dynamic='force-dynamic';
export async function GET(){return Response.json({purpose:'更新已关注节目，并仅向主动开启提醒的浏览器对应飞书机器人发送节目通知和所选简报。',method:'POST',authorization:'Obtain this Site service credential from get_site; send only to this Site in BOTH OAI-Sites-Authorization and Authorization bearer headers. Do not log credentials.',continueUntil:'Call sequentially until complete=true, stop on busy=true or an error. No publishing or source edits.',interval:'每小时检查；即时提醒指下一次检查发现更新后发送。',privacy:'Do not read or print reader tokens, webhook URLs or signing secrets.'},{headers:{'Cache-Control':'no-store'}});}
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
 try{return Response.json(await runSubscriptionJob(),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'节目任务未完成，已有内容保留'},{status:500});}
}

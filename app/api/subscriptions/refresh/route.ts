import {authorizedUpdater} from '../../../../lib/news-store';
import {runSubscriptionJob} from '../../../../lib/subscription-store';
export const dynamic='force-dynamic';
export async function GET(){return Response.json({purpose:'更新已关注节目，并仅向主动开启提醒的浏览器对应飞书机器人发送节目通知和所选简报。',method:'POST',authorization:'Obtain this Site service credential from get_site; send only to this Site in BOTH OAI-Sites-Authorization and Authorization bearer headers. Do not log credentials.',continueUntil:'Call sequentially until complete=true, stop on busy=true or an error. No publishing or source edits.',interval:'每小时检查；即时提醒指下一次检查发现更新后发送。',privacy:'Do not read or print reader tokens, webhook URLs or signing secrets.'},{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){
 if(!authorizedUpdater(request))return Response.json({error:'Unauthorized'},{status:401});
 try{return Response.json(await runSubscriptionJob(),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'节目任务未完成，已有内容保留'},{status:500});}
}

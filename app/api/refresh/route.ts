import {env} from 'cloudflare:workers';
import {authorizedUpdater,refreshNews,publicState} from '../../../lib/news-store';
import {refreshModelRankings} from '../../../lib/model-ranking-store';
import {runSubscriptionJob} from '../../../lib/subscription-store';
import {runNightlyUpdate} from '../../../lib/nightly-update.mjs';
export const dynamic='force-dynamic';
export async function GET(){return Response.json({purpose:'每天完成资讯采集、AI 筛选提取、去重、事件归组、评分和网站发布，再更新关注节目并推送飞书活动提醒、订阅更新、AI 今日必知。',authorization:'Obtain this Site service credential from get_site. Send it to this same Site in BOTH OAI-Sites-Authorization and Authorization as Bearer tokens. Never log or persist credentials.',method:'POST',schedule:'Asia/Shanghai daily at 21:00. One run per calendar day.',continueUntil:'POST sequentially until complete=true. Each request resumes the durable daily run. No fixed daily message count; large deliveries use continuation requests. Stop and report on busy=true, blocked=true, or HTTP error. skipped=true means no run is due; do not force it. At most 400 requests per automation invocation; if incomplete, retain the cursor and report, never claim completion.',verify:'After complete=true read GET /api/state and authenticated GET /api/pipeline. Budget CNY 6 per Shanghai calendar day. Old 08:00/20:00 invocations do not collect or notify. Do not invoke /api/pipeline separately during scheduled runs.',privacy:'Only readers who connected their own bot and enabled the selected categories receive messages. Never expose reader tokens, webhook URLs, or signing secrets.'},{headers:{'Cache-Control':'no-store'}});}
export async function POST(request:Request){
 if(!authorizedUpdater(request))return Response.json({error:'Unauthorized'},{status:401});
 const db=(env as {DB?:D1Database}).DB;if(!db)return Response.json({error:'数据库未连接'},{status:503});
 try{return Response.json(await runNightlyUpdate(db,{news:()=>refreshNews(),read:publicState,models:refreshModelRankings,subscriptions:runSubscriptionJob}),{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({error:'本轮更新未完成，已有内容和进度保留；未完成发布时不发送飞书'},{status:500});}
}

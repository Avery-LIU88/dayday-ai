import {env} from 'cloudflare:workers';
import {authorizedUpdater} from '../../../lib/news-store';
import {FeedbackError,readFeedbackForm,validateFeedback,saveFeedback,sha256} from '../../../lib/feedback.mjs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
type Runtime={DB?:D1Database;ADMIN_TOKEN?:string};
export async function POST(request:Request){
 const origin=new URL(request.url).origin;
 if(request.headers.get('origin')&&request.headers.get('origin')!==origin)return Response.json({error:'请从本站提交反馈。'},{status:403,headers});
 try{
  const input=await validateFeedback(await readFeedbackForm(request),origin),runtime=env as Runtime;
  const clientKey=await sha256(`${request.headers.get('cf-connecting-ip')||'local'}:${runtime.ADMIN_TOKEN||origin}`);
  const result=await saveFeedback(input,{db:runtime.DB,clientKey});
  return Response.json({id:result.id},{status:201,headers});
 }catch(error){
  const known=error instanceof FeedbackError;
  return Response.json({error:known?error.message:'暂时未能保存反馈，请稍后重试。'},{status:known?error.status:503,headers});
 }
}
/** Owner/service access only. Feedback has no public read route. */
export async function GET(request:Request){
 if(!authorizedUpdater(request))return Response.json({error:'Unauthorized'},{status:401,headers});
 const runtime=env as Runtime;if(!runtime.DB)return Response.json({error:'数据库未就绪'},{status:503,headers});
 const result=await runtime.DB.prepare('SELECT id,content,email,page_url AS pageUrl,created_at AS createdAt FROM feedback ORDER BY id DESC LIMIT 100').all();
 return Response.json({feedback:result.results},{headers});
}

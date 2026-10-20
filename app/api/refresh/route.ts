import { sync, dispatch } from "../../../lib/store";
export const dynamic="force-dynamic";
// Shared updater for an OWNER-PRIVATE Site. Sites dispatch authenticates service
// requests before this handler. Add application auth before ever making it public.
export async function POST(request: Request) {
  if(request.headers.get("sec-fetch-site")==="cross-site")return Response.json({error:"Forbidden"},{status:403});
  try {
    const result=await sync();
    let notifications;
    try {notifications=await dispatch();}catch(e){notifications={status:"not_configured",message:e instanceof Error?e.message:"提醒未就绪"};}
    return Response.json({...result,notifications});
  }catch{return Response.json({error:"采集任务失败，请查看信源状态"},{status:500});}
}

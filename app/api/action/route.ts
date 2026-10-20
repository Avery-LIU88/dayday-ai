import { followShow, saveEntry, setSetting, sync, dispatch } from "../../../lib/store";
import { getChatGPTUser } from "../../chatgpt-auth";
export async function POST(request: Request) {
  if (!(await getChatGPTUser())) return Response.json({error:"请先登录，再保存关注和阅读记录"},{status:401});
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin)return Response.json({error:"请求来源不匹配"},{status:403});
  try {
    const body=await request.text();
    if(body.length>3000)return Response.json({error:"请求过大"},{status:413});
    const data=JSON.parse(body);
    switch(data.action){
      case "follow":
        if(typeof data.id!=="string" || typeof data.active!=="boolean" || !["digest","instant","off"].includes(data.mode))throw new Error("关注参数不正确");
        await followShow(data.id,data.active,data.mode);break;
      case "save":
        if(typeof data.id!=="string"||typeof data.active!=="boolean")throw new Error("收藏参数不正确");
        await saveEntry(data.id,data.active);break;
      case "preferences":
        if(typeof data.value?.enabled!=="boolean" || typeof data.value?.quiet!=="boolean" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.value?.digestTime))throw new Error("提醒设置不正确");
        if(data.value.quiet && (data.value.digestTime<"08:00" || data.value.digestTime>="22:00"))throw new Error("开启免打扰时，请选择 08:00–21:59");
        await setSetting("preferences",{enabled:data.value.enabled,quiet:data.value.quiet,digestTime:data.value.digestTime});break;
      case "sync": return Response.json(await sync());
      case "test": return Response.json(await dispatch(true));
      case "feedback":
        if(typeof data.text!=="string"||data.text.trim().length<5||data.text.length>2000)throw new Error("请输入 5–2000 字的反馈");
        await setSetting(`feedback:${crypto.randomUUID()}`,{text:data.text.trim(),createdAt:new Date().toISOString()});break;
      default: return Response.json({error:"未知操作"},{status:400});
    }
    return Response.json({ok:true});
  }catch(e){return Response.json({error:e instanceof Error ? e.message : "操作失败，请重试"},{status:400});}
}

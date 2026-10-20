import {readerId,limitAction,subscriptionState,resolveAndSave,follow,refreshFollowed,configure,connectBot,disconnectBot,preparePreview,sendPreview} from '../../../lib/subscription-store';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Authorization'};
export async function GET(request:Request){try{return Response.json(await subscriptionState(await readerId(request)),{headers});}catch{return Response.json({error:'无法读取当前浏览器的关注记录'},{status:401,headers});}}
export async function POST(request:Request){
 try{
  if(Number(request.headers.get('content-length')||0)>12000)return Response.json({error:'请求过大'},{status:413,headers});
  const id=await readerId(request);await limitAction(request,id);
  const stream=request.body?.getReader();if(!stream)throw Error('请求为空');
  let text='',size=0;const decoder=new TextDecoder();
  try{while(true){const part=await stream.read();if(part.done)break;size+=part.value.byteLength;if(size>12000)throw Error('请求过大');text+=decoder.decode(part.value,{stream:true});}}finally{await stream.cancel().catch(()=>{});}
  text+=decoder.decode();
  const b=JSON.parse(text);let result:unknown=null;
  switch(b.action){
   case 'resolve':result=await resolveAndSave(String(b.url||''));break;
   case 'follow':await follow(id,String(b.showId||''),b.active===true,b.mode);break;
   case 'refresh':result=await refreshFollowed(id,String(b.showId||''));break;
   case 'preferences':await configure(id,b.preferences);break;
   case 'connect':await connectBot(id,String(b.webhook||''),String(b.secret||''));break;
   case 'disconnect':await disconnectBot(id);break;
   case 'preview':result=await preparePreview(id,String(b.kind||''));break;
   case 'send':result=await sendPreview(id,String(b.kind||''));break;
   default:throw Error('不支持的操作');
  }
  return Response.json({result,state:await subscriptionState(id)},{headers});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'操作失败'},{status:400,headers});}
}

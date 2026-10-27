import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHmac} from 'node:crypto';
import {Miniflare} from 'miniflare';

test('Feishu sender runs in workerd, accepts receipts and never follows redirects',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),requests=[];
 const mf=new Miniflare({
  compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],modulesRoot:root,
  modules:[
   {type:'ESModule',path:root+'feishu-test-worker.mjs',contents:`
    import {sendFeishu} from './lib/feishu.mjs';
    import {itemCard} from './lib/delivery-content.mjs';
    export default {async fetch(request){
     const {scenario}=await request.json();
     return Response.json(await sendFeishu('https://open.feishu.cn/open-apis/bot/v2/hook/test','test-secret',scenario==='render-card'?itemCard({title:'卡片渲染',source:'Source',publishedAt:'2026-10-28T13:00:00Z',takeaway:'支持 2.5 亿参数。开放权重。第三句。',url:'https://example.org/news'},'hot').message:scenario));
    }};`},
   ...['lib/feishu.mjs','lib/delivery-content.mjs','lib/feed.mjs','lib/activity-data.mjs','config/delivery.mjs'].map(path=>({type:'ESModule',path:root+path,contents:readFileSync(root+path,'utf8')})),
  ],
  // All outbound requests terminate here; no real robot or external network is used.
  outboundService:async request=>{
   const payload=await request.json();requests.push({url:request.url,payload});
   if(payload.content?.text==='redirect')return new Response(null,{status:302,headers:{Location:'https://example.org/do-not-follow'}});
   if(payload.content?.text==='rejected')return Response.json({code:19021,msg:'bad sign'});
   if(payload.content?.text==='missing-receipt')return Response.json(null);
   return Response.json({code:0});
  },
 });
 try{
  for(const [scenario,status] of [['success','sent'],['redirect','failed'],['rejected','failed'],['missing-receipt','unknown']]){
   const before=requests.length;
   const result=await (await mf.dispatchFetch('http://localhost/',{method:'POST',body:JSON.stringify({scenario})})).json();
   assert.equal(result.status,status,JSON.stringify(result));assert.equal(requests.length,before+1);
   if(scenario==='redirect')assert.match(result.message,/重定向/);
   if(scenario==='rejected')assert.match(result.message,/19021/);
  }
  const card={msg_type:'interactive',card:{header:{title:{tag:'plain_text',content:'真实卡片格式'}},elements:[{tag:'action',actions:[{tag:'button',text:{tag:'plain_text',content:'阅读原文'},url:'https://example.org/article'}]}]}};
  const cardResult=await (await mf.dispatchFetch('http://localhost/',{method:'POST',body:JSON.stringify({scenario:card})})).json();
  assert.equal(cardResult.status,'sent');assert.equal(requests.at(-1).payload.msg_type,'interactive');assert.deepEqual(requests.at(-1).payload.card,card.card);
  const rendered=await (await mf.dispatchFetch('http://localhost/',{method:'POST',body:JSON.stringify({scenario:'render-card'})})).json();
  assert.equal(rendered.status,'sent');assert.equal(requests.at(-1).payload.card.elements[1].text.content,'支持 2.5 亿参数。 开放权重。');
  for(const {url,payload} of requests){
   assert.equal(new URL(url).hostname,'open.feishu.cn');
   assert.equal(payload.sign,createHmac('sha256',`${payload.timestamp}\ntest-secret`).update('').digest('base64'));
  }
 }finally{await mf.dispose();}
});

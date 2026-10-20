export const MAX_REQUEST=16000;
export class FeedbackError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export async function readFeedbackForm(request){
 if(!request.headers.get('content-type')?.startsWith('multipart/form-data;'))throw new FeedbackError('请使用反馈表单提交。');
 if(Number(request.headers.get('content-length')||0)>MAX_REQUEST)throw new FeedbackError('反馈内容过长。',413);
 const reader=request.body?.getReader();if(!reader)throw new FeedbackError('反馈内容为空。');const chunks=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_REQUEST)throw new FeedbackError('反馈内容过长。',413);chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
 try{return await new Response(body,{headers:{'Content-Type':request.headers.get('content-type')}}).formData();}catch{throw new FeedbackError('表单未能读取，请重新提交。');}
}
export async function sha256(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function validateFeedback(form,origin){
 for(const value of form.values())if(typeof value!=='string')throw new FeedbackError('反馈表单只支持文字。');
 const get=name=>String(form.get(name)||'').trim(),content=get('content'),email=get('email'),submissionKey=get('submissionKey');
 if(get('website'))throw new FeedbackError('提交未通过，请重新填写。');
 if(content.length<2||content.length>2000)throw new FeedbackError('反馈内容请填写 2–2000 个字。');
 if(email&&(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw new FeedbackError('请填写有效的邮箱。');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionKey))throw new FeedbackError('提交标识无效，请刷新页面。');
 let pageUrl='';const page=get('pageUrl');if(page){try{const url=new URL(page);if(url.origin!==origin||url.username||url.password)throw Error();pageUrl=`${url.origin}${url.pathname}${url.hash}`.slice(0,500);}catch{throw new FeedbackError('页面信息无效。');}}
 const payloadHash=await sha256(JSON.stringify({content,email,pageUrl}));return {content,email,pageUrl,submissionKey,payloadHash};
}
export async function saveFeedback(input,{db,clientKey,now=Date.now()}){
 if(!db)throw new FeedbackError('暂时无法保存反馈，请稍后重试。',503);
 const existing=await db.prepare('SELECT id,payload_hash FROM feedback WHERE submission_key=?').bind(input.submissionKey).first();
 if(existing){if(existing.payload_hash!==input.payloadHash)throw new FeedbackError('内容已变更，请重新提交。',409);return {id:existing.id};}
 const slot=Math.floor(now/3600000),key=await sha256(`${clientKey}:${slot}`);
 await db.prepare('DELETE FROM feedback_limits WHERE expires_at<?').bind(now).run();
 const allowed=await db.prepare('INSERT INTO feedback_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE feedback_limits.count<10 RETURNING count').bind(key,(slot+1)*3600000).first();
 if(!allowed)throw new FeedbackError('提交次数较多，请稍后再试。',429);
 const result=await db.prepare('INSERT OR IGNORE INTO feedback(submission_key,payload_hash,content,email,page_url,created_at) VALUES(?,?,?,?,?,?) RETURNING id').bind(input.submissionKey,input.payloadHash,input.content,input.email,input.pageUrl,new Date(now).toISOString()).first();
 if(result)return {id:result.id};
 const saved=await db.prepare('SELECT id,payload_hash FROM feedback WHERE submission_key=?').bind(input.submissionKey).first();
 if(saved&&saved.payload_hash===input.payloadHash)return {id:saved.id};
 throw new FeedbackError('内容已变更，请重新提交。',409);
}

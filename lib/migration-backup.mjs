// Temporary, read-only business backup. All records come from one D1 batch transaction.
export const backupTables=['deliveries','entries','feedback','feedback_limits','follows','notices','pipeline_calls','pipeline_events','pipeline_items','pipeline_steps','readers','runs','saved','settings','shows','subscriptions'];
const quoted=value=>'"'+value.replaceAll('"','""')+'"';
const list=backupTables.map(x=>"'"+x+"'").join(',');
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
const b64=value=>{const bytes=new Uint8Array(value);let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
export async function describeBackup(db){
 const schema=(await db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name IN (${list}) AND sql IS NOT NULL ORDER BY type DESC,name`).all()).results;
 const tables=schema.filter(x=>x.type==='table').map(x=>x.name).sort();
 if(JSON.stringify(tables)!==JSON.stringify(backupTables))throw Error('Unexpected business schema');
 const info=await db.batch(tables.map(name=>db.prepare(`PRAGMA table_info(${quoted(name)})`)));
 const columns=Object.fromEntries(tables.map((name,i)=>[name,info[i].results.map(c=>({name:c.name,type:c.type,pk:c.pk}))]));
 const sizes=await db.batch(tables.map(name=>db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(length(CAST(json_object(${columns[name].flatMap(c=>["'"+c.name.replaceAll("'","''")+"'",quoted(c.name)]).join(',')}) AS BLOB))),0) bytes FROM ${quoted(name)}`)));
 return {schema,columns,tables:tables.map((name,i)=>({name,...sizes[i].results[0]})),estimatedBytes:sizes.reduce((n,r)=>n+r.results[0].bytes,0)};
}
export async function createBackup(db,env){
 const description=await describeBackup(db);
 if(description.estimatedBytes>16*1024*1024)throw Error('Snapshot exceeds in-memory safety limit');
 const ordered=backupTables.map(name=>{const keys=description.columns[name].filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>quoted(c.name));if(!keys.length)throw Error('Primary key required');return db.prepare(`SELECT * FROM ${quoted(name)} ORDER BY ${keys.join(',')}`);});
 const result=await db.batch([...ordered,db.prepare(`SELECT name,seq FROM sqlite_sequence WHERE name IN (${list}) ORDER BY name`),db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name IN (${list}) AND sql IS NOT NULL ORDER BY type DESC,name`)]);
 if(JSON.stringify(result.at(-1).results)!==JSON.stringify(description.schema))throw Error('Schema changed during backup');
 const tables=Object.fromEntries(backupTables.map((name,i)=>[name,result[i].results]));
 const checks=Object.fromEntries(await Promise.all(backupTables.map(async name=>[name,{count:tables[name].length,sha256:await digest(JSON.stringify(tables[name]))}])));
 const secrets={};for(const key of ['DEEPSEEK_API_KEY','REMINDER_ENCRYPTION_KEY','SCHEDULER_TOKEN']){if(typeof env[key]!=='string'||!env[key])throw Error('Required application secret missing');secrets[key]=env[key];}
 // Never migrate the Sites service/admin credential to another host.
 return {format:'dayday-business-backup-v1',createdAt:new Date().toISOString(),schema:description.schema,columns:description.columns,tables,sequences:result.at(-2).results,checks,secrets};
}
export async function sealBackup(value,recipient){
 const plaintext=new TextEncoder().encode(JSON.stringify(value));if(plaintext.length>24*1024*1024)throw Error('Snapshot too large');
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('dayday-backup-v1')},key,plaintext);
 const publicKey=await crypto.subtle.importKey('jwk',recipient,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
 const wrappedKey=await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,await crypto.subtle.exportKey('raw',key));
 return {format:'dayday-sealed-backup-v1',algorithm:'RSA-OAEP-256/AES-256-GCM',iv:b64(iv),wrappedKey:b64(wrappedKey),ciphertext:b64(ciphertext)};
}
export async function backupResponse(request,env,configuration){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32||request.headers.get('authorization')!=='Bearer '+env.ADMIN_TOKEN)return Response.json({error:'Unauthorized'},{status:401,headers});
 if(Date.now()>=Date.parse(configuration.expiresAt))return Response.json({error:'Backup window closed'},{status:410,headers});
 if(!['GET','POST'].includes(request.method))return new Response(null,{status:405,headers:{...headers,Allow:'GET, POST'}});
 if(!env.DB)return Response.json({error:'Database unavailable'},{status:503,headers});
 try{
  if(request.method==='GET'){const info=await describeBackup(env.DB);return Response.json({tables:info.tables,estimatedBytes:info.estimatedBytes},{headers});}
  const value=await createBackup(env.DB,env);return Response.json(await sealBackup(value,configuration.recipient),{headers});
 }catch{return Response.json({error:'Backup failed; production data unchanged'},{status:503,headers});}
}

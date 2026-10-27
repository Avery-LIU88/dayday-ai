import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import {generateKeyPairSync,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {backupResponse,backupTables} from '../lib/migration-backup.mjs';
function fixture(){const sql=new DatabaseSync(':memory:');for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));const db={prepare(query){let args=[];return {bind(...v){args=v;return this;},async all(){return {results:sql.prepare(query).all(...args)};}};},async batch(statements){sql.exec('BEGIN');try{const rows=[];for(const stmt of statements)rows.push(await stmt.all());sql.exec('COMMIT');return rows;}catch(e){sql.exec('ROLLBACK');throw e;}}};return {sql,db};}
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const config={recipient:publicKey.export({format:'jwk'}),expiresAt:new Date(Date.now()+3600000).toISOString()};
const auth='a'.repeat(64),request=(method='POST',token=auth)=>new Request('https://example.org/api/migration-export',{method,headers:{Authorization:'Bearer '+token}});
test('backup is admin-only, expires, and cannot be used with scheduler credentials',async()=>{
 const env={ADMIN_TOKEN:auth};assert.equal((await backupResponse(request('POST','b'.repeat(64)),env,config)).status,401);
 assert.equal((await backupResponse(request(),env,{...config,expiresAt:'2020-01-01'})).status,410);
 assert.equal((await backupResponse(request('DELETE'),env,config)).status,405);
});
test('encrypted snapshot preserves all 16 tables, long fields, application secrets and IDs without modifying source',async()=>{
 const {db,sql}=fixture();try{
  const long='原始记录'.repeat(40000);sql.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('large-test',JSON.stringify(long));
  sql.prepare("INSERT INTO notices VALUES('existing-notice','reader','daily','unknown','2026-10-28','do not retry')").run();
  const before=sql.prepare('SELECT total_changes() n').get().n;
  const env={DB:db,ADMIN_TOKEN:auth,DEEPSEEK_API_KEY:'test-model-secret',REMINDER_ENCRYPTION_KEY:'c'.repeat(64),SCHEDULER_TOKEN:'b'.repeat(64)};
  const response=await backupResponse(request(),env,config);assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);
  const sealed=await response.json();assert.ok(!JSON.stringify(sealed).includes('test-model-secret'));
  const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(sealed.wrappedKey,'base64'));
  const cipher=Buffer.from(sealed.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(sealed.iv,'base64'));decipher.setAAD(Buffer.from('dayday-backup-v1'));decipher.setAuthTag(cipher.subarray(-16));
  const data=JSON.parse(Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]));
  assert.deepEqual(Object.keys(data.tables),backupTables);assert.equal(JSON.parse(data.tables.settings[0].value),long);assert.equal(data.tables.notices[0].status,'unknown');
  assert.equal(data.secrets.DEEPSEEK_API_KEY,'test-model-secret');assert.equal(data.secrets.ADMIN_TOKEN,undefined);assert.equal(data.checks.settings.count,1);
  assert.equal(sql.prepare('SELECT total_changes() n').get().n,before);
  const missing=await backupResponse(request(),{...env,REMINDER_ENCRYPTION_KEY:''},config);assert.equal(missing.status,503);
 }finally{sql.close();}
});

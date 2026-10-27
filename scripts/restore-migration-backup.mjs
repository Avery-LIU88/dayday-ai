import {readFile,writeFile,chmod,mkdir} from 'node:fs/promises';import {DatabaseSync} from 'node:sqlite';import assert from 'node:assert/strict';import {privateDecrypt,createDecipheriv,constants,createHash} from 'node:crypto';
import {decryptBot} from '../lib/subscriptions.mjs';
import {validateWebhook} from '../lib/feishu.mjs';
// Offline only: decrypt an encrypted backup and validate a new SQLite restoration.
const [backupFile,privateKeyFile,root]=process.argv.slice(2);
if(!backupFile||!privateKeyFile||!root)throw Error('Usage: restore-migration-backup.mjs <sealed.ndjson> <private.pem> <private-output-directory>');
await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
const text=await readFile(backupFile,'utf8');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const lines=text.trim().split('\n').map(JSON.parse),sealed=lines.shift();assert.equal(sealed.format,'dayday-sealed-stream-v1');
const privateKey=await readFile(privateKeyFile);const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(sealed.wrappedKey,'base64'));
let backup,complete=false,index=0;
for(const line of lines){assert.equal(line.index,index++);const cipher=Buffer.from(line.ciphertext,'base64'),decrypt=createDecipheriv('aes-256-gcm',key,Buffer.from(line.iv,'base64'));decrypt.setAAD(Buffer.from(sealed.backupId+':'+line.index));decrypt.setAuthTag(cipher.subarray(-16));
 const part=JSON.parse(Buffer.concat([decrypt.update(cipher.subarray(0,-16)),decrypt.final()]));
 if(part.type==='manifest'){assert.ok(!backup);backup={...part.metadata,tables:{}};}
 else if(part.type==='rows'){assert.ok(!complete);backup.tables[part.table]??=[];assert.equal(backup.tables[part.table].length,part.offset);backup.tables[part.table].push(...part.rows);}
 else if(part.type==='complete'){assert.equal(part.tables,16);complete=true;}
 else throw Error('Unknown backup chunk');
}
assert.equal(complete,true,'incomplete encrypted download');assert.equal(backup.format,'dayday-business-backup-v1');assert.equal(Object.keys(backup.tables).length,16);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const dbPath=root+'/restore-'+stamp+'.sqlite';await writeFile(dbPath,'',{mode:0o600,flag:'wx'});const db=new DatabaseSync(dbPath);
let report;
try{
 db.exec('BEGIN');for(const schema of backup.schema.filter(x=>x.type==='table'))db.exec(schema.sql);
 for(const [name,rows] of Object.entries(backup.tables)){
  assert.equal(rows.length,backup.checks[name].count);assert.equal(digest(rows),backup.checks[name].sha256,'download integrity: '+name);
  const columns=backup.columns[name].map(x=>x.name),insert=db.prepare(`INSERT INTO ${quote(name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
  for(const row of rows)insert.run(...columns.map(c=>row[c]));
 }
 for(const schema of backup.schema.filter(x=>x.type!=='table'))db.exec(schema.sql);
 for(const sequence of backup.sequences){db.prepare('DELETE FROM sqlite_sequence WHERE name=?').run(sequence.name);db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(sequence.name,sequence.seq);}
 db.exec('COMMIT');assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 for(const [name,check] of Object.entries(backup.checks)){const keys=backup.columns[name].filter(x=>x.pk).sort((a,b)=>a.pk-b.pk).map(x=>quote(x.name));const restored=db.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${keys.join(',')}`).all();assert.equal(digest(restored),check.sha256,'restore integrity: '+name);}
 const readers=db.prepare('SELECT bot FROM readers WHERE bot IS NOT NULL').all();for(const reader of readers){const bot=await decryptBot(reader.bot,backup.secrets.REMINDER_ENCRYPTION_KEY);assert.equal(validateWebhook(bot.webhook),true);}
 const notices=db.prepare('SELECT kind,status,COUNT(*) count FROM notices GROUP BY kind,status').all();
 report={backupFile,dbPath,createdAt:backup.createdAt,tables:Object.fromEntries(Object.entries(backup.checks).map(([name,x])=>[name,x.count])),allTableHashesMatched:true,sqliteIntegrity:'ok',decryptableBots:readers.length,noticeCounts:notices,applicationSecretNames:Object.keys(backup.secrets),adminCredentialExcluded:!backup.secrets.ADMIN_TOKEN,cloudChanges:false,messagesSent:0};
 await writeFile(root+'/restore-report.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}finally{db.close();await chmod(dbPath,0o600);}

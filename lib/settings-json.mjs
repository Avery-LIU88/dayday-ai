// Large JSON values use bounded rows. Reads are one SQLite statement and writes
// are one batch transaction, so readers never combine different publications.
const prefix = key => `__json_chunk__:${key}:`;
const upsert = (db, key, text) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, text);
export function settingStatement(db, key, value) {
  const text = JSON.stringify(value);
  if (text.length > 200_000) throw Error('Large settings require settingStatements');
  return upsert(db, key, text);
}
export function settingStatements(db, key, value) {
  const text = JSON.stringify(value), base = prefix(key), chunks = [];
  if (text.length > 8_000_000) throw Error('Publication exceeds bounded storage size');
  const statements = [db.prepare('DELETE FROM settings WHERE key>=? AND key<?').bind(base, base+'\uffff')];
  if (text.length <= 200_000) return [...statements, upsert(db, key, text)];
  for (let start=0; start<text.length;) {
    let end = Math.min(start+64_000, text.length);
    if (end<text.length && /[\uD800-\uDBFF]/.test(text[end-1])) end--;
    chunks.push(text.slice(start,end)); start=end;
  }
  chunks.forEach((chunk,i) => statements.push(upsert(db, base+String(i).padStart(4,'0'), chunk)));
  statements.push(upsert(db,key,JSON.stringify({$daydayJsonChunks:1,count:chunks.length,length:text.length})));
  return statements;
}
export const setSetting = (db,key,value) => db.batch(settingStatements(db,key,value));
export async function getSetting(db,key,fallback) {
  const base = prefix(key);
  const rows = (await db.prepare('SELECT key,value FROM settings WHERE key=? OR (key>=? AND key<?) ORDER BY key').bind(key,base,base+'\uffff').all()).results;
  const row = rows.find(r=>r.key===key); if(!row) return fallback;
  const value = JSON.parse(row.value); if(value?.$daydayJsonChunks!==1) return value;
  if(!Number.isInteger(value.count)||value.count<1||value.count>126) throw Error('Invalid publication manifest');
  const parts = new Map(rows.map(r=>[r.key,r.value])); let text='';
  for(let i=0;i<value.count;i++) {
    const chunk=parts.get(base+String(i).padStart(4,'0'));
    if(typeof chunk!=='string')throw Error('Incomplete publication'); text+=chunk;
  }
  if(text.length!==value.length)throw Error('Incomplete publication');
  return JSON.parse(text);
}

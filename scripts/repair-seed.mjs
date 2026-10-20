import fs from 'node:fs/promises';
import { readSource } from '../lib/feed.mjs';
const catalog=JSON.parse(await fs.readFile('data/catalog.json','utf8'));
const seed=JSON.parse(await fs.readFile('data/seed.json','utf8'));
for(const h of seed.health.filter(h=>!h.ok && h.id!=='jiqizhixin')) {
 const source=catalog.find(s=>s.id===h.id);
 try {const entries=await readSource(source);seed.entries=[...new Map([...seed.entries,...entries].map(e=>[e.id,e])).values()];Object.assign(h,{ok:true,count:entries.length,checkedAt:new Date().toISOString()});delete h.error;console.log(source.name,entries.length);}
 catch(e){console.log(source.name,e.message);}
}
seed.entries.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
await fs.writeFile('data/seed.json',JSON.stringify(seed,null,2));
console.log('总记录',seed.entries.length);

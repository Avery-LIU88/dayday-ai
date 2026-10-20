import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {collectSource,readBounded} from '../lib/news-collector.mjs';
const run=promisify(execFile);
// curl uses the host's configured network path; runtime collection uses fetch.
async function network(url){
 const {stdout}=await run('curl',['-L','--compressed','--max-redirs','3','--proto','=https,http','--max-time','22','--max-filesize','4000000','-sS','-A','DayDayAI/1.0 (public information reader)','-w','\n%{http_code}',url],{maxBuffer:4_100_000});
 const i=stdout.lastIndexOf('\n');return new Response(stdout.slice(0,i),{status:Number(stdout.slice(i+1))||502});
}
const sources=JSON.parse(await fs.readFile('data/news-sources.json','utf8'));
let previous={entries:[],health:[]};
try{previous=JSON.parse(await fs.readFile('data/news-seed.json','utf8'))}catch{}
const selected=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const discovering=process.argv.includes('--discover');
let overrides={};try{overrides=JSON.parse(await fs.readFile('data/source-overrides.json','utf8'))}catch{}
const directoryExclusions=['github','scholar','semantic','paperswithcode','aipapers','cvpr','iccv','eccv','acl','emnlp','naacl','ccl','ccf','cadcg'];
const active=sources.filter(s=>(discovering?s.adapter==='directory'&&s.website&&!directoryExclusions.includes(s.id):s.adapter!=='directory')&&(!selected.length||selected.includes(s.id)));
const entries=new Map(previous.entries.map(e=>[e.id,e])), health=new Map(previous.health.map(h=>[h.id,h]));
for(let i=0;i<active.length;i+=5){
 await Promise.all(active.slice(i,i+5).map(async s=>{
  const checkedAt=new Date().toISOString();
  try{
   let candidate=s;
   if(discovering){
    const page=await readBounded(s.website,network);
    const feedTag=[...page.matchAll(/<link\b[^>]*>/gi)].map(x=>x[0]).find(tag=>/application\/(?:rss|atom)\+xml/i.test(tag));
    const feedLink=feedTag?.match(/href=["']([^"']+)["']/i)?.[1];
    candidate=feedLink?{...s,adapter:'rss',feed:new URL(feedLink.replace(/&amp;/g,'&'),s.website).href}:{...s,adapter:'html',feed:s.website,linkPattern:'/(?:news|blog|articles?|posts?|research|insights|content|info)/.+|/\\d{4}/\\d{2}/'};
   }
   const {items,rawCount}=await collectSource(candidate,network);
   if(discovering&&!items.length)throw Error('发现入口未返回相关内容');
   if(discovering){overrides[s.id]={adapter:candidate.adapter,feed:candidate.feed,...(candidate.linkPattern?{linkPattern:candidate.linkPattern}:{})};Object.assign(s,overrides[s.id]);}
   items.forEach(e=>entries.set(e.id,e));health.set(s.id,{id:s.id,ok:true,count:items.length,rawCount,checkedAt,lastSuccessAt:checkedAt});console.log(`${s.name}: ${items.length} 条`);
  }
  catch(e){health.set(s.id,{...health.get(s.id),id:s.id,ok:false,error:e.message.slice(0,160),checkedAt});console.log(`${s.name}: ${e.message.slice(0,100)}`);}
 }));
}
const data={collectedAt:new Date().toISOString(),entries:[...entries.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)),health:[...health.values()]};
await fs.writeFile('data/news-seed.json',JSON.stringify(data,null,2)+'\n');
if(discovering){await fs.writeFile('data/source-overrides.json',JSON.stringify(overrides,null,2)+'\n');await fs.writeFile('data/news-sources.json',JSON.stringify(sources,null,2)+'\n');}
console.log(JSON.stringify({configured:sources.length,attempted:active.length,healthy:data.health.filter(h=>h.ok).length,entries:data.entries.length}));

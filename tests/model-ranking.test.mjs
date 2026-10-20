import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {benchmarks,buildModelSnapshot,parseCSV,rankedRows,organizationIcon} from '../lib/model-ranking.mjs';
import {readEpochZip,fetchModelSnapshot} from '../lib/model-ranking-fetch.mjs';
const seed=JSON.parse(readFileSync(new URL('../data/model-rankings.json',import.meta.url),'utf8'));
function files(){
 return Object.fromEntries(benchmarks.map(b=>[b.file,b.id==='eci'?'Model,Display name,eci,eci_ci_low,eci_ci_high,date,Organization\nA,Alpha,168.83,165.25,173.95,2026-10-01,OpenAI\nB,Beta,120,115,125,2026-09-01,Anthropic':'Model version,mean_score,Started at,Organization,Log viewer\nA_high,0.8,2026-10-02,OpenAI,https://logs.epoch.ai/example\nB_high,0,2026-10-01,Anthropic,\nMissing,,2026-10-01,Anthropic,\nA_high,0.9,2026-09-01,OpenAI,\nA_low,0.5,2026-10-01,OpenAI,\nInvalid,5,2026-10-01,OpenAI,']));
}
test('CSV handles BOM, quotes, commas, embedded newlines and CRLF',()=>{
 assert.deepEqual(parseCSV('\uFEFFname,score\r\n"A, ""B""\nC",0\r\n'),[{name:'A, "B"\nC',score:'0'}]);
 assert.throws(()=>parseCSV('name\n"unfinished'));
});
test('preserves ECI units, excludes missing data, retains genuine zero and exact configurations',()=>{
 const s=buildModelSnapshot(files(),'2026-10-21T00:00:00Z');
 assert.equal(s.boards[0].rows[0].score,168.83);
 const coding=s.boards.find(b=>b.id==='swe');
 assert.equal(coding.rows.length,3);
 assert.equal(coding.rows.find(r=>r.id==='A_high').score,80);
 assert.equal(coding.rows.find(r=>r.id==='B_high').score,0);
 assert.ok(coding.rows.some(r=>r.id==='A_low'));
});
test('partial and invalid upstream results cannot become a complete snapshot',()=>{
 const f=files();delete f[benchmarks[2].file];
 assert.throws(()=>buildModelSnapshot(f,'2026-10-21'));
 assert.throws(()=>buildModelSnapshot(Object.fromEntries(benchmarks.map(b=>[b.file,'model,score\nx,1'])),'2026-10-21'));
 assert.throws(()=>readEpochZip(Buffer.from('<html>down</html>')));
});
test('fetch failures and HTML error pages reject instead of returning empty rankings',async()=>{
 await assert.rejects(fetchModelSnapshot(async()=>new Response('down',{status:503})),/503/);
 await assert.rejects(fetchModelSnapshot(async()=>new Response('<html>blocked</html>')));
});
test('ties use displayed precision and retain competition ranking',()=>{
 assert.deepEqual(rankedRows([{name:'A',score:80.001},{name:'B',score:80.002},{name:'C',score:70}]).map(r=>r.rank),[1,1,3]);
});
test('published seed contains only real finite scores with transparent source and icon mapping',()=>{
 assert.equal(seed.boards.length,5);
 for(const b of seed.boards){
  assert.ok(b.rows.length>=2);assert.equal(new Set(b.rows.map(r=>r.id)).size,b.rows.length);
  assert.ok(!b.file.includes('external'));
  assert.ok(b.rows.every(r=>Number.isFinite(r.score)));
  assert.ok(b.rows.every((r,i)=>!i||r.score<=b.rows[i-1].score));
 }
 assert.equal(organizationIcon('Google DeepMind'),'deepmind');
 assert.equal(organizationIcon('Z.ai (Zhipu AI)'),'zai');
});

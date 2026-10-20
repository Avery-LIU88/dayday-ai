import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mediaSpecs,buildArenaBoard,buildSpeechBoard,fetchArenaRows} from '../lib/model-media.mjs';
const record=(name,rank,rating,category='overall',day='2026-10-01')=>({model_name:name,rank,rating,category,organization:'openai',rating_lower:rating-10,rating_upper:rating+10,vote_count:1000,leaderboard_publish_date:day});
test('Arena retains original ranks and latest overall snapshot; zero is a score, missing is not',()=>{
 const b=buildArenaBoard(mediaSpecs[0],[record('a',1,0),record('b',2,-1),record('other',1,2000,'coding'),record('old',1,3000,'overall','2026-09-01'),record('missing',3,null)],'2026-10-02T00:00:00Z');
 assert.deepEqual(b.rows.map(r=>r.name),['a','b']);assert.equal(b.rows[0].score,0);assert.equal(b.rows[1].rank,2);assert.equal(b.evaluatedAt,'2026-10-01');assert.equal(b.license,'CC BY 4.0');
 assert.throws(()=>buildArenaBoard(mediaSpecs[0],[record('a',1,1),record('a',1,1)],'now'));
});
test('TTS preserves source confidence-based ranking and status without sorting by point score',()=>{
 const b=buildSpeechBoard({rows:[{id:'a',name:'A',rank:1,elo:1500,uncertainty:5,totalVotes:800,active:false,preliminary:false},{id:'b',name:'B',rank:2,elo:1510,uncertainty:30,totalVotes:280,preliminary:true},{id:'c',name:'C',rank:null,elo:2000,suspended:true}]},'2026-10-02T00:00:00Z');
 assert.deepEqual(b.rows.map(r=>r.id),['a','b']);assert.equal(b.rows[0].available,false);assert.equal(b.rows[1].preliminary,true);assert.equal(b.rows[1].uncertainty,30);assert.equal(b.rows[0].intervalLow,null);
});
test('pagination reads all records even when overall is not the first category',async()=>{
 const rows=Array.from({length:205},(_,i)=>({row:record(String(i),i+1,i,i>=100?'overall':'other')})),offsets=[];
 const result=await fetchArenaRows('text_to_image',async url=>{const offset=Number(new URL(url).searchParams.get('offset'));offsets.push(offset);return {ok:true,json:async()=>({num_rows_total:205,partial:false,rows:rows.slice(offset,offset+100)})};});
 assert.equal(result.length,205);assert.deepEqual(offsets,[0,100,200]);
});
test('incomplete and inconsistent pagination cannot replace a valid snapshot',async()=>{
 await assert.rejects(fetchArenaRows('text_to_image',async()=>({ok:true,json:async()=>({num_rows_total:200,partial:true,rows:[]})})));
 await assert.rejects(fetchArenaRows('text_to_image',async()=>({ok:false})));
});
test('committed media data has real provenance, distinct task boards and valid ranks',()=>{
 const snapshot=JSON.parse(fs.readFileSync(new URL('../data/model-media.json',import.meta.url)));
 assert.equal(snapshot.boards.length,5);assert.deepEqual([...new Set(snapshot.boards.map(b=>b.category))],['image','video','voice']);
 for(const b of snapshot.boards){assert.ok(b.rows.length>2);assert.ok(b.source.startsWith('https://'));assert.ok(b.rows.every(r=>Number.isFinite(r.score)&&r.rank>=1));assert.equal(new Set(b.rows.map(r=>r.id)).size,b.rows.length);}
});

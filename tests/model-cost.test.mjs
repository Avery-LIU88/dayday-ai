import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCostSnapshot,joinCostModels,frontierIDs,fetchCostSnapshot} from '../lib/model-cost.mjs';
const model=(id,name,prompt='0.000001',completion='0.000002',extra={})=>({id,name,architecture:{output_modalities:['text']},pricing:{prompt,completion,...extra}});
test('prices exclude missing values, variants and extra request charges; real zero remains valid',()=>{
 const s=buildCostSnapshot({data:[model('openai/a','OpenAI: A'),model('openai/b','OpenAI: B','0','0'),model('openai/c:free','OpenAI: C'),model('openai/d','OpenAI: D',''),model('openai/e','OpenAI: E','-1'),model('openai/f','OpenAI: F','1','2',{request:'0.1'})]});
 assert.deepEqual(s.rows.map(r=>r.name),['A','B']);assert.equal(s.rows[1].input,0);
});
test('matching requires exact version and company, rejects ambiguous prices',()=>{
 const rows=[{id:'a',name:'GPT-6.1 Sol',organization:'OpenAI',score:100},{id:'b',name:'GPT 61 Sol',organization:'OpenAI',score:99},{id:'c',name:'GPT-6.1 Sol',organization:'Anthropic',score:98}];
 const prices=[{id:'openai/gpt-6.1-sol',name:'GPT-6.1 Sol',provider:'openai',input:.000001,output:.000002}];
 const result=joinCostModels(rows,prices);assert.equal(result.length,1);assert.equal(result[0].cost,.003);
 assert.equal(joinCostModels(rows,[...prices,...prices]).length,0);assert.equal(joinCostModels(rows,prices,NaN).length,0);
});
test('frontier excludes dominated points, keeps ties, supports zero cost',()=>{
 const rows=[{id:'a',cost:0,score:2},{id:'b',cost:1,score:2},{id:'c',cost:2,score:4},{id:'d',cost:2,score:3},{id:'e',cost:2,score:4}];
 assert.deepEqual([...frontierIDs(rows)],['a','c','e']);
});
test('upstream failures and incomplete snapshots reject',async()=>{
 await assert.rejects(fetchCostSnapshot(async()=>({ok:false})));assert.throws(()=>buildCostSnapshot({data:[]}));
});
test('committed live prices join valid ECI rows and have a nonempty frontier',()=>{
 const p=JSON.parse(fs.readFileSync(new URL('../data/model-costs.json',import.meta.url))),s=JSON.parse(fs.readFileSync(new URL('../data/model-rankings.json',import.meta.url)));
 const r=joinCostModels(s.boards.find(b=>b.id==='eci').rows,p.rows);
 assert.ok(r.length>=10);assert.ok(r.every(x=>Number.isFinite(x.cost)&&x.cost>=0));assert.ok(frontierIDs(r).size>1);
});

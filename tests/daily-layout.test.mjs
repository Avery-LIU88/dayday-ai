import test from 'node:test';
import assert from 'node:assert/strict';
import {briefSection,groupBriefArticles} from '../lib/daily-layout.mjs';

test('sections describe events even when a media feed supplied them',()=>{
 assert.equal(briefSection({title:'MiniMax launches M3.1 Flash model',topic:'媒体资讯'}),'models');
 assert.equal(briefSection({title:'DeepSeek：进一步将内部推理框架DeepInfer全面开源',topic:'媒体资讯'}),'products');
 assert.equal(briefSection({title:'OpenAI 融资与新模型计划',topic:'公司动态'}),'industry');
 assert.equal(briefSection({title:'New benchmark evaluation for language models',topic:'开发者平台'}),'research');
});
test('directory includes the lead category, hides empty categories and counts each event once',()=>{
 const articles=[{id:'lead',title:'AI 企业融资',topic:'投融资'},{id:'a',title:'发布新模型',topic:'媒体资讯'},{id:'b',title:'发布开发框架',topic:'媒体资讯'},{id:'c',title:'行业并购',topic:'投融资'}];
 const sections=groupBriefArticles(articles);
 assert.deepEqual(sections.map(s=>s.id),['models','products','industry']);
 assert.deepEqual(sections.flatMap(s=>s.articles).map(x=>[x.article.id,x.index]),[['a',1],['b',2],['lead',0],['c',3]]);
 assert.equal(groupBriefArticles([articles[0]])[0].articles[0].index,0);
 assert.deepEqual(groupBriefArticles([]),[]);
});
test('policy and security have their own category; persisted event classification stays consistent',()=>{
 for(const title of ['联邦机构禁止使用某 AI 模型','AI 监管法案通过','WhatsApp Help Pages Leaked Hidden Instructions','Hackers hit AI coding tool OpenCode']){
  assert.equal(briefSection({title,topic:title.startsWith('联邦')?'政策监管':'媒体资讯'}),'policy');
 }
 assert.equal(briefSection({title:'New benchmark evaluation for privacy',topic:'论文与研究'}),'research');
 assert.equal(briefSection({title:'模型发布',section:'products'}),'products');
 const group=groupBriefArticles([{title:'AI bill introduced',topic:'媒体资讯'}]);
 assert.equal(group[0].id,'policy');assert.equal(group[0].articles.length,1);
});
test('model-powered editing tools and new training methods keep distinct classifications',()=>{
 assert.equal(briefSection({title:'Meshy推出Meshy Edit：基于全新自研AI模型，一句指令实现3D模型局部编辑',topic:'媒体资讯'}),'products');
 assert.equal(briefSection({title:'团队推出 HIL-UMI，让后训练摆脱真机依赖',topic:'媒体资讯'}),'research');
});

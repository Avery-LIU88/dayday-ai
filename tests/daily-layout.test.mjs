import test from 'node:test';
import assert from 'node:assert/strict';
import {briefSection,groupBriefArticles} from '../lib/daily-layout.mjs';

test('sections describe events even when a media feed supplied them',()=>{
 assert.equal(briefSection({title:'MiniMax launches M3.1 Flash model',topic:'媒体资讯'}),'models');
 assert.equal(briefSection({title:'DeepSeek：进一步将内部推理框架DeepInfer全面开源',topic:'媒体资讯'}),'products');
 assert.equal(briefSection({title:'OpenAI 融资与新模型计划',topic:'公司动态'}),'industry');
 assert.equal(briefSection({title:'New benchmark evaluation for language models',topic:'开发者平台'}),'research');
});
test('directory hides empty sections and preserves article targets without duplicating the lead',()=>{
 const articles=[{id:'lead',title:'AI 企业融资',topic:'投融资'},{id:'a',title:'发布新模型',topic:'媒体资讯'},{id:'b',title:'发布开发框架',topic:'媒体资讯'},{id:'c',title:'行业并购',topic:'投融资'}];
 const sections=groupBriefArticles(articles);
 assert.deepEqual(sections.map(s=>s.id),['models','products','industry']);
 assert.deepEqual(sections.flatMap(s=>s.articles).map(x=>[x.article.id,x.index]),[['a',1],['b',2],['c',3]]);
 assert.deepEqual(groupBriefArticles([articles[0]]),[]);
 assert.deepEqual(groupBriefArticles([]),[]);
});

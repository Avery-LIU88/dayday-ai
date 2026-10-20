import test from 'node:test';
import assert from 'node:assert/strict';
import {companies,matchesCompany,companyContentTypes,buildTopicDirectory} from '../lib/topic-directory.mjs';

const company=id=>companies.find(c=>c.id===id);
const sources=[
 {id:'openai',publisher:'openai',name:'OpenAI',section:'公司动态',primary:true,adapter:'rss'},
 {id:'openai-research',publisher:'openai',name:'OpenAI Research',section:'论文与研究',primary:true,adapter:'rss'},
 {id:'36kr',publisher:'36kr',name:'36氪',section:'媒体资讯'},
 {id:'36kr-flashes',publisher:'36kr',name:'36氪 · 快讯',section:'媒体资讯'},
 {id:'github',publisher:'github',name:'GitHub · AI 项目',section:'开发者平台'}
];
const story=(id,title,extra={})=>({id,title,summary:'',publishedAt:'2026-10-21T00:00:00Z',topic:'媒体资讯',tags:['媒体资讯'],
 links:[{id,sourceId:'36kr',publisher:'36kr',primary:false,url:`https://example.com/${id}`}],...extra});
test('company attribution follows subject, not the publisher of a media report',()=>{
 const s=story('a','OpenAI 发布新模型');
 assert.equal(matchesCompany(s,company('openai')),true);
 assert.equal(matchesCompany(s,company('anthropic')),false);
 const groups=buildTopicDirectory([s],sources,['公司动态','媒体资讯']);
 assert.equal(groups[0].cards.find(c=>c.id==='openai').stories[0].id,'a');
 assert.equal(groups[1].cards.find(c=>c.publisher==='36kr').stories[0].id,'a');
});
test('recognizes model aliases and official posts without mentioning the company',()=>{
 assert.equal(matchesCompany(story('a','Claude adds new features'),company('anthropic')),true);
 assert.equal(matchesCompany(story('b','更新使用政策',{links:[{sourceId:'openai',publisher:'openai',primary:true}]}),company('openai')),true);
 assert.equal(matchesCompany(story('c','OpenAI engineer',{topic:'招聘'}),company('openai')),false);
 assert.equal(matchesCompany(story('d','AI semiconductor industry',{summary:'A passing reference to OpenAI.'}),company('openai')),false);
});
test('source cards merge endpoints and do not leak unrelated category articles',()=>{
 const news=story('a','AI product');
 const finance=story('b','AI 融资',{topic:'投融资',tags:['投融资','媒体资讯'],links:[{sourceId:'36kr-flashes',publisher:'36kr'}]});
 const directory=buildTopicDirectory([news,finance],sources,['媒体资讯','投融资']);
 assert.equal(directory[0].cards.filter(c=>c.publisher==='36kr').length,1);
 assert.equal(directory[0].cards[0].stories.length,2);
 assert.deepEqual(directory[1].cards[0].stories.map(s=>s.id),['b']);
});
test('content filters distinguish official blogs, technical reports and release news',()=>{
 const media=story('a','OpenAI launches a new model');
 assert.deepEqual(companyContentTypes(media,company('openai'),sources),['产品发布']);
 const blog=story('b','Our approach to AI',{links:[{sourceId:'openai',publisher:'openai',primary:true,url:'https://openai.com/blog/approach'}]});
 assert.deepEqual(companyContentTypes(blog,company('openai'),sources),['公司 Blog']);
 const report=story('c','Technical report on reasoning',{links:[{sourceId:'openai-research',publisher:'openai',primary:true,url:'https://openai.com/research/reasoning'}]});
 assert.deepEqual(companyContentTypes(report,company('openai'),sources),['技术报告']);
});
test('latest event ordering and empty sources remain honest',()=>{
 const older=story('a','OpenAI older news',{publishedAt:'2026-10-20T00:00:00Z'});
 const newer=story('b','OpenAI latest news');
 const groups=buildTopicDirectory([older,newer],sources,['公司动态','开发者平台']);
 assert.equal(groups[0].cards.find(c=>c.id==='openai').stories[0].id,'b');
 assert.equal(groups[1].cards[0].stories.length,0);
 assert.equal(groups[0].cards.find(c=>c.id==='anthropic').stories.length,0);
});

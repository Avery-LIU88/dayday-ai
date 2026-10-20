/** Entities identify the subject of an event; publishers identify its source. */
export const companies=[
 {id:'openai',name:'OpenAI / ChatGPT',match:/\bopenai\b|\bchatgpt\b|\bgpt[- ]?\d|\bsora\b/i},
 {id:'anthropic',name:'Anthropic / Claude',match:/\banthropic\b|\bclaude\b/i},
 {id:'deepmind',name:'Google / Gemini',match:/\bgoogle\b|\bdeepmind\b|\bgemini\b|谷歌/i},
 {id:'deepseek',name:'DeepSeek',match:/\bdeepseek\b|深度求索/i},
 {id:'alibaba',name:'阿里 / 通义千问',match:/阿里|通义|千问|\bqwen\b|\balibaba\b/i},
 {id:'moonshot',name:'月之暗面 / Kimi',match:/月之暗面|\bmoonshot\b|\bkimi\b/i},
 {id:'minimax',name:'MiniMax',match:/\bminimax\b|海螺/i},
 {id:'zai',name:'智谱 / GLM',match:/智谱|\bglm[- ]?\d|\bz\.ai\b/i},
 {id:'xai',name:'xAI / Grok',match:/\bxai\b|\bx\.ai\b|\bgrok\b/i},
 {id:'meta',name:'Meta / Llama',match:/\bmeta\b|\bllama\b|\bfacebook\b/i},
 {id:'microsoft',name:'Microsoft / Copilot',match:/\bmicrosoft\b|\bcopilot\b|微软/i},
 {id:'nvidia',name:'NVIDIA',match:/\bnvidia\b|英伟达/i},
 {id:'bytedance',name:'字节跳动 / 豆包',match:/字节|豆包|\bbytedance\b|\bseedance\b|\bseedream\b|\bdoubao\b/i},
 {id:'tencent',name:'腾讯 / 混元',match:/腾讯|混元|\btencent\b|\bhunyuan\b/i},
 {id:'baidu',name:'百度 / 文心',match:/百度|文心|\bbaidu\b|\bernie\b/i},
 {id:'stepfun',name:'阶跃星辰',match:/阶跃|\bstepfun\b|\bstep[- ]\d|\bstepaudio\b/i},
 {id:'sensetime',name:'商汤科技',match:/商汤|日日新|\bsensetime\b|\bsensenova\b/i}
];
export function matchesCompany(story,company){
 if(story.topic==='招聘')return false;
 return company.match.test(`${story.title} ${story.originalTitle||''}`)
  ||(story.links||[]).some(l=>l.primary&&(l.publisher||l.sourceId)===company.id);
}
export function companyContentTypes(story,company,sources){
 const types=[],links=(story.links||[]).filter(l=>(l.publisher||l.sourceId)===company.id&&l.primary);
 const official=links.map(l=>sources.find(s=>s.id===l.sourceId)).filter(Boolean);
 if(official.some(s=>s.section==='公司动态'&&!/^models-|updates$/.test(s.id)&&s.adapter!=='hf-models'&&!/changelog|updates/.test(s.adapter)))types.push('公司 Blog');
 if(/技术报告|研究报告|technical report|research paper|pre.?training|post.?training/i.test(story.title)
  ||links.some(l=>/arxiv\.org|\/research\/|\/papers?\//.test(l.url))
  ||official.some(s=>s.section==='论文与研究'))types.push('技术报告');
 if(/发布|上线|推出|开放|开源|\blaunch|\breleas|\bintroduc|\bannounc/i.test(story.title))types.push('产品发布');
 return types;
}
const recentFirst=(a,b)=>b.publishedAt.localeCompare(a.publishedAt)||String(a.id).localeCompare(String(b.id));
const inCategory=(story,category)=>story.topic===category||(story.tags||[]).includes(category);
/** Source cards deduplicate endpoints but keep the selected category's scope. */
export function buildTopicDirectory(stories,sources,categories){
 const valid=stories.filter(s=>Number.isFinite(Date.parse(s.publishedAt))).sort(recentFirst);
 const sourceMap=new Map(sources.map(s=>[s.id,s]));
 const companyCards=companies.map(company=>({...company,kind:'company',publisher:company.id,
  stories:valid.filter(s=>matchesCompany(s,company))}));
 return categories.map(category=>{
  if(category==='公司动态')return {category,cards:companyCards};
  const scoped=valid.filter(s=>inCategory(s,category));
  const sourceIds=new Set(sources.filter(s=>s.section===category&&s.scope!=='截图栏目').map(s=>s.id));
  for(const story of scoped)for(const l of story.links||[])if(sourceMap.has(l.sourceId))sourceIds.add(l.sourceId);
  const byPublisher=new Map();
  for(const id of sourceIds){
   const source=sourceMap.get(id);if(!source||source.scope==='截图栏目')continue;
   const publisher=source.publisher||source.id;
   if(!byPublisher.has(publisher))byPublisher.set(publisher,{id:`source:${publisher}`,kind:'source',publisher,
    name:(sources.find(s=>s.id===publisher&&s.section===category)?.name||source.name).replace(/ ·.*/,''),sourceIds:[]});
   byPublisher.get(publisher).sourceIds.push(id);
  }
  const cards=[...byPublisher.values()].map(card=>({...card,stories:valid.filter(s=>
   (inCategory(s,category)||(s.links||[]).some(l=>sourceMap.get(l.sourceId)?.section===category))
   &&(s.links||[]).some(l=>card.sourceIds.includes(l.sourceId)))}));
  cards.sort((a,b)=>Number(!!b.stories.length)-Number(!!a.stories.length)
   ||(b.stories[0]?.publishedAt||'').localeCompare(a.stories[0]?.publishedAt||''));
  return {category,cards};
 });
}

export const briefSections=[
 {id:'models',label:'模型发布'},
 {id:'products',label:'产品更新'},
 {id:'industry',label:'行业动态'},
 {id:'research',label:'研究进展'}
];

/** Classify the event itself, not the publication it was collected from. */
export function briefSection(article){
 const title=String(article.title||'');
 if(/融资|收购|并购|估值|监管|法案|禁令|泄露|泄漏|漏洞|funding|raises?\b|raised\b|acqui[rs]|valuation|regulat|legislation|\bban\b|leak|breach/i.test(title)
  ||['投融资','政策监管','线上发布会','线下活动','招聘'].includes(article.topic))return 'industry';
 if(/论文|评测|基准|实验结果|\bpaper\b|benchmark|evaluation|研究表明|研究发现/i.test(title))return 'research';
 const release=/发布|推出|上线|开放|开源|升级|更新|launch|releas|introduc|unveil|open[- ](?:source|weight)|updates?/i.test(title);
 if(release&&/模型|\bmodels?\b|GPT[- ]?\d|Claude\s+\d|Gemini\s+\d|Llama\s+\d|Qwen|GLM|M3[.\s]|V4[.\s]/i.test(title)
  &&!/框架|工具|平台|客户端|framework|toolkit|dashboard|\bapp\b/i.test(title))return 'models';
 if(release)return 'products';
 if(article.topic==='论文与研究')return 'research';
 return 'industry';
}

/** Each full article appears once: the lead above, the rest in their sections. */
export function groupBriefArticles(articles){
 return briefSections.map(section=>({...section,articles:articles.map((article,index)=>({article,index}))
  .filter(item=>item.index>0&&briefSection(item.article)===section.id)})).filter(section=>section.articles.length);
}

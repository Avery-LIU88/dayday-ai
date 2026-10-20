export const briefSections=[
 {id:'models',label:'模型发布与更新'},
 {id:'products',label:'产品与工具'},
 {id:'industry',label:'行业动态'},
 {id:'research',label:'研究进展'},
 {id:'policy',label:'政策与安全'}
];

/** Classify the event itself, not the publication it was collected from. */
export function briefSection(article){
 if(briefSections.some(s=>s.id===article.section))return article.section;
 const title=String(article.title||'');
 if(/融资|收购|并购|估值|funding|raises?\b|raised\b|acqui[rs]|\bvaluation/i.test(title)
  ||['投融资','线上发布会','线下活动','招聘'].includes(article.topic))return 'industry';
 if(article.topic==='论文与研究'||/论文|评测|基准|实验结果|\bpaper\b|benchmark|evaluation|研究表明|研究发现/i.test(title))return 'research';
 if(/监管|法案|禁令|泄露|泄漏|漏洞|隐私|侵权|版权诉讼|regulat|legislation|\bbans?\b|\bbill\b|leak|breach|privacy|copyright|hackers?|cyberattack/i.test(title)
  ||article.topic==='政策监管')return 'policy';
 // A product powered by a model is still a product announcement.
 const subject=title.split(/基于|powered by|based on/i)[0];
 const release=/发布|推出|上线|开放|开源|升级|更新|launch|releas|introduc|unveil|open[- ](?:source|weight)|updates?/i.test(title);
 if(release&&/模型|\bmodels?\b|GPT[- ]?\d|Claude\s+\d|Gemini\s+\d|Llama\s+\d|Qwen|GLM|M3[.\s]|V4[.\s]/i.test(subject)
  &&!/框架|工具|平台|客户端|framework|toolkit|dashboard|\bapp\b/i.test(title))return 'models';
 if(/训练方法|训练范式|后训练|新算法|推理方法|training method|training paradigm/i.test(title))return 'research';
 if(release)return 'products';
 if(article.topic==='论文与研究')return 'research';
 return 'industry';
}

/** The directory counts every event, including a lead-only category.
 * The UI links back to the lead instead of repeating its full text. */
export function groupBriefArticles(articles){
 return briefSections.map(section=>({...section,articles:articles.map((article,index)=>({article,index}))
  .filter(item=>briefSection(item.article)===section.id)})).filter(section=>section.articles.length);
}

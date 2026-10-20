import fs from "node:fs/promises";
import { readSource } from "../lib/feed.mjs";

const news = [
  {id:"openai",name:"OpenAI",feed:"https://openai.com/news/rss.xml",website:"https://openai.com/news/",kind:"news",language:"en",category:"模型与产品",color:"#a3d4bb",description:"模型发布、产品更新与官方研究"},
  {id:"huggingface",name:"Hugging Face",feed:"https://huggingface.co/blog/feed.xml",website:"https://huggingface.co/blog",kind:"news",language:"en",category:"开源生态",color:"#edd78d",description:"开源模型、工具和开发实践"},
  {id:"mit",name:"MIT News · AI",feed:"https://news.mit.edu/rss/topic/artificial-intelligence2",website:"https://news.mit.edu/topic/artificial-intelligence2",kind:"news",language:"en",category:"论文与研究",color:"#e3a69f",description:"人工智能研究与前沿应用"},
  {id:"techcrunch",name:"TechCrunch · AI",feed:"https://techcrunch.com/category/artificial-intelligence/feed/",website:"https://techcrunch.com/category/artificial-intelligence/",kind:"news",language:"en",category:"商业与趋势",color:"#a3c590",description:"AI 创业、融资和行业变化"},
  {id:"jiqizhixin",name:"机器之心",feed:"https://www.jiqizhixin.com/rss",website:"https://www.jiqizhixin.com/",kind:"news",language:"zh",category:"论文与研究",color:"#a3b6df",description:"中文 AI 研究与技术报道"},
  {id:"qbit",name:"量子位",feed:"https://www.qbitai.com/feed",website:"https://www.qbitai.com/",kind:"news",language:"zh",category:"模型与产品",color:"#c3b3e0",description:"中文 AI 资讯与产品动态"},
  {id:"interconnects",name:"Interconnects",feed:"https://www.interconnects.ai/feed",website:"https://www.interconnects.ai/",kind:"news",language:"en",category:"论文与研究",color:"#a4bfea",description:"模型训练、研究解读与行业观察"},
];
const showQueries = [
  {id:"valley101",name:"硅谷101",term:"硅谷101",language:"zh",color:"#b3bd9b",tagline:"在科技与商业的交叉点，看见下一步。"},
  {id:"crossing",name:"十字路口 Crossing",term:"十字路口 Crossing",language:"zh",color:"#e1c18e",tagline:"AI 时代，与创造变化的人对话。"},
  {id:"latent",name:"Latent Space",appleId:1674008350,language:"en",color:"#c1a9dd",tagline:"与构建 AI 的人，一起深入工程现场。"},
  {id:"nopriors",name:"No Priors",appleId:1668002688,language:"en",color:"#e0a18c",tagline:"理解 AI、科技与创业的下一次转折。"},
  {id:"lex",name:"Lex Fridman Podcast",appleId:1434243584,language:"en",color:"#afbabd",tagline:"关于智能、科学与人类的长对话。"},
  {id:"a16z",name:"a16z Podcast",appleId:842818711,language:"en",color:"#b6c7a1",tagline:"从技术、商业与文化理解未来。"},
  {id:"acquired",name:"Acquired",appleId:1050462261,language:"en",color:"#9ebdad",tagline:"伟大公司的历史，以及背后的策略。"},
  {id:"late",name:"晚点聊 LateTalk",term:"晚点聊 LateTalk",language:"zh",color:"#d4b3a3",tagline:"商业世界的变化，和变化中的人。"},
];
const shows = [];
for (const q of showQueries) {
  try {
    const url = q.appleId ? `https://itunes.apple.com/lookup?id=${q.appleId}&entity=podcast` : `https://itunes.apple.com/search?term=${encodeURIComponent(q.term)}&media=podcast&entity=podcast&limit=5&country=cn`;
    const r = await fetch(url, {signal:AbortSignal.timeout(15000)});
    if (!r.ok) throw new Error(`Apple HTTP ${r.status}`);
    const j = await r.json();
    const match = j.results?.find(s => q.appleId ? s.collectionId === q.appleId : s.collectionName?.toLowerCase().includes(q.name.split(" ")[0].toLowerCase()));
    if (!match?.feedUrl) throw new Error("未找到匹配节目");
    shows.push({...q,kind:"podcast",feed:match.feedUrl,website:match.collectionViewUrl,appleUrl:match.collectionViewUrl,artwork:match.artworkUrl600 || match.artworkUrl100,author:match.artistName,description:q.tagline,category:"商业与趋势"});
    console.log(`节目已核实: ${q.name} · ${match.collectionName}`);
  } catch (e) { console.log(`节目待接入: ${q.name} · ${e.message}`); }
}
const sources = [...news, ...shows];
const entries = []; const health = [];
for (let i=0;i<sources.length;i+=4) await Promise.all(sources.slice(i,i+4).map(async s => {
  try { const items = await readSource(s); entries.push(...items); health.push({id:s.id,ok:true,count:items.length,checkedAt:new Date().toISOString()});console.log(`${s.name}: ${items.length} 条`); }
  catch(e){health.push({id:s.id,ok:false,error:e.message,checkedAt:new Date().toISOString()});console.log(`${s.name}: ${e.message}`);}
}));
await fs.mkdir("data",{recursive:true});
await fs.writeFile("data/catalog.json",JSON.stringify(sources,null,2));
await fs.writeFile("data/seed.json",JSON.stringify({collectedAt:new Date().toISOString(),entries: [...new Map(entries.map(e=>[e.id,e])).values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)),health},null,2));
console.log(`完成: ${sources.length} 个信源，${entries.length} 条真实记录。`);

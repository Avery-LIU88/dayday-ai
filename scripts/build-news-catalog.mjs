import fs from 'node:fs/promises';

// User's three source screenshots are the scope. Endpoints are candidates until
// the collector verifies them. No podcast, personal social account or push here.
const rows = [];
function add(section, id, name, website, feed='', extra={}) {
  rows.push({id,name,publisher:id,section,website,feed,adapter:feed?'rss':'directory',
    kind:'news',language:/[\u4e00-\u9fff]/.test(name)?'zh':'en',primary:false,
    scope:'截图指定',...extra});
}
const company='公司动态';
add(company,'openai','OpenAI','https://openai.com/news/','https://openai.com/news/rss.xml',{primary:true,language:'en'});
add(company,'anthropic','Anthropic','https://www.anthropic.com/news','https://www.anthropic.com/news',{adapter:'anthropic',primary:true});
add(company,'deepmind','Google DeepMind','https://deepmind.google/discover/blog/','https://deepmind.google/blog/rss.xml',{primary:true});
add(company,'xai','xAI','https://x.ai/news','',{primary:true});
add(company,'meta','Meta','https://ai.meta.com/blog/','https://about.fb.com/news/feed/',{primary:true,filterAI:true});
add(company,'nvidia','NVIDIA','https://blogs.nvidia.com/','https://blogs.nvidia.com/feed/',{primary:true,filterAI:true});
add(company,'microsoft','Microsoft','https://blogs.microsoft.com/ai/','https://blogs.microsoft.com/ai/feed/',{primary:true});
add(company,'deepseek','DeepSeek','https://www.deepseek.com/','',{primary:true});
add(company,'moonshot','月之暗面','https://www.kimi.com/','',{primary:true});
add(company,'zai','智谱 Z.ai','https://z.ai/blog','',{primary:true});
add(company,'bytedance','字节跳动','https://seed.bytedance.com/zh/','',{primary:true});
add(company,'alibaba','阿里','https://qwenlm.github.io/zh/blog/','https://qwenlm.github.io/index.xml',{primary:true,language:'en'});
add(company,'tencent','腾讯','https://hunyuan.tencent.com/','',{primary:true});
add(company,'baidu','百度','https://yiyan.baidu.com/','',{primary:true});
add(company,'minimax','MiniMax','https://www.minimax.io/news','',{primary:true,language:'en'});
add(company,'stepfun','阶跃星辰','https://www.stepfun.com/','',{primary:true});
add(company,'sensetime','商汤科技','https://www.sensetime.com/cn/news','',{primary:true});
add(company,'xai-updates','xAI · 产品更新','https://docs.x.ai/developers/release-notes','https://docs.x.ai/developers/release-notes',{adapter:'xai-updates',publisher:'xai',primary:true,language:'en',scope:'截图公司官方更新端点',notice:'官方产品更新日志；新闻 Blog 仍单独核验'});
add(company,'zai-updates','智谱 Z.ai · 产品更新','https://docs.z.ai/release-notes/new-released','https://docs.z.ai/release-notes/new-released.md',{adapter:'zai-updates',publisher:'zai',primary:true,language:'en',scope:'截图公司官方更新端点',notice:'官方产品发布日志；Blog 仍单独核验'});

const media='媒体资讯';
const mediaRows=[
 ['36kr','36氪','https://36kr.com/','https://36kr.com/feed'],
 ['tmtpost','AGI · 钛媒体','https://www.tmtpost.com/','https://www.tmtpost.com/rss.xml'],
 ['leiphone','雷锋网','https://www.leiphone.com/','https://www.leiphone.com/feed'],
 ['geekpark','极客公园','https://www.geekpark.net/','https://www.geekpark.net/rss'],
 ['latepost','晚点 LatePost','https://www.latepost.com/',''],
 ['jazzyear','甲子光年','https://www.jazzyear.com/',''],
 ['jiqizhixin','机器之心','https://www.jiqizhixin.com/','https://www.jiqizhixin.com/rss'],
 ['qbit','量子位','https://www.qbitai.com/','https://www.qbitai.com/feed'],
 ['xinzhiyuan','新智元','https://www.ai-era.com/',''],
 ['techweb','TechWeb','https://www.techweb.com.cn/','https://www.techweb.com.cn/rss/all.xml'],
 ['sspai','少数派','https://sspai.com/','https://sspai.com/feed'],
 ['infoq','InfoQ','https://www.infoq.cn/','https://www.infoq.com/feed/'],
 ['ft','FT','https://www.ft.com/artificial-intelligence','https://www.ft.com/technology?format=rss'],
 ['bloomberg','Bloomberg','https://www.bloomberg.com/technology','https://feeds.bloomberg.com/technology/news.rss'],
 ['reuters','Reuters','https://www.reuters.com/technology/artificial-intelligence/',''],
 ['techcrunch','TechCrunch · AI','https://techcrunch.com/category/artificial-intelligence/','https://techcrunch.com/category/artificial-intelligence/feed/'],
 ['information','The Information','https://www.theinformation.com/',''],
 ['wired','WIRED','https://www.wired.com/tag/artificial-intelligence/','https://www.wired.com/feed/tag/ai/latest/rss'],
 ['wsj','WSJ','https://www.wsj.com/tech/ai','https://feeds.a.dj.com/rss/RSSWSJD.xml'],
 ['404media','404 Media','https://www.404media.co/','https://www.404media.co/rss/'],
 ['arstechnica','Ars Technica','https://arstechnica.com/ai/','https://feeds.arstechnica.com/arstechnica/index'],
 ['semafor','Semafor','https://www.semafor.com/vertical/technology','https://www.semafor.com/rss.xml'],
 ['ieee','IEEE Spectrum','https://spectrum.ieee.org/artificial-intelligence','https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss'],
 ['venturebeat','VentureBeat','https://venturebeat.com/category/ai/','https://venturebeat.com/category/ai/feed/'],
 ['axios','Axios','https://www.axios.com/technology','https://api.axios.com/feed/'],
 ['siliconangle','SiliconANGLE','https://siliconangle.com/category/ai/','https://siliconangle.com/feed/']
];
for(const [id,name,url,feed] of mediaRows)add(media,id,name,url,feed,{filterAI:!['qbit','jiqizhixin','techcrunch','wired','ieee','venturebeat'].includes(id),language:['infoq'].includes(id)?'en':/[\u4e00-\u9fff]/.test(name)?'zh':'en',notice:['ft','bloomberg','information','wsj'].includes(id)?'仅采集公开元信息，付费正文在原站阅读':''});
add(media,'36kr-flashes','36氪 · 快讯','https://www.36kr.com/','http://www.36kr.com/feed-newsflash',{publisher:'36kr',filterAI:true,uncompressed:true,readerHeaders:true,scope:'截图媒体官方快讯端点',notice:'官方快讯 RSS；与综合源按发布者合并计数'});
add(media,'reuters-video','Reuters · YouTube 视频','https://www.youtube.com/channel/UChqUTb7kYRX8-EiaN3XFrSQ','https://www.youtube.com/feeds/videos.xml?channel_id=UChqUTb7kYRX8-EiaN3XFrSQ',{publisher:'reuters',filterAI:true,language:'en',contentLabel:'视频报道',scope:'截图媒体视频端点',notice:'用户 Feedly 中的 Reuters 视频订阅；仅筛选 AI 相关视频，不等同于路透社官网文章'});

const newsletter='Newsletter';
for(const [id,name,url,feed] of [
 ['importai','Import AI','https://importai.substack.com/','https://importai.substack.com/feed'],
 ['stratechery','Stratechery','https://stratechery.com/','https://stratechery.com/feed/'],
 ['thebatch','The Batch','https://www.deeplearning.ai/the-batch/',''],
 ['latent-articles','Latent Space','https://www.latent.space/','https://www.latent.space/feed'],
 ['bensbites','Ben’s Bites','https://www.bensbites.com/','https://www.bensbites.com/feed'],
 ['exponentialview','Exponential View','https://www.exponentialview.co/','https://www.exponentialview.co/feed'],
 ['tldr','TLDR AI','https://tldr.tech/ai',''],
 ['rundown','The Rundown AI','https://www.therundown.ai/',''],
 ['semianalysis','SemiAnalysis','https://semianalysis.com/','https://semianalysis.com/feed/'],
 ['interconnects','Interconnects','https://www.interconnects.ai/','https://www.interconnects.ai/feed'],
 ['oneusefulthing','One Useful Thing','https://www.oneusefulthing.org/','https://www.oneusefulthing.org/feed'],
 ['platformer','Platformer','https://www.platformer.news/','https://www.platformer.news/rss/']
])add(newsletter,id,name,url,feed,{filterAI:['stratechery','platformer'].includes(id),notice:'展示公开摘要；不读取个人邮箱或付费正文'});

const research='论文与研究';
for(const [id,name,url,feed] of [
 ['arxiv','arXiv · AI','https://arxiv.org/list/cs.AI/recent','https://rss.arxiv.org/atom/cs.AI+cs.LG+cs.CL+cs.CV'],
 ['paperswithcode','Papers with Code','https://paperswithcode.com/',''],
 ['scholar','Google Scholar','https://scholar.google.com/',''],
 ['semantic','Semantic Scholar','https://www.semanticscholar.org/',''],
 ['aipapers','AIPapers.ai','https://aipapers.ai/',''],
 ['sail','Stanford AI Lab','https://ai.stanford.edu/blog/','https://ai.stanford.edu/blog/feed.xml'],
 ['hai','Stanford HAI','https://hai.stanford.edu/news',''],
 ['bair','UC Berkeley BAIR','https://bair.berkeley.edu/blog/','https://bair.berkeley.edu/blog/feed.xml'],
 ['csail','MIT CSAIL','https://www.csail.mit.edu/news',''],
 ['cmu','CMU 机器学习','https://blog.ml.cmu.edu/','https://blog.ml.cmu.edu/feed/'],
 ['msresearch','Microsoft Research','https://www.microsoft.com/en-us/research/blog/','https://www.microsoft.com/en-us/research/feed/'],
 ['nvresearch','NVIDIA Research','https://research.nvidia.com/',''],
 ['mit','MIT News · AI','https://news.mit.edu/topic/artificial-intelligence2','https://news.mit.edu/rss/topic/artificial-intelligence2'],
 ['thu-yao','清华 · 姚期智相关机构','https://iiis.tsinghua.edu.cn/',''],
 ['thu-zhang','清华 · 张钹相关研究','',''],
 ['thu-keip','清华 · KEIP 实验室（名称待核对）','',''],
 ['thu-dai','清华 · 戴琼海相关实验室','',''],
 ['pku-wang','北大 · 王选所','https://www.wict.pku.edu.cn/',''],
 ['pku-lin','北大 · 林宙辰相关研究','',''],
 ['sjtu-lu','上海交大 · 卢策吾相关研究','',''],
 ['sjtu-ai','上海交大 · 人工智能研究院','https://ai.sjtu.edu.cn/',''],
 ['cas','中科院自动化所','https://ia.cas.cn/',''],
 ['mmlab','港中文 MMLab','https://mmlab.ie.cuhk.edu.hk/',''],
 ['cadcg','浙大 CAD&CG','http://www.cad.zju.edu.cn/','']
])add(research,id,name,url,feed,{primary:!['paperswithcode','scholar','semantic','aipapers'].includes(id),scope:id==='mit'?'现有补充':'截图指定',publisher:id==='msresearch'?'microsoft':id==='nvresearch'?'nvidia':id});

const developer='开发者平台';
add(developer,'huggingface','Hugging Face · 官方博客','https://huggingface.co/blog','https://huggingface.co/blog/feed.xml',{primary:true,language:'en'});
add(developer,'hf-papers','Hugging Face · 每日论文','https://huggingface.co/papers','https://huggingface.co/api/daily_papers',{primary:true,adapter:'hf',publisher:'huggingface',language:'en'});
add(developer,'github','GitHub · AI 项目','https://github.com/topics/artificial-intelligence','',{notice:'以下官方仓库为公司来源的具体接入端点，不代表覆盖全部 GitHub'});
for(const [id,name,repo,publisher] of [
 ['gh-openai','OpenAI · SDK','openai/openai-python','openai'],
 ['gh-anthropic','Anthropic · SDK','anthropics/anthropic-sdk-python','anthropic'],
 ['gh-deepseek','DeepSeek · 官方仓库','deepseek-ai/DeepSeek-V3','deepseek'],
 ['gh-qwen','阿里 · Qwen','QwenLM/Qwen3','alibaba'],
 ['gh-hf','Hugging Face · Transformers','huggingface/transformers','huggingface']
])add(developer,id,name,`https://github.com/${repo}`,`https://github.com/${repo}/releases.atom`,{primary:true,publisher,scope:'截图公司/开发者平台的官方端点',language:'en'});

const events='线下活动';
for(const [id,name,url] of [
 ['neurips','NeurIPS','https://neurips.cc/'],
 ['icml','ICML','https://icml.cc/'],
 ['iclr','ICLR','https://iclr.cc/'],
 ['acl','ACL','https://www.aclweb.org/portal/'],
 ['emnlp','EMNLP','https://www.aclweb.org/portal/'],
 ['naacl','NAACL','https://naacl.org/'],
 ['cvpr','CVPR','https://cvpr.thecvf.com/'],
 ['iccv','ICCV','https://www.thecvf.com/'],
 ['eccv','ECCV','https://eccv.ecva.net/'],
 ['aaai','AAAI','https://aaai.org/'],
 ['ccl','CCL','https://www.cipsc.org.cn/'],
 ['waica','WAICA（截图名称待核对）',''],
 ['ccf','CCF 相关会议','https://www.ccf.org.cn/']
])add(events,id,name,url,'',{primary:true,notice:'官方会议入口；时间、地点与报名信息仅在取得有效记录后展示'});
add('线上发布会','company-events','公司线上发布会','','',{scope:'截图栏目',notice:'从公司官方内容提取发布会信息；不虚构活动时间'});
for(const [id,name,url,feed] of [
 ['sequoia','Sequoia Capital','https://www.sequoiacap.com/','https://www.sequoiacap.com/feed/'],
 ['a16z-research','a16z','https://a16z.com/','https://a16z.com/feed/'],
 ['sacra','Sacra','https://sacra.com/',''],
 ['contrary','Contrary Research','https://research.contrary.com/','']
])add('投融资',id,name,url,feed,{primary:true,filterAI:true});
add('招聘','anthropic-jobs','Anthropic · 招聘','https://www.anthropic.com/careers','https://boards-api.greenhouse.io/v1/boards/anthropic/jobs',{adapter:'greenhouse',primary:true,publisher:'anthropic',scope:'截图公司官方招聘端点',language:'en'});
add('政策监管','policy','政策监管','','',{scope:'截图栏目',notice:'先汇总现有来源中的政策报道；监管机构原始来源待明确地区'});

// Official model repositories supplement, but do not replace, the news/blog endpoints.
for(const [publisher,name,author] of [
 ['xai','xAI','xai-org'],['moonshot','月之暗面','moonshotai'],['zai','智谱 Z.ai','zai-org'],
 ['bytedance','字节跳动 Seed','ByteDance-Seed'],['tencent','腾讯','tencent'],
 ['baidu','百度','baidu'],['stepfun','阶跃星辰','stepfun-ai']
])add(company,`models-${publisher}`,`${name} · 官方模型`,`https://huggingface.co/${author}`,`https://huggingface.co/api/models?author=${author}&sort=createdAt&direction=-1&limit=12&full=true`,{adapter:'hf-models',publisher,primary:true,scope:'截图公司官方模型端点',language:'zh',notice:'模型仓库创建记录；不等同于官方发布公告，Blog 入口单独核验'});

const fixes={
 deepmind:{feed:'https://deepmind.google/blog/rss.xml'},
 microsoft:{feed:'https://blogs.microsoft.com/feed/',filterAI:true},
 alibaba:{feed:'https://qwenlm.github.io/blog/index.xml'},
 arxiv:{feed:'https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=30'},
 deepseek:{website:'https://api-docs.deepseek.com/updates',feed:'https://api-docs.deepseek.com/updates',adapter:'changelog'},
 minimax:{feed:'https://www.minimax.io/news',adapter:'html',linkPattern:'^/(?:news|blog)/[^/]+$'},
 thebatch:{feed:'https://www.deeplearning.ai/the-batch/',adapter:'html',linkPattern:'^/the-batch/issue-\\d+/?$'},
 tldr:{feed:'https://tldr.tech/ai/archives',adapter:'tldr'},
 rundown:{feed:'https://www.therundown.ai/',adapter:'rundown'},
 hai:{feed:'https://hai.stanford.edu/news',adapter:'html'},
 csail:{feed:'https://www.csail.mit.edu/news',adapter:'html'},
 'a16z-research':{website:'https://www.a16z.news/',feed:'https://www.a16z.news/feed'},
 neurips:{feed:'https://blog.neurips.cc/feed/',adapter:'rss'},
 iclr:{feed:'https://blog.iclr.cc/feed/',adapter:'rss'},
 icml:{feed:'https://blog.icml.cc/feed/',adapter:'rss'},
 aaai:{feed:'https://aaai.org/feed/',adapter:'rss'},
 'thu-yao':{feed:'https://iiis.tsinghua.edu.cn/',adapter:'html',linkPattern:'/info/\\d+/\\d+\\.htm',filterAI:true},
};
for(const row of rows)Object.assign(row,fixes[row.id]||{});
try{
 const discovered=JSON.parse(await fs.readFile(new URL('../data/source-overrides.json',import.meta.url),'utf8'));
 for(const row of rows)Object.assign(row,discovered[row.id]||{});
}catch{}
await fs.writeFile(new URL('../data/news-sources.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
console.log(`已建立 ${rows.length} 个来源/端点记录（含待核验入口，不作为已接入数量）`);

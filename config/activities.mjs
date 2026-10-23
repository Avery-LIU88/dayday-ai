export const activityPolicy={
 keywords:['AI','人工智能','大模型','LLM','Agent','智能体'],
 aiPattern:'\\b(?:AI|AGI|LLM|agents?|Claude|Gemini|GPT|robotics)\\b|人工智能|大模型|智能体|机器学习|生成式|机器人|智能硬件|智能可穿戴|GTC|Supercomputing|云栖|AICon|DevDay|DevFest',
 historyDays:180,maxEventsPerSource:24,maxDetails:6,waicDates:3,waicPerDate:5,
 tracked:[
  {id:'devday',name:'OpenAI DevDay',pattern:'DevDay'},
  {id:'yunqi',name:'云栖大会',pattern:'云栖|Apsara'},
  {id:'google-shanghai',name:'Google 上海开发者活动',pattern:'(?:Google|GDG|DevFest).*(?:Shanghai|上海)'},
  {id:'aicon',name:'AICon 系列',pattern:'AICon'},
  {id:'shanghai-ai',name:'ShanghAI AI',pattern:'ShanghAI AI'},
 ],
};
const source=(id,name,url,activityAdapter,extra={})=>({id,name,publisher:id,section:'线下活动',website:url,feed:url,adapter:'activity',activityAdapter,primary:true,filterAI:false,language:'zh',scope:'用户补充活动源',notice:'从主办方或活动平台公开数据核验具体场次；未公布日期不推测',...extra});
export const activitySources=[
 source('waica','WAIC 世界人工智能大会','https://www.worldaic.com.cn/','waic'),
 source('wrc-events','WRC 世界机器人大会','https://www.worldrobotconference.com/news/','wrc',{city:'北京'}),
 source('wic-events','WIC 世界智能产业博览会','https://www.wicongress.org.cn/','wic',{city:'天津'}),
 source('chtf-ai-events','高交会 · AI与机器人产业展','https://www.chtf.com/liaojiegaojiaohui/zynr/benjie/','chtf',{city:'深圳'}),
 source('yunqi-events','云栖大会','https://yunqi.aliyun.com/','yunqi',{city:'杭州',publisher:'alibaba'}),
 source('gaitc-events','GAITC 全球人工智能技术大会','https://gaitc.caai.cn/','gaitc',{city:'杭州'}),
 source('agic-events','AGIC 深圳国际人工智能展','https://www.agicexpo.com/AIHTML/AGICIntro','agic',{city:'深圳'}),
 source('shanghai-ai-events','ShanghAI AI · Meetup','https://www.meetup.com/shanghai-ai/events/','meetup',{city:'上海',publisher:'shanghai-ai'}),
 source('gdg-shanghai-events','GDG 上海开发者社区','https://gdg.community.dev/gdg-shanghai/','gdg',{city:'上海',publisher:'gdg-shanghai',notice:'GDG 独立社区活动；不等同于 Google 公司官方发布会'}),
 source('aicon-events','AICon 系列','https://aicon.infoq.cn/','aicon',{publisher:'infoq'}),
 source('luma-shanghai-events','Luma · 上海 AI 活动','https://luma.com/AIHH-SH','luma',{primary:false,city:'上海',details:['https://luma.com/j9iqfmh8'],notice:'跟踪已核验上海日历和活动原页，不将默认 discover 当作中国活动流'}),
 source('anthropic-events','Anthropic · 官方线上活动','https://www.anthropic.com/events','anthropic',{publisher:'anthropic',section:'线上发布会',language:'en'}),
 source('microsoft-reactor-events','Microsoft Reactor · AI 直播','https://developer.microsoft.com/reactor/api/events?page=1&eventTypes=individualEvents&formats=Livestream&search=AI','reactor',{website:'https://developer.microsoft.com/en-us/reactor/',publisher:'microsoft',section:'线上发布会',language:'en'}),
 source('nvidia-events','NVIDIA · 官方活动','https://www.nvidia.com/content/dam/en-zz/Solutions/about-nvidia/calendar/en-us.json','nvidia',{website:'https://www.nvidia.com/en-us/events/',publisher:'nvidia',language:'en',filterAI:true}),
 source('openai-devday-events','OpenAI DevDay','https://devday.openai.com/','jsonld',{publisher:'openai',section:'线上发布会',language:'en',format:'hybrid',notice:'官方主旨直播与线下活动；若官网限制访问保留失败状态，并由已接通 OpenAI 官方 RSS 补充公告'}),
 source('hackathon-weekly','HackathonWeekly · 黑客松','https://www.hackathonweekly.com/api/events?type=HACKATHON','weekly',{website:'https://www.hackathonweekly.com/',section:'黑客松',primary:false,filterAI:true}),
 source('activity-discovery','AI 活动 · 关键词发现','https://www.hackathonweekly.com/api/events','weekly-search',{website:'https://www.hackathonweekly.com/',section:'线下活动',publisher:'hackathon-weekly',primary:false,filterAI:true,notice:'动态搜索 AI、人工智能、大模型、LLM、Agent、智能体；只采集活动字段，不读取报名者信息'}),
 source('devpost-ai','Devpost · AI 黑客松','https://devpost.com/api/hackathons?search=AI&page=1','devpost',{website:'https://devpost.com/c/artificial-intelligence',section:'黑客松',primary:false,filterAI:true,language:'en',notice:'公开搜索存在限流；提交截止日期与活动举办日期分别记录'}),
 source('hackertrip-ai','HackerTrip · AI 黑客松发现','https://hackertrip.cn/explore?q=AI','hackertrip',{website:'https://hackertrip.cn/',section:'黑客松',primary:false,filterAI:true}),
];

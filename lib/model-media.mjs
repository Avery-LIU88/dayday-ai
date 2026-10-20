export const ARENA_DATASET='lmarena-ai/leaderboard-dataset';
export const mediaSpecs=[
 {id:'arena-image',category:'image',label:'图像生成',name:'图像生成',config:'text_to_image',url:'https://arena.ai/leaderboard/text-to-image'},
 {id:'arena-edit',category:'image',label:'图像编辑',name:'图像编辑',config:'image_edit',url:'https://arena.ai/leaderboard/image-edit'},
 {id:'arena-video',category:'video',label:'文生视频',name:'文生视频',config:'text_to_video',url:'https://arena.ai/leaderboard/text-to-video'},
 {id:'arena-image-video',category:'video',label:'图生视频',name:'图生视频',config:'image_to_video',url:'https://arena.ai/leaderboard/image-to-video'},
];
const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v));
const orgNames={openai:'OpenAI',google:'Google',anthropic:'Anthropic',bytedance:'ByteDance',alibaba:'Alibaba',tencent:'Tencent',kling:'Kuaishou',kuaishou:'Kuaishou',bfl:'Black Forest Labs','black-forest-labs':'Black Forest Labs',blackforestlabs:'Black Forest Labs',ideogram:'Ideogram',recraft:'Recraft',luma:'Luma',runway:'Runway',minimax:'MiniMax',xai:'xAI',zai:'Z.ai'};
export function buildArenaBoard(spec,records,updatedAt){
 const overall=records.filter(r=>r.category==='overall'&&validDate(r.leaderboard_publish_date));
 const published=overall.map(r=>r.leaderboard_publish_date).sort().at(-1);
 const ids=new Set(),rows=[];
 for(const r of overall.filter(r=>r.leaderboard_publish_date===published)){
  if(!r.model_name||numeric(r.rating)===null||!Number.isInteger(r.rank)||r.rank<1)continue;
  if(ids.has(r.model_name))throw Error('Duplicate Arena model');ids.add(r.model_name);
  rows.push({id:r.model_name,name:r.model_name,configuration:r.model_name,organization:orgNames[r.organization?.toLowerCase()]||r.organization||'',score:r.rating,rank:r.rank,releaseDate:null,evaluatedAt:published,logURL:null,intervalLow:numeric(r.rating_lower),intervalHigh:numeric(r.rating_upper),standardError:null,samples:numeric(r.vote_count)});
 }
 if(rows.length<2)throw Error('Incomplete Arena data');
 rows.sort((a,b)=>a.rank-b.rank||b.score-a.score);
 return {id:spec.id,category:spec.category,label:spec.label,name:spec.name,unit:'Arena',metric:'Arena 分',decimals:0,sourceName:'Arena',license:'CC BY 4.0',description:'用户盲测偏好评分，保留原榜排名与模型版本。',url:spec.url,source:'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset',updatedAt,evaluatedAt:published,rows};
}
export function buildSpeechBoard(payload,updatedAt){
 if(!Array.isArray(payload?.rows))throw Error('Invalid TTS data');
 const ids=new Set(),rows=[];
 for(const r of payload.rows){
  if(r.suspended||r.rank===null)continue;
  if(!r.id||!r.name||numeric(r.elo)===null||!Number.isInteger(r.rank)||r.rank<1)continue;
  if(ids.has(r.id))throw Error('Duplicate TTS model');ids.add(r.id);
  let hostname='';try{hostname=new URL(r.url).hostname.replace(/^www\./,'');}catch{}
  rows.push({id:r.id,name:r.name,configuration:r.id,organization:({'inworld.ai':'Inworld','async.ai':'Async','papla.media':'Papla','minimax.io':'MiniMax','hume.ai':'Hume','smallest.ai':'Smallest AI','gradium.ai':'Gradium','fish.audio':'Fish Audio','elevenlabs.io':'ElevenLabs','deepdub.ai':'Deepdub','typecast.ai':'Typecast','cartesia.ai':'Cartesia','openai.com':'OpenAI'}[hostname]||hostname),score:r.elo,rank:r.rank,releaseDate:null,evaluatedAt:null,logURL:null,intervalLow:null,intervalHigh:null,standardError:null,samples:numeric(r.totalVotes),uncertainty:numeric(r.uncertainty),preliminary:Boolean(r.preliminary),available:r.active!==false,modelURL:/^https:\/\//.test(r.url)?r.url:null,sourceIcon:typeof r.icon==='string'&&/^\/logos\/[a-z0-9._-]+$/i.test(r.icon)&&!r.icon.includes('stealth')?r.icon:null});
 }
 if(rows.length<2)throw Error('Incomplete TTS data');
 rows.sort((a,b)=>a.rank-b.rank);
 return {id:'tts-arena',category:'voice',label:'语音合成',name:'语音合成',unit:'BT',metric:'偏好评分',decimals:0,sourceName:'TTS Arena',license:null,description:'语音盲测偏好评分，原榜按置信下界排名，分数不一定逐行递减。',url:'https://huggingface.co/spaces/TTS-AGI/TTS-Arena-V2',source:'https://tts-agi-tts-arena-v2.hf.space/api/leaderboard?type=tts',updatedAt,evaluatedAt:null,rows};
}
async function getJSON(url,fetcher){
 const response=await fetcher(url,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Model media request failed');
 return response.json();
}
export async function fetchArenaRows(config,fetcher=fetch){
 const page=offset=>getJSON('https://datasets-server.huggingface.co/rows?'+new URLSearchParams({dataset:ARENA_DATASET,config,split:'latest',offset:String(offset),length:'100'}),fetcher);
 const first=await page(0),total=first.num_rows_total;
 if(first.partial||!Number.isInteger(total)||total<2||total>3000||!Array.isArray(first.rows))throw Error('Invalid Arena page');
 const pages=[first];
 // /rows avoids the optional search index. Read all pages rather than assume category ordering.
 for(let offset=100;offset<total;offset+=300){
  pages.push(...await Promise.all([offset,offset+100,offset+200].filter(n=>n<total).map(page)));
 }
 if(pages.some(p=>p.partial||p.num_rows_total!==total||!Array.isArray(p.rows))||pages.reduce((n,p)=>n+p.rows.length,0)!==total)throw Error('Incomplete Arena pages');
 return pages.flatMap(p=>p.rows.map(r=>r.row));
}
export async function fetchMediaSnapshot(fetcher=fetch){
 const updatedAt=new Date().toISOString();
 const boards=await Promise.all(mediaSpecs.map(async spec=>buildArenaBoard(spec,await fetchArenaRows(spec.config,fetcher),updatedAt)));
 boards.push(buildSpeechBoard(await getJSON('https://tts-agi-tts-arena-v2.hf.space/api/leaderboard?type=tts',fetcher),updatedAt));
 return {version:1,updatedAt,boards};
}

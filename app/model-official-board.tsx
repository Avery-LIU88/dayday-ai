'use client';
import {useState} from 'react';
import {ExternalLink} from 'lucide-react';
export const officialBoards={
 overall:{label:'综合能力',url:'https://artificialanalysis.ai/embed/llm-leaderboard',source:'https://artificialanalysis.ai/leaderboards/models'},
 image:{label:'图像生成与编辑',url:'https://artificialanalysis.ai/embed/text-to-image-leaderboard/leaderboard/text-to-image',source:'https://artificialanalysis.ai/image/models'},
 video:{label:'视频生成',url:'https://artificialanalysis.ai/embed/text-to-video-leaderboard/leaderboard/text-to-video',source:'https://artificialanalysis.ai/video'},
 voice:{label:'语音合成',url:'https://artificialanalysis.ai/embed/text-to-speech-leaderboard/leaderboard/provider-voice',source:'https://artificialanalysis.ai/text-to-speech/models'},
};
export type OfficialCategory=keyof typeof officialBoards;
export default function OfficialBoard({category}:{category:OfficialCategory}){
 const info=officialBoards[category],[loaded,setLoaded]=useState(false);
 return <div className="official-board"><div className="model-toolbar"><div className="model-benchmark-title"><h2>{info.label}</h2><span>Artificial Analysis</span></div><a href={info.source} target="_blank" rel="noopener noreferrer">打开原榜 <ExternalLink size={14}/></a></div>
 <div className="official-frame-wrap">{!loaded&&<p className="official-loading" role="status">正在载入官方榜单…</p>}<iframe src={info.url} title={`${info.label} · Artificial Analysis 官方榜单`} onLoad={()=>setLoaded(true)} referrerPolicy="strict-origin-when-cross-origin" loading="eager"/></div>
 <footer className="official-footer"><span>官方嵌入页面 · 数据与更新时间以原榜为准</span><a href={info.source} target="_blank" rel="noopener noreferrer">未显示？打开原榜</a></footer>
 {category==='voice'&&<div className="official-more"><a href="https://artificialanalysis.ai/speech-to-text" target="_blank" rel="noopener noreferrer">语音识别原榜 <ExternalLink size={14}/></a></div>}
 </div>;
}

'use client';
import {trendGeometry} from '../lib/event-trends.mjs';
import type {NewsState} from '../lib/news-store';
type Story=NewsState['stories'][number];
const labels={rising:'升温',falling:'回落',steady:'平稳',pending:'趋势积累中'};
const stamp=(at:string)=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
export default function EventTrend({story,expanded=false}:{story:Story;expanded?:boolean}){
 const geometry=trendGeometry(story.trend||[]),direction=geometry.direction as keyof typeof labels;
 return <div className={`heat-trend ${expanded?'trend-expanded':''} trend-${direction}`}><div className="trend-label"><span>热度趋势</span><strong>{labels[direction]}</strong></div>{geometry.points.length>=2?<><svg viewBox="0 0 120 42" role="img" aria-label={`${story.title}的热度趋势：${labels[direction]}，${geometry.points.length}次真实采集记录`} preserveAspectRatio="none"><path d="M4 38H116" className="trend-baseline"/><path d={geometry.path} className="trend-line"/>{geometry.points.map(p=><circle key={p.at} cx={p.x} cy={p.y} r={1.8}><title>{stamp(p.at)} · 去重报道热度 {p.heat} 个独立信源</title></circle>)}</svg>{expanded&&<div className="trend-times"><time>{stamp(geometry.points[0].at)}</time><time>{stamp(geometry.points.at(-1)!.at)}</time></div>}</>:<div className="trend-empty"><span className="pending-dot"/><span>{expanded?'至少两次完整采集后显示折线':'等待更多采集记录'}</span></div>}{expanded&&<p className="trend-note">北京时间每天08:00、20:00采集。曲线记录独立发布者数的变化，不代表社媒互动量；缺失记录不补画。</p>}</div>;
}

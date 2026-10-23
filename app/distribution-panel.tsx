import {Rss,Code2,Plug,FileText,ExternalLink} from 'lucide-react';
export default function DistributionPanel(){
 return <div className="distribution-grid">
  <section className="subscription-box"><h2><Rss size={21}/> RSS 订阅</h2><p>把事件、日报或周报添加到你的阅读器。</p><div className="distribution-links"><a href="/rss.xml" target="_blank" rel="noopener noreferrer">全部事件 <ExternalLink size={15}/></a><a href="/rss.xml?kind=daily" target="_blank" rel="noopener noreferrer">日报 <ExternalLink size={15}/></a><a href="/rss.xml?kind=weekly" target="_blank" rel="noopener noreferrer">周报 <ExternalLink size={15}/></a></div></section>
  <section className="subscription-box"><h2><Code2 size={21}/> 公开 API</h2><p>读取已发布事件和简报，无需注册。</p><code>GET /api/v1/events</code><div className="distribution-links"><a href="/api/v1" target="_blank" rel="noopener noreferrer">接口说明 <ExternalLink size={15}/></a><a href="/api/v1/events" target="_blank" rel="noopener noreferrer">查看数据 <ExternalLink size={15}/></a></div></section>
  <section className="subscription-box"><h2><Plug size={21}/> MCP</h2><p>在 ChatGPT / Codex 中连接 DayDay AI 个人插件，让 Agent 查询事件和简报。</p><code>POST /mcp</code><div className="distribution-links"><a href="/api/v1" target="_blank" rel="noopener noreferrer">工具说明 <ExternalLink size={15}/></a></div></section>
  <section className="subscription-box"><h2><FileText size={21}/> llms.txt</h2><p>给 Agent 的网站说明与数据入口。</p><div className="distribution-links"><a href="/llms.txt" target="_blank" rel="noopener noreferrer">阅读说明 <ExternalLink size={15}/></a></div></section>
 </div>;
}

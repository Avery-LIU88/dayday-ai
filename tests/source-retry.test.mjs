import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAnthropic,parseChangelog,parseProductUpdates,parsePublisherList,parseOfficialPost,parsePostListing,collectSource} from '../lib/news-collector.mjs';
import {subscriptionRead} from '../lib/subscriptions.mjs';

test('Anthropic cards and table rows keep neighbouring dates isolated and include root release links',()=>{
 const html='<article><header><a href="/news/announcements">Category</a><time>Oct 7, 2026</time></header><a href="/claude-test"><h2>Release AI model</h2><p>Model summary</p></a></article>'+
 '<li data-listing-row="real-id"><a href="/news/next"><span>Preview</span></a><time>Oct 8, 2026</time><a href="/news/next"><h3>Research</h3></a></li>'+
 '<article><a href="/news/undated"><h3>Undated news</h3></a></article>';
 const rows=parseAnthropic(html,{id:'anthropic',website:'https://www.anthropic.com/news'});
 assert.deepEqual(rows.map(x=>[x.title,x.publishedAt]),[['Release AI model','2026-10-07T00:00:00.000Z'],['Research','2026-10-08T00:00:00.000Z']]);
 assert.equal(rows[0].url,'https://www.anthropic.com/claude-test');
});
test('Z.ai ordinary Markdown date sections preserve independent titles and historic years',()=>{
 const markdown='# New Released\n**2026-08-26**\n\nGLM A\n\n* First [docs](/one)\n\n**2025-12-31**\n\nGLM B\n\n* Second\n';
 const rows=parseProductUpdates(markdown,{adapter:'zai-updates',website:'https://docs.z.ai/release-notes/new-released'});
 assert.deepEqual(rows.map(x=>x.title),['GLM A','GLM B']);assert.equal(rows[1].publishedAt,'2025-12-31T00:00:00.000Z');
 assert.equal(rows[0].summary,'First docs');assert.equal(rows[1].summary,'Second');
});
test('machine news list uses official dates and never fetches a login-only article body',async()=>{
 const s={id:'jiqi',name:'机器之心',adapter:'jiqi-list',website:'https://www.jiqizhixin.com',feed:'https://www.jiqizhixin.com/industry'};
 let calls=0;
 const result=await collectSource(s,async()=>{calls++;return new Response('<article><a class="article-item__title" href="/articles/a">AI News</a><time datetime="2026-10-23 19:22:29 +0800"></time></article>');});
 assert.equal(calls,1);assert.equal(result.items[0].publishedAt,'2026-10-23T11:22:29.000Z');assert.equal(result.items[0].summary,'');
});
test('SJTU external original links are retained but collection dates cannot fill missing publication dates',()=>{
 const card=(url,date)=>`<a href="${url}" class="pd"><div class="h3">AI research</div><em>${date}</em></a>`;
 const rows=parsePublisherList(card('https://mp.weixin.qq.com/s/public','2026-07-30')+card('https://example.com/unrelated','2026-07-31')+card('/undated',''),{adapter:'sjtu-list',website:'https://soai.sjtu.edu.cn/cn/news/kydt'});
 assert.equal(rows.length,1);assert.equal(rows[0].publishedAt,'2026-07-29T16:00:00.000Z');assert.equal(rows[0].url,'https://mp.weixin.qq.com/s/public');
});
test('Baidu news dates are explicit China time and query IDs survive',()=>{
 const rows=parsePublisherList('<div class="ai-newscenter-news"><a href="/support/news?action=detail&amp;id=8" class="ai-newscenter-news-title">AI update</a><span class="ai-newscenter-news-time">2026-10-19 09:10</span><div class="ai-newscenter-news-desc">Public summary</div></div>',{adapter:'baidu-news',website:'https://ai.baidu.com/support/news'});
 assert.equal(rows[0].publishedAt,'2026-10-19T01:10:00.000Z');assert.equal(new URL(rows[0].url).searchParams.get('id'),'8');
});
test('podcast content negotiation accepts application/xml required by Ximalaya',async()=>{
 const xml='<rss><channel><title>声动早咖啡</title></channel></rss>';
 const result=await subscriptionRead('https://www.ximalaya.com/album/51076156.xml',async(_url,options)=>options.headers.Accept.includes('application/xml')?new Response(xml,{headers:{'Content-Type':'application/xml'}}):new Response('Not acceptable',{status:406}));
 assert.equal(result,xml);
});
test('official repository fallback uses published frontmatter, rejects drafts and avoids guessed website links',async()=>{
 const s={id:'sail',name:'Stanford AI',adapter:'github-posts',feed:'https://api.github.com/repos/StanfordVL/sail-blog/contents/_posts?ref=source',repositoryPage:'https://github.com/StanfordVL/sail-blog',repositoryBranch:'source',rawPrefix:'https://raw.githubusercontent.com/StanfordVL/sail-blog/source/_posts/',maxArticles:1};
 const file={name:'2026-10-16-tracer.md',html_url:s.repositoryPage+'/blob/source/_posts/2026-10-16-tracer.md',download_url:s.rawPrefix+'2026-10-16-tracer.md'};
 const text='---\nlayout: post\ntitle: "AI research"\nsummary: "Public summary"\n---\nFull article must not be stored.';
 const row=parseOfficialPost(text,file,s);assert.equal(row.publishedAt,'2026-10-16T00:00:00.000Z');assert.equal(row.url,file.html_url);assert.equal(row.summary,'Public summary');
 assert.equal(parseOfficialPost(text.replace('layout: post','published: false'),file,s),null);
 assert.equal(parseOfficialPost(text,{...file,html_url:'https://unrelated.example/article'},s),null);
 const calls=[];const result=await collectSource(s,async url=>{calls.push(url);return url===s.feed?Response.json([{...file,name:'2026-10-17-other.md',download_url:'https://unrelated.example/body'},file]):new Response(text);});
 assert.deepEqual(calls,[s.feed,file.download_url]);assert.equal(result.items.length,1);assert.ok(!JSON.stringify(result).includes('Full article'));
});
test('DeepSeek localized changelog dates and anchors remain publisher-provided',()=>{
 const rows=parseChangelog('<h2 id="时间-2026-10-17">时间: 2026-10-17</h2><h3>发布搜索 API</h3><p>官方说明</p><h2 id="时间-2026-09-10">时间: 2026-09-10</h2><h3>发布模型</h3>',{website:'https://api-docs.deepseek.com/zh-cn/updates/'});
 assert.equal(rows.length,2);assert.equal(rows[0].publishedAt,'2026-10-17T00:00:00.000Z');assert.match(decodeURI(rows[0].url),/#时间-2026-10-17$/);
});
test('GitHub web listing selects only dated files from the configured public branch',()=>{
 const s={repositoryPage:'https://github.com/StanfordVL/sail-blog',repositoryBranch:'source',rawPrefix:'https://raw.githubusercontent.com/StanfordVL/sail-blog/source/_posts/'};
 const wrap=branch=>'<script type="application/json">'+JSON.stringify({payload:{codeViewTreeRoute:{path:'_posts',refInfo:{name:branch},tree:{items:[{name:'2026-10-16-tracer.md',path:'_posts/2026-10-16-tracer.md',contentType:'file'},{name:'2026-10-17-other.md',path:'../outside',contentType:'file'}]}}}})+'</script>';
 const list=parsePostListing(wrap('source'),s);assert.equal(list.length,1);assert.equal(list[0].download_url,s.rawPrefix+list[0].name);assert.throws(()=>parsePostListing(wrap('master'),s));
});

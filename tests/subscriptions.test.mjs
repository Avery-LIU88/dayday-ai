import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {allowedFeed,subscriptionRead,resolveShow,showFromFeed,encryptBot,decryptBot,deliveryDue,defaultReminderPreferences,briefText} from '../lib/subscriptions.mjs';

const feed='https://feeds.simplecast.com/test';
const xml=`<rss><channel><title>AI Podcast</title><item><title>Episode</title><link>https://example.org/episode</link><pubDate>2026-09-01T08:00:00Z</pubDate><description>Real summary</description></item></channel></rss>`;
test('feed and redirect validation blocks private and untrusted destinations before a request',async()=>{
 for(const u of ['http://127.0.0.1/rss','http://169.254.169.254/rss','https://feeds.simplecast.com.evil.test/rss'])assert.equal(allowedFeed(u),false);
 let calls=0;await assert.rejects(subscriptionRead(feed,async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});}),/暂不支持/);assert.equal(calls,1);
 assert.throws(()=>allowedFeed('https://user:pass@feeds.simplecast.com/test'));
});
test('Apple resolves feed through lookup and keeps actual episode date',async()=>{
 const calls=[];
 const result=await resolveShow('https://podcasts.apple.com/cn/podcast/name/id123',[],async u=>{calls.push(u);return u.includes('/lookup')?Response.json({results:[{collectionId:123,feedUrl:feed,collectionViewUrl:'https://podcasts.apple.com/cn/podcast/id123'}]}):new Response(xml);});
 assert.equal(calls.length,2);assert.equal(result.show.name,'AI Podcast');assert.equal(result.episodes[0].publishedAt,'2026-09-01T08:00:00.000Z');assert.equal(result.episodes[0].kind,'episode');
});
test('YouTube handles resolve to channel feed; a single video is rejected',async()=>{
 const id='UCabcdefghijklmnopqrstuv',calls=[];
 const result=await resolveShow('https://www.youtube.com/@example',[],async u=>{calls.push(u);return new Response(u.includes('/feeds/')?xml:`{"externalId":"${id}"}`);});
 assert.equal(result.show.platform,'YouTube');assert.equal(calls[1],`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
 await assert.rejects(resolveShow('https://youtube.com/watch?v=123'),/频道主页/);
});
test('invalid/empty feeds never become followed shows',async()=>{
 await assert.rejects(showFromFeed(feed,{},async()=>new Response('<html>blocked</html>')));
 await assert.rejects(showFromFeed(feed,{},async()=>new Response('<rss><channel><title>Empty</title></channel></rss>')),/有效日期/);
});
test('robot credentials are encrypted with fresh nonce and detect tampering',async()=>{
 const key='a'.repeat(64),bot={webhook:'https://open.feishu.cn/open-apis/bot/v2/hook/test',secret:'test-secret'};
 const a=await encryptBot(bot,key),b=await encryptBot(bot,key);assert.notEqual(a,b);assert.equal(a.includes(bot.secret),false);assert.deepEqual(await decryptBot(a,key),bot);
 const x=JSON.parse(a);x.data[0]^=1;await assert.rejects(decryptBot(JSON.stringify(x),key));
});
test('quiet hours, daily clock and Monday weekly clock use Beijing time',()=>{
 const p={...defaultReminderPreferences,enabled:true,daily:true,weekly:true};
 assert.equal(deliveryDue(p,'episode',new Date('2026-10-19T15:00Z')),false);
 assert.equal(deliveryDue(p,'weekly',new Date('2026-10-19T00:00Z')),true);
 assert.equal(deliveryDue(p,'weekly',new Date('2026-10-20T00:00Z')),false);
 assert.equal(deliveryDue(p,'daily',new Date('2026-10-19T23:59Z')),false);
});
test('brief uses real records within period and ignores future records',()=>{
 const now=new Date('2026-10-20T08:00Z'),stories=[{title:'Current',source:'Source',score:10,publishedAt:'2026-10-20T00:00Z',url:'https://example.org/1'},{title:'Old',score:100,publishedAt:'2026-10-01T00:00Z'},{title:'Future',score:100,publishedAt:'2026-10-21T00:00Z'}];
 const text=briefText(stories,'daily',now);assert.match(text,/Current/);assert.doesNotMatch(text,/Old|Future/);
});

test('database flow isolates readers, skips history, deduplicates delivery and sends exact preview',async()=>{
 // Exercise production store SQL against SQLite, substituting only external services.
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0000_nostalgic_grim_reaper.sql','0001_mixed_selene.sql']){
  // Resolve the initial migration by filename because starter names can differ.
  let file=name;
  if(name.startsWith('0000')){const {readdir}=await import('node:fs/promises');file=(await readdir(new URL('../drizzle/',import.meta.url))).find(x=>x.startsWith('0000')&&x.endsWith('.sql'));}
  sql.exec(await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 }
 const D1={prepare(query){const statement=sql.prepare(query);let values=[];const p={bind(...v){values=v;return p;},async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};},async run(){const x=statement.run(...values);return {meta:{changes:Number(x.changes)}};}};return p;},async batch(batch){return Promise.all(batch.map(x=>x.run()));}};
 globalThis.__subscriptionsTestEnv={DB:D1,REMINDER_ENCRYPTION_KEY:'b'.repeat(64)};
 let text=await readFile(new URL('../lib/subscription-store.ts',import.meta.url),'utf8');
 text=text.replace("import {env} from 'cloudflare:workers';","const env=globalThis.__subscriptionsTestEnv;").replace("import catalog from '../data/catalog.json';","const catalog=[];").replace("import {publicState} from './news-store';","const publicState=async()=>({stories:[]});").replace(/from '(\.\/[^']+\.mjs)'/g,(_,p)=>`from '${new URL('../lib/'+p.slice(2),import.meta.url).href}'`);
 const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const store=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const originalFetch=globalThis.fetch,sent=[];
 globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://open.feishu.cn/')){sent.push(JSON.parse(options.body).content.text);return Response.json({code:0});}return new Response(xml);};
 try{
  const request=token=>new Request('https://example.org/api/subscriptions',{headers:{authorization:'Bearer '+token}});
  const a=await store.readerId(request('a'.repeat(64))),b=await store.readerId(request('b'.repeat(64)));
  await store.limitAction(request('a'.repeat(64)),a);await store.limitAction(request('b'.repeat(64)),b);
  const resolved=await store.resolveAndSave(feed);await store.follow(a,resolved.show.id,true,'digest');
  assert.equal((await store.subscriptionState(a)).shows.length,1);assert.equal((await store.subscriptionState(b)).shows.length,0);
  await assert.rejects(store.refreshFollowed(b,resolved.show.id),/尚未关注/);
  await store.connectBot(a,'https://open.feishu.cn/open-apis/bot/v2/hook/test','');
  await store.configure(a,{...defaultReminderPreferences,enabled:true,quiet:false,time:'00:00'});
  const state=await store.subscriptionState(a);assert.equal(state.connected,true);assert.equal((await store.subscriptionState(b)).connected,false);assert.equal(JSON.stringify(state).includes('/hook/'),false);
  const run=async()=>{for(let i=0;i<10;i++){const r=await store.runSubscriptionJob();if(r.complete)return;}throw Error('job did not finish');};
  await run();assert.equal(sent.length,0,'initial history must not alert');
  sql.prepare('UPDATE subscriptions SET followed_at=? WHERE reader_id=?').run(new Date(Date.now()-3600000).toISOString(),a);
  const addEpisode=n=>{const date=new Date(Date.now()-1000).toISOString(),entry={...resolved.episodes[0],id:'new-'+n,title:'New '+n,publishedAt:date};sql.prepare("INSERT INTO entries(id,kind,source_id,published_at,discovered_at,data) VALUES(?,'episode',?,?,?,?)").run(entry.id,resolved.show.id,date,date,JSON.stringify(entry));};
  addEpisode(1);await run();assert.equal(sent.length,1);
  addEpisode(2);await run();assert.equal(sent.length,1,'daily digest cannot repeat later that day');
  await store.follow(a,resolved.show.id,true,'instant');await run();assert.equal(sent.length,2);await run();assert.equal(sent.length,2,'same episode must not send again');
  const preview=await store.preparePreview(a,'episodes');addEpisode(3);await store.sendPreview(a,'episodes');assert.equal(sent.at(-1),preview.text,'manual send must equal preview');
  await store.disconnectBot(a);assert.equal((await store.subscriptionState(a)).preferences.enabled,false);
  await store.follow(a,resolved.show.id,false);assert.equal((await store.subscriptionState(a)).shows.length,0);
 }finally{globalThis.fetch=originalFetch;sql.close();delete globalThis.__subscriptionsTestEnv;}
});

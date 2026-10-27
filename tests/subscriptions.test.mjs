import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {allowedFeed,subscriptionRead,resolveShow,showFromFeed,encryptBot,decryptBot,chinaTime,normalizedReminderPreferences,defaultReminderPreferences,briefText} from '../lib/subscriptions.mjs';

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
test('known Apple program IDs work across locale, slug and query variants without lookup',async()=>{
 const known=[{kind:'podcast',name:'AI Podcast',feed,appleUrl:'https://podcasts.apple.com/us/podcast/ai-podcast/id123?uo=4'}];
 const result=await resolveShow('https://podcasts.apple.com/cn/podcast/id123?i=987',known,async url=>{assert.equal(url,feed);return new Response(xml);});
 assert.equal(result.show.name,'AI Podcast');
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
test('nightly preferences migrate legacy selections without turning on new categories silently',()=>{
 assert.deepEqual(chinaTime(new Date('2026-10-24T13:00:00Z')),{day:'2026-10-24',time:'21:00',hour:21,weekday:6});
 assert.deepEqual(normalizedReminderPreferences({enabled:true,episodes:true,daily:false,weekly:true}),{version:2,enabled:true,episodes:true,activities:false,hot:false});
 assert.equal(defaultReminderPreferences.enabled,false);
});
test('brief uses the published edition without reselecting or reranking stories',()=>{
 const state={stories:[{title:'Unpublished',score:100}],daily:[{date:'2026-10-20',articles:[]},{date:'2026-10-19',articles:[{id:'a',title:'Published',source:'Source',summary:'Derived points',url:'https://example.org/1'}]}]};
 const text=briefText(state,'daily');assert.match(text,/Published/);assert.match(text,/2026-10-19/);assert.doesNotMatch(text,/Unpublished|2026-10-20/);
});

test('daily and hourly delivery stay independent, drain all parts, respect preferences and never resend',async()=>{
 const sql=new DatabaseSync(':memory:');
 const {readdir}=await import('node:fs/promises');
 for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())sql.exec(await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const D1={prepare(query){const statement=sql.prepare(query);let values=[];const p={bind(...v){values=v;return p;},async first(){return statement.get(...values)||null;},async all(){return {results:statement.all(...values)};},async run(){const x=statement.run(...values);return {meta:{changes:Number(x.changes)}};}};return p;},async batch(batch){return Promise.all(batch.map(x=>x.run()));}};
 globalThis.__subscriptionsTestEnv={DB:D1,REMINDER_ENCRYPTION_KEY:'b'.repeat(64)};
 let text=await readFile(new URL('../lib/subscription-store.ts',import.meta.url),'utf8');
 text=text.replace("import {env} from 'cloudflare:workers';","const env=globalThis.__subscriptionsTestEnv;").replace("import catalog from '../data/catalog.json';","const catalog=[];").replace("import podcastLinks from '../data/podcast-links.json';","const podcastLinks={shows:[]};").replace("import {publicState} from './news-store';","const publicState=async()=>globalThis.__subscriptionsPublication||({stories:[],hot:[],activities:[],daily:[],weekly:[]});").replace(/from '(\.\.?\/[^']+\.mjs)'/g,(_,p)=>`from '${new URL('../lib/'+p,import.meta.url).href}'`);
 const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const store=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const {deliveryPolicy}=await import('../config/delivery.mjs');const oldDelay=deliveryPolicy.minSendIntervalMs;deliveryPolicy.minSendIntervalMs=0;
 const originalFetch=globalThis.fetch,sent=[];let receipt={code:0};
 globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://open.feishu.cn/')){sent.push(JSON.parse(options.body).content.text);return Response.json(receipt);}return new Response(xml);};
 const set=(key,value)=>sql.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 const publication=(runId,hot=[],activities=[])=>{const value={runId,publishedAt:new Date().toISOString(),hot,activities};set('nightly_update',{day:runId,phase:'subscriptions'});set('nightly_publication',value);globalThis.__subscriptionsPublication=value;};
 let pollTime=new Date();pollTime.setUTCMinutes(0,0,0);
 const poll=async()=>{for(let i=0;i<100;i++){const r=await store.runEpisodeJob(pollTime);if(r.complete)return r;assert.equal(r.busy,undefined);}throw Error('episode job did not finish');};
 const run=async()=>{for(let i=0;i<100;i++){const r=await store.runSubscriptionJob();if(r.complete)return;assert.equal(r.blocked,undefined);}throw Error('job did not finish');};
 try{
  const request=token=>new Request('https://example.org/api/subscriptions',{headers:{authorization:'Bearer '+token}});
  const a=await store.readerId(request('a'.repeat(64))),b=await store.readerId(request('b'.repeat(64)));
  await store.limitAction(request('a'.repeat(64)),a);await store.limitAction(request('b'.repeat(64)),b);
  const resolved=await store.resolveAndSave(feed);await store.follow(a,resolved.show.id,true,'instant');
  assert.equal((await store.subscriptionState(a)).shows.length,1);assert.equal((await store.subscriptionState(b)).shows.length,0);
  await assert.rejects(store.refreshFollowed(b,resolved.show.id),/尚未关注/);
  await store.connectBot(a,'https://open.feishu.cn/open-apis/bot/v2/hook/test','');
  await store.configure(a,{...defaultReminderPreferences,enabled:true});
  const state=await store.subscriptionState(a);assert.equal(state.connected,true);assert.equal(JSON.stringify(state).includes('/hook/'),false);
  assert.equal((await store.runSubscriptionJob()).blocked,true);assert.equal(sent.length,0);
  const partial=await store.runEpisodeJob(pollTime);assert.equal(partial.complete,false);
  // An unfinished slot resumes even if the next timer fires before completion.
  pollTime=new Date(pollTime.getTime()+60*60000);const resumed=await poll();assert.equal(resumed.runId,partial.runId);
  await poll();assert.equal(sent.length,0,'polling works without nightly publication, but history must not alert');
  assert.equal((await store.runEpisodeJob(new Date(pollTime.getTime()+30*60000))).alreadyCompleted,true,'a second call in the same hour must skip');
  publication('round-1');await run();assert.equal(sent.length,0,'initial history must not alert');
  sql.prepare('UPDATE subscriptions SET followed_at=? WHERE reader_id=?').run(new Date(Date.now()-3600000).toISOString(),a);
  for(let n=0;n<230;n++){
   const at=new Date(Date.now()-1000).toISOString(),e={...resolved.episodes[0],id:'new-'+n,title:'New '+n+' '+('节目'.repeat(60)),publishedAt:at};
   sql.prepare("INSERT INTO entries(id,kind,source_id,published_at,discovered_at,data) VALUES(?,'episode',?,?,?,?)").run(e.id,resolved.show.id,at,at,JSON.stringify(e));
  }
  const event=id=>({id,title:id,source:'Official',url:'https://example.org/'+id,takeaway:'提炼要点',why:'重要新进展'});
  const hot=[event('rank-one'),event('rank-two')],activities=[{...event('conference'),activity:{date:'2030-10-24',location:'线上',url:'https://example.org/event'}}];
  const nightlyBefore=sent.length;publication('round-2',hot,activities);await run();
  assert.equal(sent.length,nightlyBefore+1,'daily sections combine into one message');
  assert.match(sent.at(-1),/【今日热点】/);assert.match(sent.at(-1),/【活动提醒】/);assert.doesNotMatch(sent.at(-1),/我的关注更新/);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM notices WHERE kind='episodes'").get().n,0,'nightly must not dispatch episodes');
  const dailyText=sent.at(-1);
  // Even a blocked nightly pipeline must not delay new episodes.
  set('nightly_update',{day:'round-2',phase:'news'});
  pollTime=new Date(pollTime.getTime()+60*60000);await poll();
  assert.equal((await store.subscriptionJobStatus()).episodes.phase,'complete');
  assert.ok(sent.slice(nightlyBefore+1).every(text=>text.includes('我的关注更新')&&!text.includes('今日热点')));
  set('nightly_update',{day:'round-2',phase:'complete'});
  assert.ok(sent.length>3,'no cap of three messages per nightly run');
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM notices WHERE kind='episodes' AND status='sent'").get().n,230,'all DB pages must drain');
  assert.ok(dailyText.indexOf('rank-one')<dailyText.indexOf('rank-two'));
  const before=sent.length;await run();await poll();assert.equal(sent.length,before);
  publication('round-3',[hot[1],hot[0]],activities);await run();assert.equal(sent.length,before,'same events do not resend on a new day or different rank');
  publication('round-4',[event('follow-up')]);await run();assert.equal(sent.length,before+1,'new material follow-up is delivered');
  receipt={code:19021};publication('round-5',[event('failed')]);await run();const failed=sent.length;await run();assert.equal(sent.length,failed,'failed receipt is retained, never reported sent or looped');
  assert.equal(sql.prepare("SELECT status FROM notices WHERE kind='daily' ORDER BY rowid DESC LIMIT 1").get().status,'failed');
  receipt={code:0};const preview=await store.preparePreview(a,'hot');globalThis.__subscriptionsPublication.hot[0].title='Changed after preview';
  await store.sendPreview(a,'hot');assert.equal(sent.at(-1),preview.text,'manual send matches exactly previewed content');
  // A new episode is not sent while muted, or when the category is disabled.
  const at=new Date(Date.now()-500).toISOString(),latest={...resolved.episodes[0],id:'muted-new',publishedAt:at};
  sql.prepare("INSERT INTO entries(id,kind,source_id,published_at,discovered_at,data) VALUES(?,'episode',?,?,?,?)").run(latest.id,resolved.show.id,at,at,JSON.stringify(latest));
  await store.follow(a,resolved.show.id,true,'off');let quietCount=sent.length;
  pollTime=new Date(pollTime.getTime()+60*60000);await poll();assert.equal(sent.length,quietCount);
  await store.follow(a,resolved.show.id,true,'instant');await store.configure(a,{...defaultReminderPreferences,enabled:true,episodes:false});
  pollTime=new Date(pollTime.getTime()+60*60000);await poll();assert.equal(sent.length,quietCount);
  set('subscription_job_lock',Date.now()+60000);assert.equal((await store.runEpisodeJob(pollTime)).busy,true);assert.equal((await store.runSubscriptionJob()).busy,true);sql.prepare("DELETE FROM settings WHERE key='subscription_job_lock'").run();
  set('scheduler_owner_episodes','cloudflare');
  assert.equal((await store.runEpisodeJob(pollTime)).skipped,true,'legacy executor must stop after ownership handoff');
  assert.equal((await store.runEpisodeJob(pollTime,{owner:'cloudflare',expectedRunId:pollTime.toISOString()})).alreadyCompleted,true);
  const older=new Date(pollTime.getTime()-3600000);
  assert.equal((await store.runEpisodeJob(older,{owner:'cloudflare',expectedRunId:older.toISOString()})).reason,'superseded','old workflow replay cannot open an older slot');
  set('episode_poll_run',{id:older.toISOString(),phase:'readers',cursor:'',checked:1,failed:0,sent:0,startedAt:older.toISOString()});
  assert.equal((await store.runEpisodeJob(pollTime,{owner:'cloudflare',expectedRunId:pollTime.toISOString()})).reason,'previous_run_pending');
  set('scheduler_owner_episodes','legacy');
  await store.disconnectBot(a);assert.equal((await store.subscriptionState(a)).preferences.enabled,false);
 }finally{globalThis.fetch=originalFetch;deliveryPolicy.minSendIntervalMs=oldDelay;sql.close();delete globalThis.__subscriptionsTestEnv;delete globalThis.__subscriptionsPublication;}
});


test('show artwork comes from channel metadata, never episode artwork',async()=>{
 const channel=xml.replace('<item>','<itunes:image href="https://images.example.org/show.jpg?a=1&amp;b=2"/><item><itunes:image href="https://images.example.org/episode.jpg"/>');
 const result=await showFromFeed(feed,{},async()=>new Response(channel));
 assert.equal(result.show.artwork,'https://images.example.org/show.jpg?a=1&b=2');
 assert.equal(result.episodes[0].artwork,result.show.artwork);
 const episodeOnly=xml.replace('<item>','<item><itunes:image href="https://images.example.org/episode.jpg"/>');
 assert.equal((await showFromFeed(feed,{},async()=>new Response(episodeOnly))).show.artwork,'');
 const unsafe=xml.replace('<item>','<itunes:image href="javascript:alert(1)"/><item>');
 assert.equal((await showFromFeed(feed,{artwork:'https://images.example.org/fallback.jpg'},async()=>new Response(unsafe))).show.artwork,'https://images.example.org/fallback.jpg');
});
test('Apple artwork is retained when feed has no cover',async()=>{
 const result=await resolveShow('https://podcasts.apple.com/cn/podcast/id123',[],async u=>u.includes('/lookup')?Response.json({results:[{collectionId:123,feedUrl:feed,artworkUrl600:'https://images.example.org/apple.jpg'}]}):new Response(xml));
 assert.equal(result.show.artwork,'https://images.example.org/apple.jpg');
});
test('YouTube channel avatar survives refresh and unavailable artwork does not block episodes',async()=>{
 const id='UCabcdefghijklmnopqrstuv',calls=[];
 const result=await resolveShow('https://www.youtube.com/@example',[],async u=>{calls.push(u);return new Response(u.includes('/feeds/')?xml:`<meta content="https://images.example.org/channel.jpg" property="og:image">{"externalId":"${id}"}`);});
 assert.equal(result.show.artwork,'https://images.example.org/channel.jpg');assert.equal(calls.length,2);
 const refreshed=await showFromFeed(result.show.feed,result.show,async u=>{assert.ok(u.includes('/feeds/'));return new Response(xml);});
 assert.equal(refreshed.show.artwork,result.show.artwork);
 const unavailable=await showFromFeed(result.show.feed,{platform:'YouTube'},async u=>u.includes('/feeds/')?new Response(xml):new Response('',{status:503}));
 assert.equal(unavailable.show.artwork,'');assert.equal(unavailable.episodes.length,1);
});

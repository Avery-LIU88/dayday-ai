import test from 'node:test';
import assert from 'node:assert/strict';
import {itemCard,cardSummary,deliveryParts,dailyDeliveryParts,dailyNoticeId} from '../lib/delivery-content.mjs';
const item={id:'one',title:'模型版本发布',source:'官方博客',publishedAt:'2026-10-28T13:00:00Z',takeaway:'模型版本发布。支持 2.5 亿参数，开放权重。可在本地部署。第三句不展示。',url:'https://example.org/original?source=rss'};
test('one item produces one compact card with source, Beijing publication time, two non-title sentences and a safe button',()=>{
 const {message,text}=itemCard(item,'hot');
 assert.equal(message.msg_type,'interactive');assert.equal(message.card.header.title.content,item.title);
 assert.equal(message.card.elements[0].elements[0].content,'官方博客 · 2026-10-28 21:00（北京时间）');
 assert.equal(cardSummary(item),'支持 2.5 亿参数，开放权重。 可在本地部署。');
 assert.equal(message.card.elements.find(e=>e.tag==='action').actions[0].url,item.url);
 assert.doesNotMatch(text,/https?:|第三句/);
 assert.equal(message.card.elements.find(e=>e.tag==='action').actions[0].text.content,'阅读原文');
});
test('untrusted HTML, links and mentions stay inert, and long titles or missing dates do not break the template',()=>{
 const result=itemCard({...item,title:'长标题'.repeat(50),takeaway:'<script>bad()</script>说明。<at id=all>所有人</at> [详情](https://evil.test) https://evil.test',url:'javascript:alert(1)',publishedAt:'invalid'},'episodes');
 assert.ok([...result.message.card.header.title.content].length<=41);
 assert.doesNotMatch(result.text,/<script|<at|https?:|bad\(\)|Invalid Date/);
 assert.match(result.text,/发布时间未提供/);assert.equal(result.message.card.elements.some(e=>e.tag==='action'),false);
 assert.equal(cardSummary({...item,takeaway:item.title,summary:item.title}),'暂无摘要，点击阅读原文查看。');
});
test('activity cards retain schedule and location, format deadline and keep unchanged dedup IDs and ordering',()=>{
 const activity={...item,id:'activity',activity:{date:'2026-11-02',location:'上海',registrationDeadline:'2026-11-01T00:00:00Z',url:'https://example.org/event',originalUrl:'https://example.org/register',format:'offline'}};
 const result=itemCard(activity,'activities');assert.match(result.text,/2026-11-02/);assert.match(result.text,/上海/);assert.match(result.text,/报名截止：2026\/11\/01 08:00 北京时间/);assert.doesNotMatch(result.text,/T00:00:00/);
 assert.equal(result.message.card.elements.find(e=>e.tag==='action').actions[0].url,activity.activity.originalUrl);
 const parts=dailyDeliveryParts({hot:[item,{...item,id:'second'}],activities:[activity]},Date.parse('2026-10-28T13:00:00Z'));
 assert.deepEqual(parts.map(p=>p.ids),[['hot:one'],['hot:second'],[dailyNoticeId('activities',activity,Date.parse('2026-10-28T13:00:00Z'))]]);
 assert.deepEqual(deliveryParts([item],'episodes')[0].ids,['one']);
});

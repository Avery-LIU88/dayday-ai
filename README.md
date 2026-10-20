# 知更 AI

个人 AI 信息站：真实 RSS 资讯、日 / 周简报、主题检索、收藏、播客发现与关注，以及固定飞书群更新提醒。

## 当前交付

- React / TypeScript，Vinext 服务端渲染；Sites 私密部署。
- D1 保存关注、收藏、提醒设置、内容、运行记录和发送回执。
- 公开 RSS / Atom 采集，来源与发布时间可追溯；简介保留源站原文。
- 日报按北京时间自然日编排，周报覆盖所选日期向前七天，各展示最新 12 条。
- 节目通过 Apple 目录核实订阅地址，一节目一个主 RSS，跳转原平台收听。
- 签名飞书 Webhook、夜间免打扰、逐节目提醒偏好、持久化防重复发送。
- 未接入大模型自动翻译、语义去重或 AI 评分。当前主题按关键词归类，资讯按时间排序。
- 未包含模型排行榜、私密群采集、付费全文抓取和多用户隔离。使用参考 AIHOT 的产品逻辑，当前代码为独立实现。

## 本地运行

需要 Node.js 22.13+。

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_elite_naoko.sql
npm run dev -- --hostname 127.0.0.1
```

仅首次运行时应用本地迁移，不要对已有库重复执行。默认地址为 http://127.0.0.1:5173 。点击「登录空间」可使用 starter 提供的本地测试身份。正式环境使用 Sites 登录与私密访问策略。

## 验证

```sh
npx tsc --noEmit
node --test tests/core.test.mjs
# 先启动本地 dev server；该测试恢复原关注、收藏和偏好，且不会发飞书消息
node scripts/smoke.mjs
```

## 信息源

`data/catalog.json` 是核实后的信源目录；`data/seed.json` 是初次采集的真实内容快照，为首次访问提供内容。运行 `node scripts/collect-seed.mjs` 可重新核实示范节目并刷新种子快照；它会覆盖目录，应先将新增来源加入脚本。

正式站点通过 `POST /api/refresh` 更新 D1，无需重新构建网站。失败的源不覆盖已有内容，信源管理页展示最近一次状态。首次同步归档种子数据；关注前发布的节目不会被通知。普通文章按 URL 去重，播客按节目与规范化标题去重；暂不自动合并标题不同的跨平台节目。

## 飞书连接

在目标群添加「自定义机器人」，在 Sites 运行时配置下列秘密环境变量：

- `FEISHU_WEBHOOK`：`https://open.feishu.cn/open-apis/bot/v2/hook/...`
- `FEISHU_SECRET`：可选，机器人签名密钥。

密钥仅供服务端读取，不写入浏览器、源代码和 hosting.json。本地可放在忽略的 `.dev.vars` 文件。配置完成后刷新「提醒设置」，发送测试消息；确认收到后打开提醒并保存。

若启用了飞书关键词校验，添加关键词「知更 AI」。签名校验使用 HMAC-SHA256(timestamp + 换行 + secret, 空消息)。HTTP 成功但飞书业务码非零时视为失败；网络超时记为结果待确认，不自动重试，以免重复发送。

- 默认未开启发送，连接和关注状态均为空。
- 逐节目支持每日汇总、检测到更新后提醒、仅站内三种方式。
- 每日汇总默认 08:00（Asia/Shanghai），首个符合时间条件的后台检查发送；不是秒级推送。
- 每批最多 8 期，历史回补窗口 7 天。发送异常见提醒页的回执记录。

## 无人值守更新

生产站点的固定入口是 `POST /api/refresh`。它依次采集当前目录并尝试发送符合偏好的更新。页面的「检查更新」仅采集，不主动推送消息。

后台必须由外部定时任务触发，刷新浏览器不会代替定时任务。Sites 调度任务读取该私密站点的服务访问凭证后，以 `OAI-Sites-Authorization: Bearer ...` 调用此入口，再 GET `/api/state` 核对时间、来源状态与回执。凭证不得写入任务提示词、文件或日志。

**该入口依赖 Sites 的 owner-private 访问控制。公开站点或添加其他访问者前，必须先补充应用级鉴权和用户数据隔离。不要直接更改访问范围。**

## 主要文件

- `app/dashboard.tsx`：页面、导航、阅读与订阅交互。
- `app/globals.css`：深绿视觉系统与窄屏布局。
- `lib/store.ts`：数据持久化、抓取编排、通知去重。
- `lib/feed.mjs`：有限大小的 RSS / Atom 读取与安全文本处理。
- `lib/feishu.mjs`：消息格式、签名与响应校验。
- `db/schema.ts`、`drizzle/`：数据库模型与迁移。
- `app/api/`：状态、用户操作、无人值守更新。

## 发布

`.openai/hosting.json` 保留 Sites 项目身份与 D1 绑定。使用 Sites 技能的 source helper 同步源码、构建、打包和私密发布。发布时托管数据库迁移由 Sites 自动应用，与本地库相互独立。

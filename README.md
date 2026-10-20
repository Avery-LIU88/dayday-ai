# DayDay AI

每天一点，跟上 AI。免费阅读，无需注册。

## 当前阶段

第一阶段：按用户三张截图中的来源，接入公司 Blog / 技术报告 / 产品发布、论文与研究、媒体资讯、Newsletter、开发者平台、线上发布会、线下活动、投融资、招聘和政策监管。

第二阶段是节目链接关注；第三阶段是飞书提醒及内容分发。这两个阶段的入口保留，但不会假装已经同步或发送提醒。

## 阅读与数据

- 今日热点：近 48 小时资讯的规则重要性排名，非流量热度；不把职位记录放进热榜。
- 主题：分类 → 搜索 / 来源 / 语言 / 排序；公司动态可再按 Blog、技术报告、产品发布筛选。
- 每日简报 / 周报：按北京时间选择日期，基于实际条目排序整理，当前不是模型撰写的编辑综述。
- 收藏：当前浏览器 localStorage，无需账户，不跨设备同步。清空浏览器数据会清空收藏。
- 信息源：展示已接通、更新异常、待接入和检查时间；每条原文都可追溯。
- 同一个发布者的 Blog、研究、SDK、模型端点不会重复增加首页发布者计数。最近 48 小时检查成功才计为正常。
- 招聘来源为用户指定公司的官方招聘端点；“职位更新”不当作原始发布日期。模型元数据标记“模型创建”，不冒充官方发布公告。
- 仅采集公开摘要。付费、私域、个人邮箱和群聊不在自动读取范围内。

## 采集与聚合

`data/news-sources.json` 是公共资讯配置；由 `scripts/build-news-catalog.mjs` 根据用户来源清单生成。成功发现的官方入口在 `data/source-overrides.json`。目录项没有可用采集端点时保持待接入，不计为成功。

`lib/news-collector.mjs` 支持 RSS/Atom、Anthropic 新闻列表、带发布时间的公开文章、DeepSeek 更新日志、Hugging Face 论文与官方模型元数据、Greenhouse 公开职位、TLDR / Rundown 日期列表。

流程：读取公开内容 → 过滤非 AI / 明显促销 → 清理 HTML / 提取短摘要 → 链接去重及保守标题合并 → 分类 → 重要性评分 → 页面聚合。

规则评分：内容重要性 0–40、时效 0–30、独立发布者覆盖 0–20、一手来源 0–10。可在资讯详情看到组成。模型版本数字不同不会合并。跨语言语义去重与中文生成摘要尚未启用，不伪装为已接入模型。

`data/news-seed.json` 是真实采集的启动数据。数据库读取失败仍保留这些内容，绝不生成演示新闻。生产数据库保存后续结果，查询上限 1800 条；不是完整历史档案。失败来源保留最后内容，但标记更新异常。

## 本地

```sh
npm run dev -- --host 127.0.0.1 --port 4174
node scripts/collect-news.mjs
node --test tests/core.test.mjs tests/news.test.mjs
npx tsc --noEmit
npm run build
```

收集脚本允许传一个或多个来源 ID 定向核验。`--discover` 只对清单已有官方入口寻找公开 Feed 或同源文章，不扩展到站外爬取。

## 线上更新

现有 Sites 项目 ID 保存在 `.openai/hosting.json`，必须复用。旧版共享的个人关注、收藏、提醒、反馈不再通过公开接口返回，旧 `POST /api/action` 返回 410。

- `GET /api/state`：公开只读资讯、源列表和状态，不含私人数据或密钥。
- `GET /api/refresh`：无密钥的后台任务调用说明。
- `POST /api/refresh`：需服务器 `ADMIN_TOKEN`，未授权返回 401；不接受自定义 URL 或数据。
- 每次更新最多 8 个来源，持久化游标与租约避免重复并发；返回 `complete=true` 表示本轮完成。失败不阻塞其他来源。
- 更新后必须重新读取 `GET /api/state` 验证 `collectedAt` 和 `health`，不能把成功触发任务当作成功采集。
- 现有小时任务应复用，不重复创建。公开版调用必须同时提供 Sites 服务访问头和应用授权头。已将本站的 Sites 服务凭证作为服务器 `ADMIN_TOKEN`；只能从当前 Site 的 `get_site` 临时获取，不能写进提示词、源码、日志或浏览器。凭证若被平台轮换，需要重新配置服务器密钥。
- 独立 Cloudflare 部署时，生成独立的强随机 `ADMIN_TOKEN`，绑定 D1，并配置 Cron 调用 Worker 的 `scheduled` handler。当前代码包含 handler，但没有自行声称 Cloudflare Cron 已启用。

### 已有云任务的执行说明

仅更新第一阶段公共资讯，不采集节目，不发送提醒。先 GET `/api/refresh` 读取当前说明；从本站 `get_site` 获取服务凭证，仅对本站发送 `OAI-Sites-Authorization: Bearer ...` 和 `Authorization: Bearer ...`。依次 POST，直到 `complete=true`（上限 20 次）；遇 `busy=true` 停止，遇错误保留原数据并报告。最后 GET `/api/state`，报告检查结果。不要记录凭证，不重复部署，不修改源清单。

## 接入证据与限制

来源页面及采集端点保存在配置中；最新检查记录保存在 seed / D1。未接通的中文动态站点、受访问限制的媒体、名称尚不明确的实验室和会议仍保留状态，不能宣称三张图里的全部来源都已经自动更新。

官方接口参考：
- arXiv Feed 规范：https://info.arxiv.org/help/rss.html
- Greenhouse 公开职位：https://docs.greenhouse.io/job-board.html
- Hugging Face 公共 API：https://huggingface.co/docs/hub/api
- Anthropic 新闻列表：https://www.anthropic.com/news

生产访问权限与定时任务是否通过验证，应以本轮部署结果为准，不能仅凭本 README 判断。

### 补充入口（2026-10-20）

- Kimi 研究博客、字节 Seed 最新动态、阶跃新闻公开数据；腾讯混元官网的 `publicList` 公开接口。
- xAI 和智谱官方产品更新日志是独立端点，不替代尚未接通的 Blog，也不重复增加发布者数。
- 晚点使用公开列表接口，再读取文章页明确的年份；甲子光年、TechWeb 使用文章头部日期；新智元更正为 `aiera.com.cn` 的公开文章目录。
- Semantic Scholar 使用公开 bulk search API，限 AI 查询并过滤未来/无日期结果；遇 429 保留上次数据。AIPapers 使用公开学术简报目录。
- 中科院自动化所、戴琼海相关成像与智能技术实验室的官方文章；浙大 CAD&CG RSS。王选所能解析文章，但本轮未筛出 AI 相关内容，不视为已有可读 AI 内容。
- ACL 官方 RSS；NAACL 原 RSS 停留在 2021 年，改读当前带日期的公告链接；EMNLP 2026 公告日期不当作会议举办日期。届次变更需更新配置。
- Contrary Research 同源公开研究报告。

不同来源覆盖范围不同，机构首页可访问不代表已采到新闻，取得历史文章也不代表最近有更新。Papers with Code 目前跳转 Hugging Face Papers，沿用已接 HF 论文源，不重复计数。百度研究院显示维护中；机器之心旧 RSS 返回数据服务页；其他受限来源仍保留待接入/更新异常状态。

所有新增数据提取均不执行下载的 JavaScript；只读取公开列表、明确的文字字段或元信息。采集与摘要长度仍有上限，无付费全文、登录 Cookie 或用户私人订阅。本次未修改提醒功能或现有云任务配置。

### 36氪 RSS 修复

官方订阅中心：`https://www.36kr.com/rss-center`。使用带 `www` 的 `feed-article` 和 `feed-newsflash`，分别获取文章与快讯，发布者统一为 `36kr`。裸域 `36kr.com/feed` 在本次环境返回安全检测页；`www` 的压缩响应虽含完整 RSS，curl 仍报传输错误，指定 `Accept-Encoding: identity` 后可完整读取。仅这两个来源设置 `uncompressed: true`；不跳过 TLS 校验，不使用登录 Cookie，不将阅读器缓存当作在线采集结果。线上是否成功以最新 `health` 为准。

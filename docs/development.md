# 开发与配置

[返回 README](../README.md)

## 本地开发入口

环境要求来自 [`package.json`](../package.json)：Node.js ≥ 22.13.0。使用 npm 安装锁定版本的依赖。

```bash
git clone https://github.com/Avery-LIU88/dayday-ai.git
cd dayday-ai
npm run install:ci
npm run dev -- --host 127.0.0.1 --port 4174
```

访问 <http://127.0.0.1:4174>。本地环境通过 Cloudflare 开发工具模拟 Worker 与绑定；全新数据库尚无已发布结果时，页面会显示等待处理，不会读取线上生产数据。

仅启动页面不会自动启动抓取、调用模型或开启飞书推送。完整的数据流程还需要完成下面的运行配置。

## 技术结构

| 部分 | 当前实现 |
| --- | --- |
| 页面 | React 19、TypeScript、Tailwind CSS；Vinext / Vite 构建 |
| 服务端 | Cloudflare Workers；线上通过 Sites 托管 |
| 数据 | Cloudflare D1；Drizzle 定义结构与迁移 |
| 内容处理 | 小批次后台处理，D1 保存阶段结果、游标、租约和模型回执 |
| 独立调度 | 单独的 Cloudflare Worker + Cron + Workflows，见 [`scheduler/`](../scheduler/) |

目录中的职责：

```text
app/          页面与 API 路由
config/       模型、提示词、评分、分发与提醒规则
data/         信源目录、公开种子数据、榜单与图标出处
lib/          采集、分析、归组、发布及订阅逻辑
db/           数据结构
drizzle/      数据库迁移
scheduler/    独立定时调度器与部署说明
scripts/      开发工具、定向采集与数据维护脚本
tests/        业务测试
```

## 运行完整流程需要什么

### 1. 数据库

绑定名为 `DB` 的 D1 数据库，并按顺序应用 [`drizzle/`](../drizzle/) 中的 SQL 迁移。数据库结构见 [`db/schema.ts`](../db/schema.ts)。应用迁移的具体方式取决于本地模拟环境或部署平台。

[`vite.config.ts`](../vite.config.ts) 内的数据库 ID 是本地占位值，不能直接当成生产数据库使用。Fork 不包含原站的线上 D1 数据、订阅记录或密钥。

### 2. 服务端密钥

| 名称 | 用途 | 何时需要 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 当前模型接口认证 | 执行 AI 分析与归组 |
| `ADMIN_TOKEN` | 管理接口鉴权，至少 32 字符 | 手动处理、查进度、切换调度归属 |
| `REMINDER_ENCRYPTION_KEY` | 32 字节的十六进制 AES-GCM 密钥 | 加密保存访客的飞书机器人配置 |
| `SCHEDULER_TOKEN` | 独立调度器专用密钥，至少 32 字符 | Cloudflare 调度器连接网站后台 |

生产密钥通过部署平台的 Secrets 配置；本地配置应使用被 Git 忽略的环境文件，并遵循 Cloudflare 开发工具的加载方式。不同用途使用独立密钥，不提交到仓库，不放入浏览器代码。

机器人加密密钥与已保存的密文配套，不要随意更换。各访客在网站里连接自己的飞书机器人，不需要把个人 Webhook 写入项目代码。

### 3. 模型与预算

[`config/pipeline.mjs`](../config/pipeline.mjs) 配置模型名称、接口地址、价格、提示词及每日预算；当前代码默认使用 DeepSeek 的 OpenAI 兼容接口，每日预算为人民币 6 元，按北京时间自然日记账。

更换服务商时，除了修改地址和模型名称，还要核对 [`lib/pipeline-model.mjs`](../lib/pipeline-model.mjs) 中的结构化输出、`thinking` 参数、响应格式和用量字段。OpenAI 兼容不代表所有扩展参数都通用。价格配置是记账参数，不是服务商实时报价。

### 4. 首次处理与发布

配置完成后，通过受保护的 `POST /api/pipeline` 执行阶段处理或完整小批次处理，持续到所需内容已发布。仅运行本地采集脚本会更新种子文件，不会替代 D1 的分析、归组与发布。

读回 `GET /api/state`，确认 `processedAt`、处理数量与来源状态，再核对页面。后台入口、停止条件和验收方法见 [运行与提醒](operations.md)。

## 配置自己的信源与站点

| 文件 | 修改内容 |
| --- | --- |
| [`data/news-sources.json`](../data/news-sources.json) | 当前资讯信源、适配器、发布者、语言与 `primary` 标记 |
| [`data/source-overrides.json`](../data/source-overrides.json) | 信源端点的修正配置 |
| [`scripts/build-news-catalog.mjs`](../scripts/build-news-catalog.mjs) | 生成信源目录的源定义；重新生成前需同步自己的修改 |
| [`data/podcast-links.json`](../data/podcast-links.json) | 已知 Apple 节目与公开 RSS 的映射 |
| [`config/pipeline.mjs`](../config/pipeline.mjs) | 内容判断、摘要、事件归组、排名、模型与预算 |
| [`config/activities.mjs`](../config/activities.mjs) | 活动清单与核验信息 |
| [`config/delivery.mjs`](../config/delivery.mjs) | 时区、提醒类别、检查周期和消息分批规则 |
| [`config/distribution.mjs`](../config/distribution.mjs) | 对外链接的站点地址与接口限制；Fork 时改为自己的域名 |
| [`scheduler/wrangler.jsonc`](../scheduler/wrangler.jsonc) | 独立调度器的目标站点、模式和 Cron |

已支持的采集格式可通过配置接入；新增格式或特殊网站通常还需适配器。保存来源名或首页链接不等于完成接入。

## 部署边界

现有站点使用 Sites。维护原站时复用原项目；创建自己的站点时，按目标平台流程创建独立项目与数据库，不要沿用原站的项目 ID、生产域名或凭证。

仓库目前没有完整站点的通用一键部署包。独立 Cloudflare 调度器只负责触发已有后台，不会同时部署网站、创建数据库或配置模型密钥。部署前先确认站点可正常处理数据，再按 [调度说明](../scheduler/README.md) 接入并验收定时任务。

## 常用校验

在依赖已安装的项目根目录运行：

```bash
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

采集适配器可按来源 ID 定向核验：

```bash
node scripts/collect-news.mjs openai
```

该命令会访问外部信源并更新 `data/news-seed.json`。不传 ID 会检查所有已配置的可采集来源。`--discover` 会尝试从已有官方入口发现 Feed 或同源文章，并写回目录与覆盖配置；运行前确认这些是你想修改的文件。

## 给阅读器和 Agent 的入口

以下路径均相对于你部署的站点：

| 入口 | 用途 |
| --- | --- |
| `GET /rss.xml` | 事件 RSS；`?kind=daily` / `?kind=weekly` 订阅简报 |
| `GET /api/v1` | 公开接口说明 |
| `GET /api/v1/events` | 已发布事件；支持搜索、分页和全部事件视图 |
| `GET /api/v1/daily`、`GET /api/v1/weekly` | 已发布简报 |
| `POST /mcp` | MCP 只读查询入口；客户端连接方式以其要求为准 |
| `GET /llms.txt` | 面向 Agent 的站点说明与数据入口 |

这些入口读取发布结果，不触发抓取或模型调用。管理接口和个人订阅接口使用各自的鉴权，不能用公开查询接口操作它们。

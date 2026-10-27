# DayDay AI 独立调度

一个 Cloudflare 项目：两个业务 Cron + 一个共用 Workflow。所有采集、模型处理、D1 和飞书发送仍在原 Sites 后台。没有固定心跳，也不轮询 Workflow 状态来驱动处理。

| 类型 | Cron（UTC） | 北京时间 | 单轮上限 |
| --- | --- | --- | --- |
| episodes | `0 * * * *` | 每小时整点 | 100 个批次，55 分钟 |
| daily | `0 13 * * *` | 每天 21:00 | 400 个批次，4 小时 |

Cron 将 Cloudflare `scheduledTime` 归到对应 UTC 小时整点，生成固定工作流 ID；平台触发的秒、毫秒及短暂延迟不产生新轮次。日志同时保留平台原时间和业务整点，不使用执行时的当前时间代替事件时间。Workflow 每个持久化步骤调用一次 `POST /api/scheduler` 推进后台；未完成立即进入下一步，完成即结束。仅连接异常、429/5xx 和锁冲突退避重试：30 秒起指数退避，最多 5 次。每次 HTTP 上限 180 秒、步骤上限 4 分钟。401/403、异常跳转、轮次不匹配或前轮遗留阻塞直接失败，保留 D1 进度供人工处理。

## 安全默认值

- 调度模式：`probe` 只验证专用鉴权并在 D1 记录触发；`active` 按 D1 中的 owner 推进业务。当前仓库已在 2026-10-28 02:00 的真实 Cron 验证后改为 `active`；这不代表日更和飞书送达已经完成验收。
- Sites D1 的 `scheduler_owner_daily`、`scheduler_owner_episodes` 默认 `legacy`，旧 ChatGPT 任务继续处理。读取端和处理端均不会自动切换归属。
- 专用 `SCHEDULER_TOKEN` 是单独的随机服务端密钥，至少 32 字符；仅允许调度步骤和汇总状态，不能修改归属、指定源 URL 或操作单阶段重处理。不得复用 ADMIN_TOKEN、Sites bypass token、读者 token 或模型密钥。
- 密钥仅存 Sites Secret 和 Cloudflare Worker Secret，通过隐藏 stdin 配置；不进入仓库、文件、命令行参数、聊天、调度参数和日志。不需要 OAI-Sites-Authorization 或 ChatGPT 登录；前提是本站保持当前 public audience，业务写接口继续要求专用密钥。
- 独立 Worker 不绑定数据库，也不持有飞书机器人或模型密钥；没有公开 HTTP 操作入口。

## 部署与逐项验收

1. 登录自己的 Cloudflare 账户，核验 Worker、Workflow、Cron 和日志权限及账户配额；不要把 Sites 的本地占位 D1 ID 当成真实数据库绑定。
2. 先发布 Sites 后台，保持两类 owner 为 legacy。生成新的专用密钥并配置双方 Secrets，再发布新 Sites 环境版本。原有 ADMIN_TOKEN 和机器人加密密钥不变。
3. 在项目根目录部署调度 Worker：`node node_modules/wrangler/bin/wrangler.js deploy --config scheduler/wrangler.jsonc`。使用 `wrangler secret put SCHEDULER_TOKEN --config scheduler/wrangler.jsonc` 的隐藏输入保存同一密钥。先确认密钥就绪再等待正式 Cron；不要把 dry-run 当成已部署。
4. 等一个真实业务 Cron。核对 Cloudflare 事件类型、表达式、scheduledTime、Workflow instance ID，以及 Sites `GET /api/scheduler` 的 probes 记录。人工触发只算连接测试。
5. 把 Worker 模式改为 active 并部署，先确认新版本部署成功。按类型在下一个业务时点前通过 ADMIN_TOKEN 调用 `POST /api/scheduler`，请求 `{action:"owner",kind:"episodes"或"daily",owner:"cloudflare"}`。旧 ChatGPT 任务保持 enabled，但原入口会在业务锁内安全跳过。避免在旧轮次未完成时切换；若已发生则先恢复旧归属、续完旧轮再切换。
6. 至少验证一次真实日更和一次有新增节目的整点运行：Cloudflare Cron → Workflow → D1 运行记录/消息回执 → GET /api/state 的新快照及网站显示 → 飞书群对应消息。三类消息都需有证据；无新增内容只证明空跑，不算送达验证。
7. 单项验收通过后才暂停对应 ChatGPT 云端任务，保留原配置和恢复入口；不要删除旧任务。

部署辅助命令（在项目根目录；具体 Workflow 实例 ID 从平台返回值取）：

- `node node_modules/wrangler/bin/wrangler.js workflows instances list dayday-ai-updates --config scheduler/wrangler.jsonc`
- `node node_modules/wrangler/bin/wrangler.js workflows instances describe dayday-ai-updates <instance-id> --config scheduler/wrangler.jsonc`
- `node node_modules/wrangler/bin/wrangler.js tail dayday-ai-scheduler --format json --config scheduler/wrangler.jsonc`

## 验收信号和限制

`GET /api/scheduler` 需要专用调度密钥或原 ADMIN_TOKEN，返回 owners、最新运行和 probe；不会返回读者、Webhook 或签名密钥。

运行记录：kind、runId、scheduledAt、trigger、startedAt、finishedAt、batches、phase、outcome、pending、failedSources、website 和 receipts。D1 使用现有 settings 表保存，无需迁移。

- `outcome=probe/inactive/skipped/already_completed` 都不是新链路成功处理的证明。
- `outcome=attention` 表示流程结束但存在积压、信源失败或发送失败/未知；必须查明，不可声称完整验收。
- receipts 是按内容条目统计，不是物理飞书消息条数。`sent` 只代表飞书 API 成功回执，群内送达还需对应消息核对。
- 整轮失败会在 Cloudflare Workflow 中显示 errored 并输出脱敏错误日志；未配置独立的外部故障通知渠道。
- 模型费用沿用北京时间自然日 6 元预算和请求回执缓存；跨午夜仍按自然日记账，不宣称每轮固定 6 元。未知模型账单和未知飞书回执不会自动重发。不要通过 reprocess 或删除账本来“重试”。
- 单次后端请求可能在客户端超时后继续完成；后续重试通过 D1 租约和固定业务轮次续跑。Workflow 步骤重放不能开启下一个小时/日期的新任务。

## 恢复

人工业务验收可通过 `wrangler workflows trigger` 传入 `{kind:"daily",scheduledAt:"实际当前 ISO 时间",trigger:"manual",mode:"active"}`。它使用独立的 `manual-<时间>` 轮次，沿用同一 Workflow、预算、内容去重和飞书回执，不消耗当晚 21:00 的正式轮次。不得伪造过去或未来的 21:00 时间；人工启动不能计为真实 Cron 触发验收。

先将受影响类型 owner 切回 legacy；新 Workflow 的下一次调用会停止推进。等待已在途的有界请求及租约结束，再恢复对应 ChatGPT 任务。保留所有业务游标、模型调用回执和 notices，不重建数据库、不清空去重。

需要立即补跑时，由操作者使用原 ADMIN_TOKEN 顺序调用原 `/api/refresh` 或 `/api/subscriptions/refresh`，遵守原入口返回的 busy/skipped/blocked 和时间窗口。修复后先重新验证，再在下一业务轮次切回；超时的旧 Workflow 不通过伪造 scheduledAt 续命。

当前是否已部署、启用或验收，以平台配置与真实运行证据为准；此文档不表示迁移已经完成。

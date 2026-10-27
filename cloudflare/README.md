# 自有 Cloudflare 免费站点

当前新站（验收中）：https://dayday-ai.lyc22686756.workers.dev

原站仍由原调度更新。新站与原站是不同数据库；禁止将 `fresh-settings.sql` 应用于原站或已有业务库。`.openai/hosting.json` 只记录原 Sites 项目身份；独立站点使用本目录的 Wrangler 配置。发布独立站点不需要 Sites 工具或 ChatGPT 运行环境。

## 已创建资源

- 账户：`f9d1756aba0b7eaf6f89495f4d6d115e`，控制台核实为 Workers **Free 当前计划**。
- Worker：`dayday-ai`，免费 workers.dev 域名。
- D1：`dayday-ai-fresh`，ID 见 `wrangler.jsonc`，单库 Free 上限 500 MB。
- 无新增 Cron、Workflow、付费套餐或 R2。
- 原 `dayday-ai-scheduler` / `dayday-ai-updates` 保持原目标，待新站送达验收后切换。

## 构建、检查与发布

```sh
npm run build
npx tsc --noEmit --incremental false
node --import ./scripts/sites-env.mjs --test tests/*.test.mjs
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --config cloudflare/wrangler.jsonc
```

Wrangler 配置直接引用 `dist/server` 和 `dist/client`。每次修改代码必须重新构建；不能只上传之前的 dist。已有 Secret 不在配置文件中，也不因正常部署而变更。

需要的 OAuth 权限：`account:read user:read workers:write workers_scripts:write workers_tail:read d1:write`。其中 `workers_scripts:write` 用于子域名/脚本/触发器等接口，不能用 `workers:write` 替代；省略时曾发生“上传成功但免费域名发布认证失败”。`offline_access` 由 Wrangler 自动附加。不要申请无关服务权限或开通付费计划。

应用 Secret：`ADMIN_TOKEN`、`SCHEDULER_TOKEN`、`REMINDER_ENCRYPTION_KEY`、`DEEPSEEK_API_KEY`。必须用 Secret 存储注入；不能提交或打印。凭据与本次验收报告只位于 Git 忽略的 `outputs/fresh-hosting/`，目录 0700、文件 0600。不要把这些文件加入压缩源码或 Git。

## 免费容量策略

`config/retention.mjs` 定义 90 天内容、7 天原始摘要/确认模型响应、14 天详细日志、每项 250 行清理上限和 350 MB 提醒阈值。新库通过 `retention_enabled=true` 启用；清理属于日更的最后一个阶段，未结束则现有 Workflow 继续，完成即停。

未来/日期未知活动与未完成处理保留。通知身份、付费调用身份和未知回执不删除；压缩旧响应后再次请求同一付费调用会被阻止，不会当作从未调用。读者、关注、加密机器人配置不属于清理对象。容量告警可通过鉴权 `GET /api/scheduler` 的 `retention` 查看。

Free 限额来自 Cloudflare 当前规则：单库 500 MB、账户合计 5 GB、每日读 500 万行/写 10 万行。超限会报错，并非自动升级；同一账户所有 D1 用量合并计算。索引和删除同样产生读写消耗。模型 API 费用独立计费。正式日更需要记录真实用量，不能按 5 条验收样本保证全年免费。

官方说明：[D1 限制](https://developers.cloudflare.com/d1/platform/limits/) · [D1 计费](https://developers.cloudflare.com/d1/platform/pricing/) · [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)

## 切换前待办

1. 在新域名重新连接飞书、开启所需类别并添加关注；不导入历史内容。
2. 对配置完成后的新站验证真实业务处理和飞书收到消息；关注需要有新一期才触发，不能用旧节目伪装新更新。
3. 排空旧 Workflow，保留可回退入口。更换调度器目标及专用密钥，同时核对两端归属。新旧不能同时处理/推送。
4. 保持北京时间 21:00 日更、每小时关注检查；首次实际 Cron 验收后才能宣告整体替换完成。原 ChatGPT 任务在对应新链路确认后再停用。

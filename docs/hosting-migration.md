# 独立托管迁移准备

## 范围与当前结论（2026-10-28）

目标为用户自己的 Cloudflare Workers + D1，复用现有业务、前端和独立调度器；本轮仅完成审计、加密备份和隔离还原演练，不切换入口、不改 Cron、不启用第二套推送。

完整业务备份已通过 SQLite 还原校验，但**尚不能原样迁入标准 D1**。真实数据还原在 `settings.news_publication_v3` 失败：JSON 值为 2,958,088 字节，超过标准 D1 单条字符串/行 2,000,000 字节上限；Miniflare 返回 `SQLITE_TOOBIG`。预检扫描 16 张表，仅发现这一条超限记录。没有删除、截断或跳过数据来伪造还原成功。

官方限制：https://developers.cloudflare.com/d1/platform/limits/

最小修正建议：保持内容、排序和通知 ID 不变，仅将大型发布快照按大小分块保存，以同一事务写入块与清单，读取后完整重组，并兼容旧的单条记录。需要覆盖日常发布和处理状态更新两处写入，以及迁移导入；不能只在导入时压缩一次。修正后重跑真实数据还原，再验证网站读取。暂不因为一条发布快照引入 PostgreSQL 或 R2。本轮未实施业务存储改动。

## 已完成的备份与证据

- 同一数据库批次事务导出 16 张业务表、表结构、索引、序列值，共 18,012 条记录；快照时间北京时间 2026-10-28 04:02:26。
- 每张表保留主键排序并核对 SHA-256；SQLite 完整性和外键检查通过。第二次使用独立离线恢复脚本重复还原也通过。
- 已保留全部 86 条通知记录，包括 5 条回执未知的测试记录，以及 1,858 条模型调用记录。未知回执不自动重发。
- 已加密备份 `DEEPSEEK_API_KEY`、`REMINDER_ENCRYPTION_KEY`、`SCHEDULER_TOKEN`；验证原飞书配置可以解密。**没有导出或迁移 Sites 的 ADMIN_TOKEN**。
- 备份使用 RSA-OAEP 包装 AES-GCM 密钥、分段认证加密；私钥只在本机。线上临时导出接口要求管理员认证且有过期时间，导出完成后从应用移除。
- 备份和恢复数据位于 Git 忽略的 `outputs/migration-20261028/`，目录权限 0700，文件 0600。不得提交备份、私钥、SQLite 副本、Webhook 或密钥。
- `restore-report.json` 为完整备份/SQLite 校验结果；`d1-restore-report.json` 明确记录 D1 超限阻塞，不能视为迁移验收成功。
- 无数据的独立 Worker 本地检查通过：首页及公开状态 200，调度未授权 401、授权 200，无外部调用。真实数据 D1 还原未完成，因此真实数据站点验收仍待执行。
- 本轮没有发送飞书消息或调用模型，没有创建或修改用户 Cloudflare 资源。

离线恢复（仅本地，路径按实际备份文件填写）：

```sh
node --import ./scripts/sites-env.mjs scripts/restore-migration-backup.mjs \
  <backup.sealed.ndjson> <backup-private.pem> <private-output-directory>
```

隔离 D1 还原检查（先构建应用；当前数据预检会明确失败）：

```sh
node --import ./scripts/sites-env.mjs scripts/verify-migration-restore.mjs \
  <restored.sqlite> <private-report.json>
```

原始密文和私钥须同时保留才可恢复；SQLite 副本也是敏感数据。备份是当时快照，不能直接用于未来切换而忽略随后产生的写入。

## 账号与部署条件

已有独立 Cloudflare 调度 Worker `dayday-ai-scheduler`、Workflow `dayday-ai-updates`；日更 Cron 为 `0 13 * * *`（北京时间 21:00），关注 Cron 为 `0 * * * *`。工作未完成时由 Workflow 按需续跑。现有目标仍是 `https://dayday-ai.activecoot128.chatgpt.site`。

账号具备管理员身份，但当前 Wrangler OAuth 仅有 Workers 相关权限；实际 D1 列表请求被拒绝（认证错误 10000）。扩展 D1 权限的 OAuth 流程未完成，等待回调已超时。后续需要重新启动官方授权，权限为 `account:read user:read workers:write workers_tail:read d1:write`；`offline_access` 由 Wrangler 自动附加，勿手工传入。不得把账户管理员身份等同于 CLI 已有 D1 访问权。

云端还原应使用不绑定应用、不配置 Cron 的隔离 D1。验证后再另行确定正式站点部署与切换步骤；本轮尚未创建该数据库。

## 后续切换必须保留的行为

1. 完成快照分块兼容、隔离 D1 全量还原和真实数据页面验证。
2. 自有 Worker 配置新管理员密钥；应用密钥通过安全渠道注入，不能将 Sites 服务凭据传到新域名。核对 D1 绑定、静态资源和前端 API。
3. 浏览器身份与收藏按来源隔离：服务器保存读者凭证摘要，不能仅凭数据库恢复浏览器原始凭证。需在原浏览器完成一次性转移；不把凭证放在 URL。收藏、主题目前在 localStorage。
4. 切换前暂停新增任务并等待旧 Workflow 实例结束（旧实例可能固定使用旧域名）；核对不确定模型回执与推送回执，冻结写入，做最终备份/增量同步。不能简单复制活动租约或同时开放两套处理入口。
5. 复用通知、调用回执、任务游标与归属记录。日更仍是 21:00 启动、最近 24 小时采集、处理完成后推送；关注每小时检查。活动逻辑保持原规则。
6. 新站点验收须证明真实 Cron → 后台处理 → 数据与网站更新 → 飞书实际送达。再切换分享入口及停用对应旧任务；备份与旧站点保留恢复窗口。
7. 尚未在新站写入时可以恢复旧入口与归属；新站已产生写入后，先合并新通知/付费回执与游标，再恢复，避免重复处理、扣费与推送。

本文件是准备阶段记录，不代表独立托管或定时切换已经完成。

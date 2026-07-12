# dev-flow 最小安全修补设计

> 状态：已实施。JSONL manifest 校验机制已在 0.6 版重构中被 `status.md` 的 `assets` 列表取代（见 `docs/plans/2026-07-12-risk-evidence-contract-implementation-plan.md` 之后的 v0.6 restructure 设计），路径穿越与 feature-id 校验原则保留并迁移到新校验器。本文正文不随后续重构改写，作为历史记录保留。

## 目标

在不新增任务状态文件、项目配置文件、状态机、hook 或 CI 的前提下，修复当前流程脚本中会造成越界删除、关键门禁漏检和 JSONL 清单静默失效的问题。

本次改动必须保持 XS、S 和轻量 M 的既有行为；不增加任何新的流程资产或用户入口。

## 范围

1. 为 `dev-flow-feature-check` 与 `dev-flow-feature-finalize` 共用 feature ID 和资产路径校验。
2. 使用一个无第三方依赖的 Node 辅助脚本严格解析 context JSONL：每一非空行必须是合法 JSON，且包含非空的 `file`、`kind`、`reason` 字段；同一 manifest 不允许重复文件。
3. 对 L 和已标记人工门禁为必需的标准 M 的完成前检查要求已有需求确认和实现前确认；`skipped` 必须保留接受风险证据。
4. 在现有 shell 测试中增加路径穿越、损坏 JSONL、缺失人工门禁和验证过期的回归用例。

## 非范围

- 不把 `status.md` 迁移为 JSON，也不新增第二套项目配置。
- 不实现 transition/confirm/next 命令或完整状态机。
- 不修改任务分级、HUMAN GATE 的对话协议或流程资产数量。
- 不新增第三方依赖、常驻服务、Git hook、CI 或自动生成文档。

## 设计

新增一个仅供现有 Bash 脚本调用的 Node 辅助脚本。它只处理两类确定性问题：

- feature ID 必须是单个相对标识符，不得为空、以 `.` 开头或包含路径分隔符；
- 资产和 context 条目路径必须是仓库相对路径，规范化后仍在 feature root 或 review root 内，且不得穿越目录；
- JSONL 按行使用 `JSON.parse` 解析并校验字段，遇到错误立即以非零状态返回。

`feature-check` 保持只读：在读取每份 manifest 前调用辅助脚本，并继续使用现有状态文件格式。它仅对 M/L 在完成前检查时验证两个人工门禁是否已确认或已带证据地跳过。

`feature-finalize` 在任何移动或删除前，逐项调用同一条路径校验。校验失败时立即退出，保留所有资产。

## 兼容性

现有的命令名、Markdown 状态文件和 JSONL 文件格式均保持不变。以前格式正确的任务无需迁移；过去被静默忽略的损坏或不规范 JSONL 会改为明确失败，这是预期的安全收紧。

## 验证

保留既有完成与 compact finalization 用例，并新增：

- `../` feature ID 被拒绝；
- 资产路径穿越被拒绝，finalizer 不删除根目录外的哨兵文件；
- 含非法 JSON 的 manifest 被拒绝；
- M/L 缺失 HUMAN GATE 或跳过但没有证据时被拒绝；
- 验证完成后业务 diff 改变时被拒绝。

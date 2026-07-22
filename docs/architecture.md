# 架构

Dev Flow 以**一个预构建插件包**同时服务 Claude Code 与 Codex CLI。两端加载同一套 Skills、policy 契约与本地 MCP server。宿主 adapter 只做 hook 事件归一化，以及 Git / 受保护路径门禁；**绝不**自行推进工作流状态。

## 分层

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| Skills | 理解任务、写内容、调用 MCP | 直接改状态文件、绕过 MCP 推进步骤 |
| MCP | 分类、deriveNext、状态事务、资产校验、HUMAN GATE、feature-check、finalize | 依赖某宿主私有对话格式 |
| Host adapters | SessionStart / UserPromptSubmit / Pre·PostToolUse / Stop 归一化与拦截 | 独立确认 gate、独立完成 step |
| 项目状态 | 跨宿主配置、active 指针、feature 状态与证据 | 保存宿主专属绝对安装路径 |

## 项目状态

消费项目内状态在 `.dev-flow/`：

- `project.json`：strict 强制、允许的验证命令、受保护根目录  
- `active.json`：当前唯一 active feature  
- `features/<id>/state.json`：原子状态  
- `features/<id>/events.jsonl`：追加式事件账本  

状态库使用进程锁、revision CAS、fsync + 原子 rename。同一时刻只能有一个 feature 为 `active`，其余须显式 paused 等。

## 状态与资产

- 所有状态变更走 MCP。  
- 强制 Markdown 资产在 feature 目录内，按 SHA-256 登记。  
- `status.md` 为只读生成投影，与状态事务同批更新。  
- HUMAN GATE 的 basis 变化会使对应 gate 失效。  
- 验证只对配置的 protected roots 做业务指纹；指纹变化会使 verification、feature-check、logic-complete 失效。  
- 即使绕过 Skills 直接调 MCP，core 仍拒绝乱序步骤与「抢先」创建未来资产。

## 需求拷问（grillme，1.1.0+）

标准 M/L 的 `requirements` **步骤内**可含强制 grill 子流程（**不**新增 route step / MCP tool / HUMAN GATE）：

| 角色 | 职责 |
| --- | --- |
| `dev-flow-requirements` | 唯一编排与状态写入：scaffold、`record_artifact`、`record_step(requirements)`、`present/confirm` 需求确认门禁 |
| `dev-flow-grillme` | 唯一逐题压测：可改 `requirements.md` 的 Decision Log、Open Questions 与 front matter 中的 `grill_status`；**禁止**任何 MCP mutation / gate |

- 机器字段（front matter）：`grill_status: not_required | pending | in_progress | complete`。  
- `missing-or-unclear` / `documented-unconfirmed`：脚手架 `pending`，须达到 `complete` 且已登记 artifact 后，core 才允许 `recordStep(requirements)` 与 `presentGate(requirement_confirmation)`。  
- `provided-confirmed`：脚手架 `not_required`，默认可不拷问；显式 grillme 压测后须为 `complete` 并重新登记。  
- 校验失败返回 `GRILL_INCOMPLETE` / `GRILL_STATUS_INVALID` 等，不写 step、不建 gate、不递增 revision。  
- 非 requirements 阶段的显式 grillme 为**咨询模式**：不写文件、不改 MCP 状态。

## Hooks 与诊断

- 对非写入类工具快速放行。  
- 相关 PreToolUse：在 **logic-complete 之前**拒绝 Git 写；在 **implementation_approval 未确认**前，拒绝受保护路径上的 `Write` / `Edit` / `MultiEdit` / `apply_patch`（含 Bash 内 `apply_patch`、无法解析的 patch 保守拒绝）。  
- `dev_flow_doctor` 只读：报告项目配置、active 有效性、manifest、bundle、hook/MCP JSON 接线与可用性。

发布包自包含 `dist/mcp-server.mjs`、`dist/claude-hook.mjs`、`dist/codex-hook.mjs`，用户安装后无需 `npm install`。

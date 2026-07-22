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

## Hooks 与诊断

- 对非写入类工具快速放行。  
- 相关 PreToolUse：在 **logic-complete 之前**拒绝 Git 写；在 **implementation_approval 未确认**前，拒绝受保护路径上的 `Write` / `Edit` / `MultiEdit` / `apply_patch`（含 Bash 内 `apply_patch`、无法解析的 patch 保守拒绝）。  
- `dev_flow_doctor` 只读：报告项目配置、active 有效性、manifest、bundle、hook/MCP JSON 接线与可用性。

发布包自包含 `dist/mcp-server.mjs`、`dist/claude-hook.mjs`、`dist/codex-hook.mjs`，用户安装后无需 `npm install`。

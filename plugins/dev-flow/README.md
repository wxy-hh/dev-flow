# Dev Flow 插件包

本目录是随本仓库 Claude Code / Codex marketplace 分发的**自包含** Dev Flow 插件。

- 含预构建入口：`dist/mcp-server.mjs`、`dist/claude-hook.mjs`、`dist/codex-hook.mjs`  
- 消费方**不要**在此目录执行 `npm install`  
- 技能、policy、模板与 MCP 源码均在本包内  
- **4.0.0+** 使用 schema v3 硬切换；旧 active/paused 状态不迁移，doctor 只提供结束或清理测试 fixture 的说明
- **1.3.0+** `dev_flow_status` 附 `progress`；artifact allowlist hook；`dev_flow_recover_corrupt_feature`；受限 `standard→light` reclassify
- **1.4.0+** 风险证据按步骤统一派生并二次校验；`next/status` 暴露 `requiredEvidence` 与 verification freshness；gate 批准词集中管理；verification 可记录 browser 或逐场景 user-signoff 验收
- **1.7.0+** 原生 gate/grill 控件与一次性文本回退返回统一交互结果；审批依据更新会撤销旧批准；浏览器协助仅为非阻塞建议，money 行为命令仍强制；需要决策和成功完成时发送一次 best-effort 通知
- **4.0.0+** grill 完成态由 Decision Ledger 推导，需求文档不保存 grill 控制字段；每回合只问一道题，没有合并剩余选项
- **1.10.0+** `dev_flow_record_artifact_with_trace` 原子登记 Trace source，`dev_flow_get_traceability` 只读查看 pointer/ledger/blocker；snapshot 与 state pointer 都是 MCP 控制文件，generated status 仅由 Core 更新，standard L 以 `dev_flow_status` 为准
- **4.0.0+** `dev_flow_status` 返回 compact 中文状态，细节按 `dev_flow_inspect` topic 获取；所有用户决定统一由 `dev_flow_answer` 处理；review blocker 使用显式 finding events 结转；支持 WIP/manual commit、dirty-start、pause/resume 和祖先提交链 finalize。
- **4.0.3+** light L 实施计划在登记时校验任务间关系：每个任务声明 `rollback_unit`、每个 RU 声明 `tasks`/`depends_on`，引用闭合且依赖无环才允许登记（`PLAN_TASK_GRAPH_INVALID`）。
- 技能 id 为短名（如 `task`、`plan`）；斜杠为 `/dev-flow:task`；description 保留 `df-*` / `dev-flow-*` 作匹配兼容

## 宿主支持边界

Claude Code 与 Codex CLI 均受支持，但必须分别安装对应 manifest、MCP 和 `claude-hook.mjs` / `codex-hook.mjs`。其他 MCP 客户端未受支持，直连只用于诊断，不提供写入守卫或可信用户证据。模型代决、手工调 hook、仅 MCP happy path，以及 `doctor` 静态检查都不能证明宿主兼容。

Hook 的 Bash target analyzer 是工作流辅助，不是命令合法性裁判。wrapper、解释器、管道、heredoc、变量展开、复杂重定向和仓库外验证日志无法静态解析时默认继续，由宿主原生 sandbox、permissions 和确认流负责安全判断；unresolved 不再产生额外流程阻塞。Dev Flow 仍拒绝确定的 `.dev-flow` 控制写入、intake/未批准 protected-root 写入、未登记资产和开放恢复事务；implementation 获得授权后可按归属审计本地 Git stage/commit，push 与历史改写仍禁止。

Dev Flow block 会同时说明原因、影响、解决方案、确认边界和自动重试方式。`DEV_FLOW_WORKFLOW_STATE_UNREADABLE` 只用于有读取证据的状态问题，先刷新和只读 doctor。普通风险通过宿主确认并成功执行后，只在当前 active feature 记忆 `task-reusable` grant；切换、finalize、abandon 或 `always-confirm` 外部动作不复用。Claude block 使用 `hookSpecificOutput.permissionDecision = "deny"`，Codex block 使用 `{ "decision": "block", "reason": "..." }`；允许路径不输出假 JSON，Codex PreToolUse 不输出 `continue`、`stopReason` 或 `permissionDecision: "ask"`。

## Windows 系统提醒

Windows 用户可明确要求 Dev Flow 执行 `dev_flow_enable_windows_notifications`。该操作只在当前用户的开始菜单创建或刷新一个通知身份快捷方式，用于之后的原生 Toast 与系统提示音；不修改 feature 状态、不请求管理员权限，失败时仍保留 MCP 通知。插件升级后可以安全地再次执行该操作。

安装与使用说明见仓库根目录 [README.md](../../README.md)（技能表含 `grillme`）。  
路线与架构见 [docs/routes.md](../../docs/routes.md)、[docs/architecture.md](../../docs/architecture.md)。  
发布流程见 [docs/publishing.md](../../docs/publishing.md)。

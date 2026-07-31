# Dev Flow 插件包

本目录是随本仓库 Claude Code / Codex marketplace 分发的**自包含** Dev Flow 插件。

- 含预构建入口：`dist/mcp-server.mjs`、`dist/claude-hook.mjs`、`dist/codex-hook.mjs`  
- 消费方**不要**在此目录执行 `npm install`  
- 技能、policy、模板与 MCP 源码均在本包内  
- **1.1.0+** 含 `grillme`（需求/方案逐题拷问）；标准 M/L 两态需求在 `requirements` 步骤内强制 grill 子流程，由 core 校验 `grill_status`  
- **1.3.0+** `dev_flow_status` 附 `progress`；artifact allowlist hook；`dev_flow_recover_corrupt_feature`；受限 `standard→light` reclassify
- **1.4.0+** 风险证据按步骤统一派生并二次校验；`next/status` 暴露 `requiredEvidence` 与 verification freshness；gate 批准词集中管理；verification 可记录 browser 或逐场景 user-signoff 验收
- **1.7.0+** 原生 gate/grill 控件与一次性文本回退返回统一交互结果；审批依据更新会撤销旧批准；浏览器协助仅为非阻塞建议，money 行为命令仍强制；需要决策和成功完成时发送一次 best-effort 通知
- **1.8.0+** `dev_flow_record_artifact_with_trace` 原子登记 Trace source，`dev_flow_get_traceability` 只读查看 pointer/ledger/blocker；snapshot 与 state pointer 都是 MCP 控制文件，generated status 仅由 Core 更新，standard L 以 `dev_flow_status` 为准
- **1.8.0+** grill 移除固定题数上限与 `grill_question_limit` 字段；grillme 先产出完整决策树清单供用户批准/合并/裁剪，每轮报告剩余，收敛由用户显式确认裁决；XS/S 等无需求澄清环节的路线收到 `missing-or-unclear` / `documented-unconfirmed` 时 `dev_flow_classify` 返回 warning
- 技能 id 为短名（如 `task`、`plan`）；斜杠为 `/dev-flow:task`；description 保留 `df-*` / `dev-flow-*` 作匹配兼容  

## Windows 系统提醒

Windows 用户可明确要求 Dev Flow 执行 `dev_flow_enable_windows_notifications`。该操作只在当前用户的开始菜单创建或刷新一个通知身份快捷方式，用于之后的原生 Toast 与系统提示音；不修改 feature 状态、不请求管理员权限，失败时仍保留 MCP 通知。插件升级后可以安全地再次执行该操作。

安装与使用说明见仓库根目录 [README.md](../../README.md)（技能表含 `grillme`）。  
路线与架构见 [docs/routes.md](../../docs/routes.md)、[docs/architecture.md](../../docs/architecture.md)。  
发布流程见 [docs/publishing.md](../../docs/publishing.md)。

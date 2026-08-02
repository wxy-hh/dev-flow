---
name: verify
description: 运行项目已配置的验证。触发：验证、跑测试、verification、verify、df-verify、dev-flow-verify。当 dev_flow_next 返回 verification 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_status` / `dev_flow_next`；仅当 stage 为 `verification` 且能力合同允许时使用 `dev_flow_verify`。禁止执行未登记命令；所有尝试须经 MCP 记录。

## 自动验证

读取 `requiredEvidence.verificationKinds`，由 MCP 记录 targeted / behavior / integration / full。不得在 Skill 内复制 risk → kinds 映射。

## 可选浏览器 / 人工验收协助

1. 只有 `progress.acceptanceAssist.suggested=true` 且当前实际具备浏览器工具时，简短提示“可协助进行浏览器验收”，并立即继续配置好的自动验证；不等待用户回复，也不自动启动浏览器。
2. 用户之后明确要求协助时，才执行浏览器场景并对照已登记的功能和 UI 标准；可将真实结果记录为 `manualAcceptance.mode: "browser"` 与逐场景 evidence。
3. 用户拒绝、未回复、没有浏览器工具，或自行验收后没有说明，都不会失败、等待或改变下一步：照常完成 `dev_flow_verify` → finalize；Core 会在 finalize 前自动执行必要的完整性检查。
4. 若用户主动签收，可传 `mode: "user-signoff"`、`promptEventId` 和原样 `userReply`；签收必须精确为 `验收通过 / 确认验收 / 同意验收 / approved / LGTM`，且只能作为可审计证据，不能冒充 browser pass。`code-path-audit` 同样只是代码审计记录。
5. feature 已 finalized 后才收到协助请求时，将它作为交付后检查：执行浏览器观察并报告结果；若发现问题，由用户决定是否新建修复 feature，绝不回写已完成流程。
6. 用户签收和浏览器验收都不能替代 security、money、irreversible consequence 等机器 evidence。money 风险必须执行项目配置中的全部 `behaviorCommands`。
7. route 要求 verification artifact 时，严格执行 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑验收叙述 → `dev_flow_record_artifact` 后再 verify；其他路线可选地把 manualAcceptance 保存在 verification step evidence。
8. protected-root stale 后必须重新执行配置的机器验证。已经记录的人工/浏览器结果只保留为历史审计信息，不构成阻塞条件。

finalize 仅依赖通过且 fresh 的机器验证、必需义务和交付快照；可选验收协助从不成为 Core 的硬条件。

---
name: verify
description: 运行项目已配置的验证。触发：验证、跑测试、verification、verify、df-verify、dev-flow-verify。当 dev_flow_next 返回 verification 时使用。
---

仅使用 Dev Flow MCP。调用 `dev_flow_status` / `dev_flow_next`；仅当返回 `verification` 时使用 `dev_flow_verify`。禁止执行未登记命令；所有尝试须经 MCP 记录。

## 自动验证

读取 `requiredEvidence.verificationKinds`，由 MCP 记录 targeted / behavior / integration / full。不得在 Skill 内复制 risk → kinds 映射。

## 条件化人工/UI 验收

1. 从已登记 requirements、implementation plan、boundary card、verification narrative 中读取明确验收标准。UI/浏览器/交互/视觉关键词只用于发现提示，不是 Core 解析规则。
2. 没有明确人工/UI 标准时不启动浏览器、不传 `manualAcceptance`，小任务保持原路径。
3. 有浏览器能力时执行声明场景；失败先修复并重新验证，全部通过后传 `mode: "browser"`、来源和逐场景 evidence。
4. 无浏览器能力时明确说明没有执行浏览器验收，列出场景并等待用户书面签收；下一回合传 `mode: "user-signoff"`。禁止把用户签收描述成 browser pass。
5. 用户签收不能替代 security、money、irreversible consequence 等机器 evidence。
6. route 要求 `verification.md` 时，严格执行 `dev_flow_scaffold_artifact` → Read 已登记路径 → 编辑验收叙述 → `dev_flow_record_artifact` 后再 verify；其他路线把 manualAcceptance 保存在 verification step evidence。
7. protected-root stale 后必须重新执行浏览器场景或重新取得用户签收；历史 attempt 不得自动复用。

Core 只校验已传入 manualAcceptance 的结构，不会因缺少该字段新增 UI gate；本 Skill 对需求明确声明但尚未完成的人工/UI 验收负责停步。

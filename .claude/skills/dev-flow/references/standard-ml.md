# 标准 M / L 详细编排

只在真正判定为标准 M 或标准 L 时读取；轻量路径和 XS/S/risk-minimal 见 `SKILL.md` 正文，不需要本文件。

## 标准 M

1. 用 `openspec` 或 `req-probe` 固化需求。
2. 用 `grillme` 压测需求或设计。
3. 输出 `[HUMAN GATE:requirement_confirmation]`；确认前不得写实现计划。
4. 用 `writing-plans` 创建实现计划。
5. 创建/刷新 `status.md` 的 `dev_flow_status`。
6. 按 `references/risk-gates.md` 决定门禁形态；标准 M 至少 `plan_review: light`。
7. 需求覆盖、计划审查、安全审查、回撤单元按顺序执行；未触发的不为仪式生成大文档。
8. 输出 `[HUMAN GATE:implementation_approval]`；确认前不得写业务代码。
9. 按项目适配层 test strategy 决定是否用 `test-driven-development`。
10. 按批准计划实现。
11. `rollback_units: full` 时先审计补齐真实回撤证据。
12. 完成后用 `code-review`。
13. 收尾前执行 `verification-before-completion` 和 `dev-flow-feature-check --finish`。

必需产物：需求说明书、`status.md`、初步实现计划；其余按风险维度触发。除非用户要求保存或风险较高，需求覆盖结论、回撤单元、计划审查、安全审查、代码审查可只保留在对话或 `status.md` 中。

标准 M 加速条件：

- `grillme` 未发现新分支或阻塞问题时可减少追问轮次，但仍必须停在 `requirement_confirmation`。
- 需求覆盖无缺口且 `plan-review` 无 CRITICAL/HIGH 时，记录结论后继续到实现前门禁，不逐条等待审批。
- `code-review` 无 CRITICAL/HIGH 阻塞项时直接进入验证；有阻塞项时先修复或明确接受风险。标准 M 的 code-review 默认 `evidence_level: light`（`gate_evidence` 或独立报告均可）。

## 标准 L

进入标准 L 前运行 `.claude/skills/dev-flow/scripts/dev-flow-doctor`；有失败项先停止并报告，只有用户明确要求跳过并接受流程完整性风险后才继续，并把理由写入 `accepted_risks`。

1. 用 `openspec` 或 `req-probe` 固化需求。
2. 用 `grillme` 压测需求或设计。
3. 输出 `[HUMAN GATE:requirement_confirmation]`；确认前不得写实现计划。
4. 用户确认后用 `writing-plans` 创建实现计划。
5. 创建/刷新 `status.md` 的 `dev_flow_status`。
6. 设计不确定性高时，在 `design.md` 或计划中写 2-3 个候选方案与取舍；设计自明时跳过。
7. 按 `references/risk-gates.md` 启用门禁；L 级默认至少保留 `status.md`，触及安全或运行时行为必须保留相应证据。
8. `requirements-coverage` 对标准 L 通常 `full`；有阻塞缺口不进入实现。
9. `plan-review` 对标准 L 至少 `light`，涉及架构/跨模块/共享状态时 `full`；CRITICAL/HIGH 必须修复、反驳或用户明确接受风险。
10. 已触发的 `rollback-units` 为 `full` 时落盘任务依赖、回撤顺序和回撤后验证；`light` 时至少写入 `status.md`。
11. 命中 security/data/money 时按项目适配层加入安全审查。
12. 输出 `[HUMAN GATE:implementation_approval]`；确认前不得写业务代码。
13. 按项目适配层 test strategy 决定是否用 `test-driven-development`。
14. 可拆分时按子任务执行；平台支持时用 `executing-plans` 的子代理模式，否则用当前会话模式。
15. `rollback_units: full` 时先执行审计，再执行 `code-review`。标准 L 的 code-review 始终 `full`（独立报告）；轻量 L 默认 `light`（`gate_evidence.code_review` path+heading，CRITICAL/HIGH 时升独立报告，禁止 `promote-gate code-review`）。
16. 按项目适配层运行最强相关验证；运行时行为改动必须有 `webapp-testing` 证据或完整手动测试脚本。
17. 收尾编排（Layer 3，仅 `/finish` / finishing skill）：`complete-verification` → `feature-check --finish` → 生成 final assets → finalizer dry-run → 停等精确回复（`compact` / `retain full` / `not now`）→ 禁止同回合 `--confirm`。
18. 用户精确选择后 finalizer `--confirm --inventory <sha256>`，再 `feature-check --finish`（finalized），进入 `finishing-a-development-branch` 的 Git 选项。

`writing-plans -> requirements-coverage -> plan-review` 是实现前固定骨架：`requirements-coverage` 只回答"需求和计划是否一一覆盖"，`plan-review` 回答"计划是否安全、可回撤、符合项目结构"。两者都完成前不进入 `implementation_approval`。

L 级不用"干净就过"跳过需求确认、实现确认或最终验证；架构自明只改少量高风险逻辑时允许安全审查 light/full + 行为验证 full + 回撤说明 light，不强制 plan-review/rollback-units 大文档，但仍需先经过对应 HUMAN GATE。标准 L 或 `rollback_units: full` 的实现完成后，必须经过回撤审计和 `dev-flow-feature-check --finish`，不能只靠对话中的"已完成"结论收尾。

### L 级资产契约

```text
<FEATURE_ROOT>/<feature-id>/需求说明书.md
<FEATURE_ROOT>/<feature-id>/status.md
<FEATURE_ROOT>/<feature-id>/初步实现计划.md
<FEATURE_ROOT>/<feature-id>/requirements-coverage.md（触发 full 时）
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-plan-review.md（触发 full 时）
<FEATURE_ROOT>/<feature-id>/rollback-units.md（触发 full 时）
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md（需要手动行为验证时）
```

轻量 L 只需其中 `status.md`、code-review light 证据、`verification`，行为改动时另加 `manual-test`。轻量 L 的 `status.md` 中 `requirement_confirmation.required` 为 `false`，只强制 `implementation_approval`；完成检查按此区分，不会因 `level: L` 要求需求确认门禁。轻量 L finish 要求 `completed_gates` 含 `code-review`，且 `gate_evidence.code_review` 有 path+heading（或 CRITICAL/HIGH 时的独立报告路径）。

## 中途重分级

实现、审查或验证中发现实际风险与初始判断不符时，先停下并告知用户：初始级别和实际级别、已完成步骤和已可信的结论、建议切换的路径。升级到 L 时除非用户已明确授权高风险轻量处理，否则等待确认后继续；降级时说明理由并保留已完成的有效门禁。

## 控制产物数量

不要每一步都生成文档，只在会成为决策记录或交接产物时生成：标准 M 保留需求说明书、`status.md`、计划，必要时补覆盖/审查/回撤/安全/验证资产；标准 L 额外保留代码审查和验证证据。grill 产生的重要决策合并到需求或计划，不单独保存长对话记录。

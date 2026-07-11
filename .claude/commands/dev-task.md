# /dev-task — 开发任务入口

用于把一个新需求先分级，再选择最小足够流程。

## 使用

```text
/dev-task <需求描述>
```

## 流程

1. 阅读 `.claude/rules/project-workflow.md`、`CLAUDE.md`、相关源码、已有产物和现有约定。
2. 判断任务级别：
   - XS：文案、样式、简单配置、单文件小 bug
   - S：影响局部、行为清楚、风险低、可直接验证和回撤
   - M：涉及接口、路由、状态、权限展示、错误分支、表单或业务规则
   - L：跨架构层传播、改共享契约/协议、多条链路必须一致或关键链路
3. 简短说明判断理由和边界。
4. 按级别选择流程：
   - XS/S：直接实现并运行相关验证
   - 轻量 M：复述边界，实现后做代码审查和完成前验证
   - 轻量 L：先输出边界确认卡并等待用户确认，再保留安全、回撤和行为验证证据
   - 标准 M/L：按 `dev-flow` 固化需求；用户确认需求后才写计划；计划审查和实现前确认后才写代码
5. 完成前必须提供新鲜验证证据。

## 标准 L 启动前检查

- 进入标准 L 前先运行 `.claude/skills/dev-flow/scripts/dev-flow-doctor`。
- doctor 有失败项时先停止并报告；只有用户明确说“跳过并接受流程完整性风险”后才可继续，并把理由写入 `accepted_risks`。
- 实现完成后，标准 L 必须按 `rollback-units` audit → `code-review` → `verification-before-completion` → `dev-flow-feature-check --finish` 顺序收尾。

## L 级入口硬规则

- 规模为 L（跨架构层传播、改共享契约/协议、多条链路需一致），且存在接口契约不明、多模块方案取舍、共享状态/权限结构变化或难回撤时，走标准 L。
- 命中 security、data、money 等风险标签但不跨架构层（XS/S 或 M 级）时，使用风险标签对应门禁（最小风险卡 + implementation_approval + 标签匹配验证 + feature-check），不自动升级为 L。
- 标准 L 判断完成后，必须先固化需求并输出 `[HUMAN GATE:requirement_confirmation]`；用户确认前不得写实现计划。
- 用户确认需求后，下一步必须调用 `writing-plans` 生成正式计划文档，不要用对话里的“实现计划”代替 `writing-plans`。
- `writing-plans` 完成后，如果 `Next skill` 是 `requirements-coverage` 或 `plan-review` 且 `Auto-continue: yes`，必须继续调用下一技能，直到遇到 HUMAN GATE、阻塞缺口或用户明确要求停下。
- 命中 security 风险标签且计划跨模块或共享状态时，默认 `plan-review: full`。
- 实现任务列表、Todo 或子任务执行计划只能在 `implementation_approval` 确认后创建或标为进行中。确认前可以在计划文档里列任务，但不得把实现任务标为 completed。
- 风险标签的 XS/S（risk-minimal profile）不要求需求说明书、实现计划、context manifest；但必须有风险卡、implementation_approval 证据、标签匹配验证和 feature-check 通过。

## 输出要求

- 先说任务级别和原因。
- 只问阻塞问题；非阻塞问题用合理默认值继续。
- 不为 XS/S 任务生成不必要的 md 产物。
- 涉及高风险链路时，先提示风险并建议完整流程。
- 出现 `[HUMAN GATE:*]` 或 `Auto-continue: no` 后必须停止，等待用户后续明确确认。
- `code-review` 不能替代实现前 `plan-review`。
- 文件数量不是决定项；按失败后果、影响范围和可回撤性分级。

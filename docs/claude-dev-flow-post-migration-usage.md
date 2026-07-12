# Claude dev-flow 迁移后使用说明

## 适用阶段

本说明适用于已经完成以下动作的项目：

- 已复制 dev-flow 迁移包。
- 已运行 `/onboard-dev-flow`。
- 已生成 `.claude/rules/project-workflow.md`，且其中 `dev_flow` 配置已按当前项目填好。
- `dev-flow doctor` 和 smoke test 已通过，或已记录未通过项和接受风险。

如果还没有完成这些动作，先阅读 [迁移使用说明](./claude-dev-flow-migration.md) 和 [迁移后 smoke test](./claude-dev-flow-smoke-test.md)。

## 日常入口

新需求、bug 修复、业务改动、UI 修改和重构，优先使用：

```text
/dev-task <需求描述>
```

收尾、验证和提交前检查，使用：

```text
/finish
```

需要整理提交信息时，使用：

```text
/commit
```

默认不自动提交或推送。只有用户明确要求“帮我提交”或“帮我 commit”时，才可以执行 `git add` 和 `git commit`；`git push`、merge/rebase、删除分支、discard/reset/checkout 覆盖文件等高风险动作必须二次确认。

## 第一次真实任务

迁移后不要直接从高风险任务开始。建议按顺序试跑：

1. 一个真实但低风险的 M 级任务。
2. 一个轻量 L 场景，例如小范围权限、登录态或关键路径行为调整。
3. 一个标准 L 场景，确认需求固化、计划、审查、回撤和验证都能顺畅衔接。

每次试跑后，确认：

- 分级是否符合团队预期。
- `project-workflow.md` 的路径、命令和验证矩阵是否准确。
- `status.md` 能否用 `dev_flow_status` 和摘要记录当前 gate、资产和验证新鲜度。
- `status.md` 的 `human_gates` 能否记录需求确认和实现前确认；出现 `[HUMAN GATE:*]` 或 `Auto-continue: no` 后是否真的停下。
- 新建 v2 风险任务的 `risk_evidence` 能否为每个风险标签留下非空结论和验证引用；`light` 不应新增报告，`full` 必须引用现有报告。
- 轻量 L 和标准 M/L 的 context manifest 能否串起需求、计划、审查和验证输入。
- 标准 M/L 的 `plan-review` 是否发生在第一处源码修改之前，且没有被后置 `code-review` 替代。
- 代码审查是否只报告真实问题。
- `/finish` 是否能给出新鲜验证证据。
- `dev-flow-feature-check <feature-id> --finish` 是否能拦截缺失验证、回撤 pending、错误 manifest 和不存在资产。

## 如何描述任务

### XS/S 小改动

说明目标和验收即可：

```text
/dev-task 把设置页的按钮文案从“保存”改成“保存设置”，只改文案。
```

预期行为：

- 不生成额外 md 产物。
- 直接修改并运行相关验证或文本检查。
- 最终说明改了什么、验证了什么。

### 轻量 M

说明行为边界、接口或状态影响：

```text
/dev-task 在订单列表增加“仅看异常订单”筛选，复用现有列表接口和筛选状态，不改详情页。
```

预期行为：

- 先复述需求边界和不做范围。
- 实现后做代码审查和完成前验证。
- 不强制补需求说明书、完整实现计划、`status.md` 或 context manifest。

### 标准 M

当存在接口契约、状态流转、错误分支或业务规则不确定时，让 dev-flow 先固化需求和计划：

```text
/dev-task 新增发票抬头管理，涉及列表、新增、编辑、删除和默认抬头规则。先按标准 M 走需求和计划。
```

预期行为：

- 生成需求说明和实现计划。
- 生成或更新 `status.md` 和 context manifest。
- 需求边界确认后才生成实现计划。
- 至少执行 `plan-review light`，并在实现前等待确认。
- 实现后执行代码审查和完成前验证。

### 轻量 L

高后果但设计自明、范围小的任务，可以明确要求轻量 L：

```text
/dev-task 调整登录过期后的跳转兜底，只改一处 guard，携带 security 风险标签（S + risk-minimal），保留安全审查、回撤说明和行为验证。
```

预期行为：

- 生成或更新 `status.md`。
- 维护 context manifest，方便安全审查、代码审查和验证读取同一批证据。
- 至少保留安全审查、行为验证和回撤证据。
- 先输出边界确认卡，列出高风险点、改动范围、不做范围、回撤方式和验证方式；用户确认前不写 `status.md`、context manifest 或业务代码。
- 实现前说明风险并等待确认；如果出现需求分支、接口契约不明、多模块方案取舍、共享状态/权限结构变化或难回撤，升级标准 L。

### 风险标签 S（risk-minimal）

高后果但改动极小、设计自明的任务，携带风险标签但不升级规模：

```text
/dev-task 修正 token 过期后的清理逻辑，只改一处工具函数，携带 security 风险标签，走 risk-minimal。
```

预期行为：

- 输出最小风险卡：范围、风险、回撤/恢复方式、验证方式。
- 停在 `[HUMAN GATE:implementation_approval]`，用户确认风险卡前不写业务代码。
- 生成 `status.md`（`profile: "risk-minimal"`）。
- 在 `risk_evidence.security` 中记录安全结论和负面路径验证引用；`light` 只更新 `status.md`，不生成新报告。
- 执行风险标签匹配的验证（如 security 的负面路径测试）。
- 完成后保留 `completion.md` 风险摘要。
- 不要求需求说明书、实现计划、context manifest。

### 标准 L

跨架构层传播、改共享契约/协议、多条链路需一致，且存在需求或设计不确定时，走标准 L：

```text
/dev-task 重构支付结果回跳和订单状态同步，涉及跨系统入口、订单状态和异常兜底，走完整 L 流程。
```

预期行为：

- 先固化需求边界，并在 `[HUMAN GATE:requirement_confirmation]` 停下。
- 用户确认需求后再用 `writing-plans` 写正式计划；计划完成后自动进入 `requirements-coverage`，覆盖通过后自动进入 `plan-review`。
- 完成 `plan-review` 和回撤/安全等实现前门禁后，在 `[HUMAN GATE:implementation_approval]` 停下。
- 维护 `status.md`、context manifest 和必要局部规范引用。
- 完成后必须有代码审查和新鲜验证证据。

## 产物在哪里

具体路径以 `.claude/rules/project-workflow.md` 的 `dev_flow.paths` 和路径别名表为准。

常见产物：

| 产物 | 用途 |
|------|------|
| `<FEATURE_ROOT>/<feature-id>/status.md` | 当前 gate、完成情况、资产、验证新鲜度、风险证据和接受风险 |
| `<FEATURE_ROOT>/<feature-id>/context/implement.jsonl` | 实现阶段要读取的需求、计划、局部规范和研究文件 |
| `<FEATURE_ROOT>/<feature-id>/context/review.jsonl` | 计划审查和代码审查要读取的需求、计划、覆盖、回撤和规范文件 |
| `<FEATURE_ROOT>/<feature-id>/context/verify.jsonl` | 完成前验证要读取的审查、验证要求和手动测试文件 |
| `<FEATURE_ROOT>/<feature-id>/需求说明书.md` | 标准 M/L 的需求边界 |
| `<FEATURE_ROOT>/<feature-id>/初步实现计划.md` | 标准 M/L 的实现计划 |
| `<FEATURE_ROOT>/<feature-id>/requirements-coverage.md` | 需求到任务和验证的覆盖关系 |
| `<FEATURE_ROOT>/<feature-id>/rollback-units.md` | 最小回撤单元和回撤顺序 |
| `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md` | 代码审查报告 |
| `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md` | 完成前验证证据 |
| `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md` | 手动行为验证脚本和实测结果 |
| `<FEATURE_ROOT>/<feature-id>/feature.md` | 完成后的需求边界、方案和关键决策摘要 |
| `<FEATURE_ROOT>/<feature-id>/completion.md` | 完成后的审查、验证、风险和回撤事实源 |

`status.md` 的 `dev_flow_status.human_gates` 是长流程能否继续的机器可读依据。标准 M/L 必须有 `requirement_confirmation` 和 `implementation_approval`；轻量 L 必须有边界确认和实现前确认。确认前不要写实现计划或业务代码。

`requirements-coverage.md` 是需求和计划的对齐报告，不是完成前验证报告。它默认只追加到 `context/review.jsonl` 供 `plan-review` 读取；只有覆盖报告新增了后续验证必须读取、且计划或验证脚本里没有的明确验证义务时，才追加到 `context/verify.jsonl`。

恢复中断任务时，先读 `status.md` 的 `dev_flow_status` 和摘要，再读其中列出的资产及 context manifest；`[HANDOFF]` 只作为最近一次对话的辅助线索。

## 验证和新鲜度

完成前必须有新鲜验证证据。`status.md` 中的以下字段用于判断验证是否过期：

- `Base SHA`
- `Head SHA`
- `Working tree dirty`
- `Diff stat hash`
- `Last validation at`
- `Last validation commands`
- `Accepted risks`

如果验证后代码又变了，或者 `Head SHA`、`Working tree dirty`、`Diff stat hash` 与记录不一致，不能复用旧验证结论，必须重新运行相关验证。

context manifest 只解决“该读哪些文件”，不等于验证通过。验证结论仍以最新命令输出、人工测试记录、验证报告和 feature-check 为准。完成后默认清理中间 manifest；需要完整审计时使用 `retention: full` 归档。

## 什么时候跑 doctor

运行：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

推荐时机：

- onboarding 后。
- 修改 `.claude/skills`、`.claude/commands`、`.claude/agents` 或 `.claude/rules` 后。
- 调整 `project-workflow.md` 的路径、验证命令、测试能力或 Git 边界后。
- 调整 scoped specs、context manifest 规则或 `status.md` 结构后。
- smoke test 前。
- 团队升级 dev-flow 迁移包后。

doctor 只做静态检查，不替代项目测试、浏览器验证或 smoke test。

## 维护规则

- 流程层可复制，项目事实只写进 `.claude/rules/project-workflow.md`、`CLAUDE.md` 或可选 stack rule。
- 不要把某个项目的路径、headers、端口、mock 命令或测试命令写进通用 skill、command 或 agent。
- `project-workflow.md` 的 `dev_flow` 配置和 Markdown 表格要同步更新。
- 新增脚本优先读取 `dev_flow.paths`，不要硬编码 runtime 目录。
- `.claude/rules/specs/<scope>/index.md` 只有在有真实局部约定时才创建，并包含 `Pre-Development Checklist` 和 `Quality Check`。
- context manifest 只登记需求、计划、局部规范、研究、审查和验证等上下文文件，不登记源码文件。
- HUMAN GATE 是硬停顿：`[HUMAN GATE:*]` 或 `Auto-continue: no` 后不能在同一回合继续写计划、写代码或把 `auto_continue` 改回 `true`。
- `plan-review` 是实现前计划审查，不能由实现后的 `code-review` 代替。
- 安全审查默认只读；需要修复时，由主流程或用户确认后的任务执行代码修改。
- `status.md` 是长流程恢复的事实来源，M/L 任务更新资产时要同步更新它。

## 常见问题

### doctor 提示缺少 project-workflow.md

在源迁移包仓库中这是正常 warning；在目标业务项目中应先运行 `/onboard-dev-flow` 生成 `.claude/rules/project-workflow.md`。

### 没有自动化测试怎么办

把 `automated-tests` 明确写成 `none`。不要把 dev/watch 命令当测试证据。L 级运行时行为改动必须保留手动测试脚本或其它可复查行为证据。

### 想跳过某个门禁怎么办

XS/S 默认轻量，不会强行生成文档。标准 M/L 如果要跳过需求确认、计划审查、实现前确认、回撤或安全审查，需要说明风险；L 级跳过高风险门禁必须用户明确确认，并写入 `accepted_risks`。

### 可以让 Claude 直接提交吗

默认不提交。用户明确要求“帮我提交”或“帮我 commit”时，可以执行 `git add` 和 `git commit`；推送、合并、删除分支、丢弃改动等动作必须二次确认。

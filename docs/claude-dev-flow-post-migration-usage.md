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
- `status.md` 能否记录当前 gate、资产和验证新鲜度。
- 代码审查是否只报告真实问题。
- `/finish` 是否能给出新鲜验证证据。

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
- 不强制补需求说明书或完整实现计划。

### 标准 M

当存在接口契约、状态流转、错误分支或业务规则不确定时，让 dev-flow 先固化需求和计划：

```text
/dev-task 新增发票抬头管理，涉及列表、新增、编辑、删除和默认抬头规则。先按标准 M 走需求和计划。
```

预期行为：

- 生成需求说明和实现计划。
- 按风险维度触发需求覆盖、计划审查或回撤单元。
- 实现后执行代码审查和完成前验证。

### 轻量 L

高后果但设计自明、范围小的任务，可以明确要求轻量 L：

```text
/dev-task 调整登录过期后的跳转兜底，只改一处 guard，走轻量 L，保留安全审查、回撤说明和行为验证。
```

预期行为：

- 生成或更新 `status.md`。
- 至少保留安全审查、行为验证和回撤证据。
- 实现前说明风险并等待确认。

### 标准 L

涉及登录、鉴权、订单、支付、数据删除、数据完整性、跨系统入口或多个关键路径，且存在需求或设计不确定时，走标准 L：

```text
/dev-task 重构支付结果回跳和订单状态同步，涉及跨系统入口、订单状态和异常兜底，走完整 L 流程。
```

预期行为：

- 先固化需求边界。
- 进入计划、覆盖、审查、安全、回撤和实现前确认。
- 完成后必须有代码审查和新鲜验证证据。

## 产物在哪里

具体路径以 `.claude/rules/project-workflow.md` 的 `dev_flow.paths` 和路径别名表为准。

常见产物：

| 产物 | 用途 |
|------|------|
| `<FEATURE_ROOT>/<feature-id>/status.md` | 当前 gate、完成情况、资产、验证新鲜度和接受风险 |
| `<FEATURE_ROOT>/<feature-id>/需求说明书.md` | 标准 M/L 的需求边界 |
| `<FEATURE_ROOT>/<feature-id>/初步实现计划.md` | 标准 M/L 的实现计划 |
| `<FEATURE_ROOT>/<feature-id>/requirements-coverage.md` | 需求到任务和验证的覆盖关系 |
| `<FEATURE_ROOT>/<feature-id>/rollback-units.md` | 最小回撤单元和回撤顺序 |
| `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-code-review.md` | 代码审查报告 |
| `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md` | 完成前验证证据 |
| `<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md` | 手动行为验证脚本和实测结果 |

恢复中断任务时，先读 `status.md`，再读其中列出的资产；`[HANDOFF]` 只作为最近一次对话的辅助线索。

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

## 什么时候跑 doctor

运行：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

推荐时机：

- onboarding 后。
- 修改 `.claude/skills`、`.claude/commands`、`.claude/agents` 或 `.claude/rules` 后。
- 调整 `project-workflow.md` 的路径、验证命令、测试能力或 Git 边界后。
- smoke test 前。
- 团队升级 dev-flow 迁移包后。

doctor 只做静态检查，不替代项目测试、浏览器验证或 smoke test。

## 维护规则

- 流程层可复制，项目事实只写进 `.claude/rules/project-workflow.md`、`CLAUDE.md` 或可选 stack rule。
- 不要把某个项目的路径、headers、端口、mock 命令或测试命令写进通用 skill、command 或 agent。
- `project-workflow.md` 的 `dev_flow` 配置和 Markdown 表格要同步更新。
- 新增脚本优先读取 `dev_flow.paths`，不要硬编码 runtime 目录。
- 安全审查默认只读；需要修复时，由主流程或用户确认后的任务执行代码修改。
- `status.md` 是长流程恢复的事实来源，M/L 任务更新资产时要同步更新它。

## 常见问题

### doctor 提示缺少 project-workflow.md

在源迁移包仓库中这是正常 warning；在目标业务项目中应先运行 `/onboard-dev-flow` 生成 `.claude/rules/project-workflow.md`。

### 没有自动化测试怎么办

把 `automated-tests` 明确写成 `none`。不要把 dev/watch 命令当测试证据。L 级运行时行为改动必须保留手动测试脚本或其它可复查行为证据。

### 想跳过某个门禁怎么办

XS/S 默认轻量，不会强行生成文档。标准 M/L 如果要跳过需求覆盖、计划审查、回撤或安全审查，需要说明风险；L 级跳过高风险门禁必须用户明确确认。

### 可以让 Claude 直接提交吗

默认不提交。用户明确要求“帮我提交”或“帮我 commit”时，可以执行 `git add` 和 `git commit`；推送、合并、删除分支、丢弃改动等动作必须二次确认。

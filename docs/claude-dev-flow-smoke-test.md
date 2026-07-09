# Claude dev-flow 迁移后 smoke test

## 目标

验证 Claude dev-flow 在新项目中不是“复制成功”，而是真的能按新项目适配层运行。

smoke test 不修改业务代码，只生成流程产物和验证报告。

## 前置条件

- 已复制 Claude dev-flow 迁移包。
- 已运行 `/onboard-dev-flow`。
- 已生成 `.claude/rules/project-workflow.md`。
- 已明确版本管理边界：本地配置模式或仓库治理模式。

## 建议 feature-id

```text
YYYY-MM-DD-dev-flow-smoke-test
```

## 验证任务 A：轻量 M

### 模拟任务

一个局部 UI 或逻辑行为变化，需求清楚、影响局部、不涉及鉴权、订单、支付、数据删除或跨系统入口。

### 期望路径

- 判断为轻量 M。
- 不强制生成需求说明书和实现计划。
- code-review 可以使用对话内需求摘要、diff、涉及文件和验证证据作为输入。
- verification-before-completion 能按项目适配层选择验证方式。
- 不要求生成 `status.md` 或 context manifest。

### 通过标准

- 不为了 code-review 被迫补 md 文档。
- 不为了三件套被迫补流程资产。
- 审查输入里能看到 lightweight context。
- 验证证据能说明改动是否可信。

## 验证任务 B：轻量 L

### 模拟任务

一个高风险但设计自明的改动，例如只改一处 auth/permission 判断，不引入新接口、不改共享数据结构。

### 期望路径

- 判断为轻量 L。
- 生成或更新 `<FEATURE_ROOT>/<feature-id>/status.md`。
- 生成或更新 `<FEATURE_ROOT>/<feature-id>/context/{implement,review,verify}.jsonl`。
- 安全审查为 `light` 或 `full`。
- 行为验证为 `full`。
- 回撤证据至少为 `light`。
- 当前没有浏览器自动化能力时，生成 manual-test。

### 通过标准

- `status.md` 存在，并包含 `dev_flow_status` 和 `Risk Gates` 表。
- context manifest 存在，且只登记需求、计划、规范、审查或验证类文件，不登记源码文件。
- `security-review` 有证据。
- `behavior-verification` 是 `full`，有 manual-test 或自动化记录。
- 有 patch 或其它可恢复回撤证据。

## 验证任务 C：标准 M

### 模拟任务

接口、状态、错误分支或表单规则有不确定性，但不触及高风险链路。

### 期望路径

- 需求固化。
- writing-plans 生成计划。
- writing-plans 创建或刷新 context manifest。
- requirements-coverage 是否触发由风险维度决定。
- plan-review 是否触发由风险维度决定。
- HANDOFF 使用 `<next-triggered-gate>` 或明确的下一门禁，不固定套满流程。

### 通过标准

- 不触发的门禁不会被强行生成文档。
- 触发的门禁能读取上一步产物。
- `status.md` 能记录当前 gate 和下一步。
- context manifest 能把需求、计划、覆盖结论和后续审查/验证输入串起来。

## 验证任务 D：标准 L

### 模拟任务

涉及登录、token/session、权限守卫、订单、支付、数据删除、跨系统入口或多个关键路径，并且存在需求分支或设计不确定性。

### 期望路径

- 需求边界确认后再进入计划。
- writing-plans、requirements-coverage、plan-review、rollback-units 按风险维度触发。
- 安全审查触发。
- 行为验证必须有运行时或手动证据。
- 完成后 code-review 和 verification-before-completion。

### 通过标准

- 阻塞缺口会停下。
- CRITICAL/HIGH 计划审查问题会停下。
- 实现前有明确回撤边界。
- 验证报告能证明关键路径。

## 必查文件

按项目适配层展开路径后检查：

```text
<FEATURE_ROOT>/<feature-id>/status.md
<FEATURE_ROOT>/<feature-id>/context/implement.jsonl
<FEATURE_ROOT>/<feature-id>/context/review.jsonl
<FEATURE_ROOT>/<feature-id>/context/verify.jsonl
<FEATURE_ROOT>/<feature-id>/rollback-units.md
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md
```

并检查 patch 或等价回撤证据：

```text
<FEATURE_ROOT>/<feature-id>/patches/task-N.patch
<FEATURE_ROOT>/<feature-id>/patches/task-N-untracked-files.txt
```

## 自检命令

先运行轻量 doctor：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

再使用 `.claude/rules/project-workflow.md` 中的文档和技能检查命令。至少确认：

- `project-workflow.md` 包含已填充的 `dev_flow` 配置。
- `project-workflow.md` 包含 `scoped_spec_root`、context manifest 路径和 `dev_flow_status` 结构。
- 没有旧项目路径或命令残留。
- 没有 `.agents/runtime` 之类跨智能体路径漂移。
- 没有直接依赖旧项目的包管理器、测试命令或目录结构。
- `CLAUDE.md` 和 `.claude/` 规则一致。

## smoke test 报告模板

```markdown
# Claude dev-flow smoke test

## 结论
- 通过 / 部分通过 / 失败

## 项目适配摘要
- project-kind:
- package-manager:
- build:
- type-check:
- lint:
- automated-tests:
- webapp-testing:
- living-baseline:
- version boundary:
- doctor:

## 分级验证
| Level | Scenario | Expected path | Result | Issues |
|-------|----------|---------------|--------|--------|
| XS/S | ... | ... | ... | ... |
| 轻量 M | ... | ... | ... | ... |
| 轻量 L | ... | ... | ... | ... |
| 标准 M/L | ... | ... | ... | ... |

## 产物检查
- status.md:
- manual-test:
- verification:
- context manifest:
- rollback evidence:

## 需要修正
- ...
```

## 通过后的下一步

smoke test 通过后，用一个真实 M 级任务试跑；再用一个轻量 L 或标准 L 任务验证安全审查、行为验证和回撤证据。不要在 smoke test 失败时直接开始真实高风险任务。

通过后按 [迁移后使用说明](./claude-dev-flow-post-migration-usage.md) 进入日常开发流程。

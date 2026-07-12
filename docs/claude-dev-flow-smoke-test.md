# Claude dev-flow 迁移后 smoke test

## 目标

验证 Claude dev-flow 在新项目中不是“复制成功”，而是真的能按新项目适配层运行。

smoke test 不修改业务代码，只生成流程产物和验证报告。

## 前置条件

- 已运行 `dev-flow-doctor --preflight`（本地安装完整性）。

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
- 不要求生成 `status.md`。

### 通过标准

- 不为了 code-review 被迫补 md 文档。
- 不为了走流程被迫补 `status.md` 或其它流程资产。
- 不为了收尾被迫运行 `dev-flow-feature-check`（轻量 M 无 status 时不强制）。
- 审查输入里能看到 lightweight context。
- 验证证据能说明改动是否可信。

## 验证任务 B：轻量 L

### 模拟任务

一个高风险但设计自明的改动，例如只改一处 auth/permission 判断，不引入新接口、不改共享数据结构。

### 期望路径

- 判断为轻量 L。
- 先输出边界确认卡，并在 `[HUMAN GATE:implementation_approval]` 或等价确认点停止。
- 用户确认前不生成 `status.md` 或业务代码。
- 用户确认后生成或更新 `<FEATURE_ROOT>/<feature-id>/status.md`，并在其 `assets` 列表中追加本次产生的需求/审查/验证资产。
- 安全审查为 `light` 或 `full`。
- 行为验证为 `full`。
- 回撤证据至少为 `light`。
- 当前没有浏览器自动化能力时，生成 manual-test。

### 通过标准

- `status.md` frontmatter 的 `dev_flow_status` 存在，并包含 `risk_gates` 字段和每个风险标签对应的 `risk_evidence`。
- `status.md` 包含 `human_gates`：`implementation_approval.required: true` 且有 evidence；轻量 L 的 `requirement_confirmation.required` 为 `false`（不因 `level: L` 被升格为标准 L）。
- `assets` 列表存在，且只登记需求、计划、规范、审查或验证类资产（按 `kind` 区分），不登记源码文件。
- `security-review` 有证据。
- `behavior-verification` 是 `full`，有 manual-test 或自动化记录。
- 有 patch 或其它可恢复回撤证据。
- 收尾时 `dev-flow-feature-check --finish` 在上述轻量 L 配置下可通过。

## 验证任务 C：标准 M

### 模拟任务

接口、状态、错误分支或表单规则有不确定性，但不触及高风险链路。

### 期望路径

- 需求固化。
- 需求确认前不得生成实现计划。
- writing-plans 生成计划。
- writing-plans 创建或刷新 `status.md` 的 `assets` 列表。
- requirements-coverage 是否触发由风险维度决定；触发时 `writing-plans` 的 `Next skill` 必须指向 `requirements-coverage`。
- plan-review 至少以 `light` 形态触发，且发生在实现前。
- plan-review 后必须停在实现前确认，用户确认前不得写源码。
- HANDOFF 使用 `<next-triggered-gate>` 或明确的下一门禁，不固定套满流程。

### 通过标准

- 不触发的门禁不会被强行生成文档。
- 触发的门禁能读取上一步产物。
- `status.md` 能记录当前 gate 和下一步。
- `human_gates.requirement_confirmation` 和 `implementation_approval` 能记录 `confirmed` / `skipped` 以及 evidence。
- `status.md` 的 `assets` 列表能把需求、计划、覆盖结论和后续审查/验证输入串起来。

## 验证任务 D：标准 L

### 模拟任务

跨架构层传播、改共享契约/协议、多条链路需一致，并且存在需求分支或设计不确定性。

### 期望路径

- 需求边界确认后再进入计划；确认前不得生成 `初步实现计划.md`。
- 用户确认需求后必须使用 `writing-plans` 生成正式计划文档；不得用对话里的实现计划替代。
- writing-plans 后必须自动进入 `requirements-coverage`；覆盖通过后必须自动进入 `plan-review`。
- requirements-coverage 的主产物是 `<FEATURE_ROOT>/<feature-id>/requirements-coverage.md`；默认只把该产物以 `kind: review` 追加进 `status.md` 的 `assets` 列表，不追加 `kind: verification` 资产。
- plan-review、rollback-units 按风险维度触发。
- plan-review 产物必须早于第一处源码修改；实现后的 code-review 不能替代 plan-review。
- 实现前必须在 `[HUMAN GATE:implementation_approval]` 停下。
- 安全审查触发。
- 行为验证必须有运行时或手动证据。
- 完成后按 `rollback-units audit -> code-review -> verification-before-completion -> dev-flow-feature-check --finish` 收尾。

### 通过标准

- 阻塞缺口会停下。
- writing-plans 后没有用户追问也会进入 requirements-coverage。
- requirements-coverage 通过后没有用户追问也会进入 plan-review。
- coverage 不会把 `kind: verification` 资产当作默认副作用写入 `assets`。
- CRITICAL/HIGH 计划审查问题会停下。
- 实现前有明确回撤边界。
- `Auto-continue: no` 后同一回合没有继续写计划或源码。
- 验证报告能证明关键路径。
- feature-check 能拦截缺失验证报告、空命令、空实测、rollback `pending`、不存在资产和 `assets` 里登记的源码条目。
- compact 收尾只留下 `feature.md`、`completion.md` 和可复用手测；full 收尾将原始资产移动到带时间戳 archive。

## 必查文件

按项目适配层展开路径后检查：

```text
<FEATURE_ROOT>/<feature-id>/status.md
<FEATURE_ROOT>/<feature-id>/rollback-units.md
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-manual-test.md
<REVIEW_ROOT>/YYYY-MM-DD-<feature-id>-verification.md
```

并检查 patch 或等价回撤证据：

```text
<FEATURE_ROOT>/<feature-id>/patches/task-N.patch
<FEATURE_ROOT>/<feature-id>/patches/task-N-untracked-files.txt
```

## HUMAN GATE 回归用例

用一个已指定走标准 L 的 fixture 复跑（使用拓扑证据而非场景关键词判断 L）：

- agent 判断为标准 L 后，可以读取源码和生成需求说明，但必须停在 `[HUMAN GATE:requirement_confirmation]`。
- 用户确认需求前，不得生成 `初步实现计划.md`、`requirements-coverage.md`、`rollback-units.md` 或写源码。
- 用户确认需求后，才允许 `writing-plans`；不得先输出一份对话内实现计划然后直接开始执行。
- `writing-plans` 的 handoff 必须把标准 L 交给 `requirements-coverage`。
- `requirements-coverage` 通过后必须把下一步交给 `plan-review`，不得停下来等待用户提醒。
- `plan-review` 必须在第一处源码修改之前完成。
- `plan-review` 和回撤/安全等实现前门禁完成后，必须停在 `[HUMAN GATE:implementation_approval]`。
- 用户确认实现前，不得修改源码、mock、配置或测试文件。
- 如果出现 `auto_continue: false` 后同一回合继续写计划或代码，smoke test 失败。
- 如果实现 Todo 在 `implementation_approval` 前被创建为进行中或 completed，smoke test 失败。

## 宿主项目分类 rubric（人工审查）

以下 5 项验收标准验证规模与风险解耦确实生效：

1. **同一需求、不同真实拓扑**：分类可不同，且各自引用当前宿主项目证据。
2. **不同措辞、同一真实拓扑**：分类应相同或给出明确的事实差异。
3. **导出共享契约变化**：有搜索和分类证据。
4. **私有局部修复**：不被强制调用方搜索。
5. **S + security**：最小风险档案、审批、`risk_evidence`、验证和完成检查均闭环。

## 自检命令

先运行轻量 doctor：

```bash
.claude/skills/dev-flow/scripts/dev-flow-doctor
```

为一个标准 L fixture 运行 feature evidence 检查：

```bash
.claude/skills/dev-flow/scripts/dev-flow-feature-check <feature-id> --finish
```

至少准备一组应失败的 fixture：verification report 缺失、`validation.commands` 为空、manual-test 只有模板、rollback 清单含 `pending`、`assets` 登记源码文件、status 引用不存在资产、风险标签缺 `risk_evidence` 或把最低 gate 写成 `none`。每组都必须返回非零退出码。

再使用 `.claude/rules/project-workflow.md` 中的文档和技能检查命令。至少确认：

- `project-workflow.md` 包含已填充的 `dev_flow` 配置，含 `scoped_spec_root`。
- `risk_evidence` 和 `dev_flow_status` 的字段结构以 `dev-flow/references/protocol.md` 和 `risk-gates.md` 为唯一来源，`project-workflow.md` 未重复维护副本。
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
- human gates:
- manual-test:
- verification:
- assets 列表:
- rollback evidence:

## 需要修正
- ...
```

## 通过后的下一步

smoke test 通过后，用一个真实 M 级任务试跑；再用一个轻量 L 或标准 L 任务验证安全审查、行为验证和回撤证据。不要在 smoke test 失败时直接开始真实高风险任务。

通过后按 [使用指南](./claude-dev-flow-guide.md) 进入日常开发流程。

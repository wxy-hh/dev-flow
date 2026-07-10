---
name: requirements-coverage
description: 对用户原始需求、需求说明书、OpenSpec 产物和实现计划做需求覆盖矩阵审计。dev-flow 在风险维度触发需求覆盖门禁时使用；用户说“需求覆盖”“检查计划有没有漏需求”“需求到任务覆盖矩阵”“只做需求覆盖门禁”“coverage matrix”时使用。
---

# 需求覆盖门禁

用这个技能确认“计划是否完整覆盖需求”。它不审查架构优劣，不替代 `plan-review`，只做需求条目到计划任务、验收方式和验证方式的追踪。

先读取项目适配层。Claude 环境默认读取 `.claude/rules/project-workflow.md`，从中获取 `<FEATURE_ROOT>`、context manifest 路径和验证配置；写文件前再展开为真实路径。

## 核心规则

- 不写业务代码。
- 不把计划质量问题和需求覆盖问题混在一起；架构、安全、规范和文件选择问题交给 `plan-review`。
- 不静默改写需求或计划；默认先输出覆盖缺口和建议。用户要求继续推进时，再把缺口合并回需求说明书或实现计划。
- 如果输入不足以判断覆盖情况，明确说明缺少什么，不要假装通过。
- 如果需求材料内部冲突，先标记 `CONFLICT`，不要用自己的偏好选一个版本继续。

## 资产读取

输入优先级：

1. 用户当前消息中手动引用的路径。
2. 上一步 `[HANDOFF]` 的 `Next inputs`。
3. 当前 feature 目录的约定文件：
   - `<FEATURE_ROOT>/<feature-id>/需求说明书.md`
   - `<FEATURE_ROOT>/<feature-id>/初步实现计划.md`
   - `openspec/changes/<change-id>/proposal.md`
   - `openspec/changes/<change-id>/design.md`
   - `openspec/changes/<change-id>/tasks.md`
   - `openspec/changes/<change-id>/specs/**/*.md`
4. 无明确 feature 时，查找最近修改的 `<FEATURE_ROOT>/*/初步实现计划.md`，再读取同目录需求说明书。

如果只有计划、没有需求来源，只能做“计划自洽性覆盖提示”，不能给出需求覆盖通过结论。

## 流程

1. 提取需求条目。
   - 每条需求必须有稳定编号，如 `REQ-001`。
   - 用户明确说“不做”的内容记录为 `OUT-001`，用于防止计划越界。
2. 提取计划任务。
   - 每个任务必须能指向一个或多个需求编号。
   - 纯技术支撑任务允许没有直接需求，但要标注支撑对象。
3. 建立覆盖矩阵。
4. 标记状态。
5. 输出阻塞缺口和建议修补点。
6. 标准 M/L 中，如果计划审查门禁被风险维度触发，把结论传给 `plan-review`；否则传给下一道已触发门禁或实现前确认。标准 M/L 至少传给 `plan-review`，不得从覆盖门禁直接进入实现。
7. L 级 `full` 形态必须保存到 `<FEATURE_ROOT>/<feature-id>/requirements-coverage.md`；`light` 形态可以只把结论写入对话和 `status.md`。
8. 保存或输出结论后更新 `<FEATURE_ROOT>/<feature-id>/status.md`，记录覆盖门禁状态、`dev_flow_status` 和下一步。
9. 如果 `context/review.jsonl` 已存在，把覆盖矩阵作为 `review` 输入追加一行；不要重写整个 manifest。
10. 默认不创建或更新 `context/verify.jsonl`。只有覆盖报告新增了后续验证必须读取、且计划或验证脚本里没有的明确验证义务时，才追加到 `context/verify.jsonl`，并在输出里说明原因。轻量 M 没有落盘资产时不为 coverage 新建清单。

## 矩阵格式

```markdown
| ID | 需求条目 | 来源 | 对应计划任务 | 验收方式 | 验证命令/检查 | 状态 | 备注 |
|----|----------|------|--------------|----------|----------------|------|------|
| REQ-001 | ... | 原始需求 / 需求说明书 / OpenSpec | Task 1, Task 3 | ... | ... | COVERED | ... |
```

状态只使用这些值：

- `COVERED`：有计划任务、有验收方式、有验证方式。
- `PARTIAL`：有任务但覆盖不完整，或验收/验证缺一项。
- `MISSING`：需求没有对应任务。
- `UNVERIFIABLE`：无法判断如何验收或验证。
- `EXTRA`：计划任务找不到需求来源，且不是明确技术支撑任务。
- `NON_GOAL_OK`：用户明确不做的范围没有被计划触碰。
- `OUT_OF_SCOPE`：计划触碰了用户明确排除的范围。
- `CONFLICT`：需求来源之间或需求内部存在互相冲突的约束。

## 通过和阻塞

通过条件：

- 所有 `REQ-*` 都是 `COVERED`。
- 所有技术支撑任务都有服务对象。
- 所有 `OUT-*` 都是 `NON_GOAL_OK`。
- 没有 `CONFLICT`。

阻塞条件：

- 任一 `MISSING`、`CONFLICT`、`OUT_OF_SCOPE`。
- 标准 M/L 中存在未解释的 `EXTRA`。
- L 级存在 `PARTIAL` 或 `UNVERIFIABLE` 且没有用户明确接受风险。

标准 M 中，少量 `PARTIAL` 可以继续到 `plan-review`，但必须作为审查输入。L 级缺口修复前不要进入实现。

## 输出

输出顺序：

1. 一句话结论：通过 / 有阻塞缺口 / 只能部分判断。
2. 统计：`COVERED`、`PARTIAL`、`MISSING`、`UNVERIFIABLE`、`EXTRA`、`NON_GOAL_OK`、`OUT_OF_SCOPE`、`CONFLICT` 数量。
3. 阻塞项：只列需要用户或计划修订处理的问题。
4. 覆盖矩阵。
5. 建议修订：指出应补到需求、计划或验证里的内容。
6. `[HANDOFF]` 交接块。

轻量 M 可以只在对话里输出简短矩阵。L 级输出必须保存为：

```text
<FEATURE_ROOT>/<feature-id>/requirements-coverage.md
```

交接规则：

- 无阻塞时，交给下一道已触发门禁；标准 M/L 至少交给 `plan-review`，`Auto-continue: yes`。
- 有阻塞时，`Next skill: requirements-coverage`，`Auto-continue: no`，`Stop reason` 写明需要先修订需求或计划。
- 覆盖门禁的主产物只有覆盖结论本身：`requirements-coverage.md`（full）或 `status.md` 里的轻量结论。`status.md` 更新和 `context/review.jsonl` 追加是交接索引，不算新的审查/验证内容产物。

```text
[HANDOFF]
Feature ID: <feature-id>
Level: <M|L>
Current gate: requirements-coverage
Generated assets:
- <FEATURE_ROOT>/<feature-id>/requirements-coverage.md
Updated status:
- <FEATURE_ROOT>/<feature-id>/status.md
Updated manifests:
- <FEATURE_ROOT>/<feature-id>/context/review.jsonl（仅当已存在）
Next skill: <next-triggered-gate>
Next inputs:
- <FEATURE_ROOT>/<feature-id>/status.md
- <FEATURE_ROOT>/<feature-id>/需求说明书.md
- <FEATURE_ROOT>/<feature-id>/初步实现计划.md
- <FEATURE_ROOT>/<feature-id>/requirements-coverage.md
- <FEATURE_ROOT>/<feature-id>/context/review.jsonl
Auto-continue: yes
[/HANDOFF]
```

常见取值：

- 计划审查触发：`Next skill: plan-review`
- 计划审查未触发但回撤单元触发：`Next skill: rollback-units`
- 无其它前置检查门禁触发：`Next skill: plan-review`；标准 M/L 不得从需求覆盖直接进入 `subagent-driven-development` 或 `executing-plans`

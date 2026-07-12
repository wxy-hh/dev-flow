# 风险标签证据契约设计

> 状态：已实施。本文定义的风险标签、最低门禁映射和证据契约已收敛进 `.claude/skills/dev-flow/contract.json` 与 `references/risk-gates.md`，是 0.6 版重构（见 `docs/plans/2026-07-12-dev-flow-v0.6-restructure-design.md`）的输入之一。本文正文不随后续重构改写，作为历史记录保留。

## 目标

修复 `risk-minimal` 的 schema 边界，并让每个风险标签都映射到可机器检查的最低门禁和证据，避免只声明 `security_review: "light"` 就通过完成检查。

保持轻量优先：`light` 门禁不新增独立 Markdown 报告，证据写入已有 `status.md`；`full` 门禁继续使用已有报告资产。

## 契约

### Profile 与等级

- `risk-minimal` 只允许 `level: XS|S`，且必须至少有一个风险标签。
- `level: M|L` 使用 `profile: standard`；可以带风险标签。
- 普通 XS/S 不带风险标签，且不得使用 `risk-minimal`。

### 最低门禁

每个风险标签至少要求以下风险门禁，多个标签取并集：

| 标签 | 最低 gate |
|---|---|
| `security` | `security_review: light`、`behavior_verification: light` |
| `data` | `rollback_units: light`、`behavior_verification: light` |
| `money` | `rollback_units: light`、`behavior_verification: light` |
| `external` | `behavior_verification: light` |
| `availability` | `behavior_verification: light` |
| `critical_correctness` | `behavior_verification: light` |
| `irreversible_consequence` | `rollback_units: light`、`behavior_verification: light` |

项目或任务可以把任一 `light` 升级为 `full`，但不能降为 `none`。

### 证据

在 `dev_flow_status` 中新增机器可读 `risk_evidence` 映射。每个风险标签必须有一个对应条目：

```yaml
risk_evidence:
  security:
    mode: "inline|report"
    conclusion: "非空的审查或验证结论"
    verification: "非空的命令、检查或可定位引用"
    report: "<repo-relative-path，mode=report 时必填>"
```

- `mode: inline`：`conclusion` 和 `verification` 必填；不创建新文件。
- `mode: report`：上述字段必填，`report` 必须为仓库内的现有文件。
- 当标签对应的任一 gate 为 `full` 时，证据必须使用 `mode: report`，并指向相应的现有报告或验证资产。

`completion.md` 继续保留压缩后的风险摘要；它不替代进行中的 `status.md` 证据。

## 实现边界

1. 更新状态模板、流程说明和 doctor 的 schema 锚点。
2. 在 Node 校验器中解析受限的 `risk_labels`、`risk_gates` 和 `risk_evidence`，验证 profile/level 组合、标签合法性、最低 gate、证据字段及报告路径。
3. `dev-flow-feature-check --finish` 调用该校验器，保留现有 full 安全报告、验证报告和回撤检查。
4. 扩展 shell fixture：覆盖有效 XS/S 风险档案、M/L + 风险标签、缺失/错误证据、低于最低 gate、full gate 却使用 inline 证据，以及无风险任务兼容性。

不在本次修改中引入 hook、CI、独立风险报告文件或对业务 diff 自动推断风险标签。

## 失败处理与兼容性

- 新 schema 使用 `schema_version: "2"`；旧 `schema_version: "1"` 状态继续按旧规则读取，避免历史 feature 被误判损坏。
- 新建或明确升级到 v2 的风险任务必须满足新契约。
- 结构不完整、标签未知、门禁不足、`inline` 证据为空、`report` 路径不安全或不存在均让完成检查失败。

## 验收

- `dev-flow-doctor` 通过。
- `dev-flow-feature-check-test` 覆盖上述正反例并通过。
- 现有 v1 的 M/L fixture 和 compact finalized fixture 仍能通过。

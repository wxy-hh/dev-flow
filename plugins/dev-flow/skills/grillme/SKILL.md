---
name: grillme
description: 一问一答压测需求/方案/计划。触发：grillme、grill me、拷问、压测方案、df-grillme、dev-flow-grillme。标准 M/L 的 requirements 步骤内使用。
---

# 方案拷问

存在活跃 feature 时，Dev Flow MCP 仅可用于只读的 `dev_flow_status` 与 `dev_flow_next`。本技能禁止调用任何 MCP mutation、登记 artifact、记录步骤，或 present/confirm HUMAN GATE。登记由 `requirements` 接力。

## 集成需求模式

仅当活跃 feature 为标准 M/L，且当前路线步骤为 `requirements` 时使用本模式。

### 合法写盘顺序

**先确保 requirements 已由 MCP scaffold 并登记**。禁止抢先 Write 未登记路径。
每轮固定顺序：

```text
grillme 更新 requirements front matter 与 Open Questions / Decision Log
  → 交回 requirements
  → requirements 立即 dev_flow_record_artifact(requirements)
  → 输出统一停步话术并等待用户
```

禁止只改文件、不登记就等待。

### 提问准入（须全部满足）

1. 不能从用户原文、截图、代码、现有 Decision Log 或已知设计规范推导；可推导事实直接记为 `Source: codebase`，不问用户。
2. 答案会改变实现路径、范围、不可逆风险或成本；否则写入验收条件。
3. 不与既有用户决定语义重复；同一主题只能有一题（例：背景/低光与 ambient tone 合为一题）。

同一主题子决策合为 2–3 个互斥组合包。每轮只问一个阻塞问题；须给出推荐答案、选项与影响。

### 题数

- 默认最多五个。
- 「截图 + 参考实现 + 明确视觉目标」：`grill_question_limit` 固定为 **3**。
- 仅当出现新架构分支、不可逆风险或预算/配额选择时可扩至 5，并在 Decision Log 记录扩展原因。

### front matter（机器源）

保持 `schema_version: 1`，在 `dev_flow:` 下维护：

```yaml
grill_status: in_progress   # pending | in_progress | complete | not_required
grill_question_id: Q-002
grill_response_hint: "回复 A / B / C，或补充偏好"
grill_question_limit: 3
```

- 第一个未决问题前：`pending` → `in_progress`，并写入当前题字段。
- `complete` / `not_required` 时必须清除 `grill_question_id` 与 `grill_response_hint`。
- 只维护 `## Decision Log` 与 `## Open Questions`；使用稳定 `Q-001...` / `D-001...`。

### 停步话术（登记后、等人前）

```text
当前：<featureId> · <route>
阶段：grill <Q-id>/≤<limit>
为何等待：<不可由仓库推出的决策>
继续：<grill_response_hint>
后续：<压缩剩余 route steps>
```

这是合法等待，不是失败/中断。

无阻塞问题后：`grill_status: complete`，`## Open Questions` 为 `- None`，清除当前题字段，交接 `requirements`（兼容 `df-requirements` / `dev-flow-requirements`）。不要写范围/验收，不做 MCP 状态迁移。

## 显式咨询模式

若没有兼容的活跃 requirements 步骤，仅在对话中压测用户给出的需求或计划。不编辑文件、不变更 Dev Flow 状态，也不替代 `plan-review`。

在 `provided-confirmed` 的 requirements 步骤上显式调用时，使用集成模式。`requirements` 技能必须登记每一次编辑，以便在需要时使既有需求确认哈希失效。

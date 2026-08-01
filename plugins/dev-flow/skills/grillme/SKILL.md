---
name: grillme
description: 一问一答压测需求/方案/计划。触发：grillme、grill me、拷问、压测方案、df-grillme、dev-flow-grillme。标准 M/L 的 requirements 步骤内使用。
---

# 方案拷问

存在活跃 feature 时，Dev Flow MCP 仅可用于只读的 `dev_flow_status` 与 `dev_flow_next`。本技能禁止调用任何 MCP mutation、登记 artifact、记录步骤，或 present/confirm HUMAN GATE。登记由 `requirements` 接力。

## 集成需求模式

仅当活跃 feature 为标准 M/L，且当前路线步骤为 `requirements` 时使用本模式。

### 合法写盘顺序

**先确保 requirements 已由 `dev_flow_scaffold_artifact` scaffold 并登记，再 Read 已登记路径**。随后编辑并交回 `requirements` 调用 `dev_flow_record_artifact_with_trace`；禁止抢先 Write 未登记路径。
每轮固定顺序：

```text
grillme 更新 requirements front matter 与 Open Questions / Decision Log
  → 交回 requirements
  → requirements 立即 dev_flow_record_artifact_with_trace(requirements, REQ/AC delta)
  → requirements 调用 dev_flow_request_grill_decision 展示选择控件或一次性回复
```

禁止只改文件、不登记就等待。

### 提问准入（须全部满足）

1. 不能从用户原文、截图、代码、现有 Decision Log 或已知设计规范推导；可推导事实直接记为 `Source: codebase`，不问用户。
2. 答案会改变实现路径、范围、不可逆风险或成本；否则写入验收条件。
3. 不与既有用户决定语义重复；同一主题只能有一题（例：背景/低光与 ambient tone 合为一题）。

同一主题子决策合为 2–3 个互斥组合包。每轮只问一个阻塞问题；须给出推荐答案、选项与影响。交接 requirements 时同时给出稳定小写 action ID（如 `hosted`、`self-hosted`），并总是加入 `other`（标签“其他 / 补充”，`requiresComment: true`）；供 `dev_flow_request_grill_decision` 直接渲染。

回答含糊或偏离时：先复述理解并重申推荐答案，请用户确认或纠正；不新增题号。

### 清单预批

接手时先 Read 已登记 requirements，一次性产出完整决策树清单 `Q-001..Q-00N`（一行一题：主题 + 一句话推荐答案，按依赖排序；题数不限）。本轮保持 `grill_status: pending`、不写当前题字段、不交回 requirements 登记——纯对话等待。

用户可批准 / 合并 / 裁剪 / 补充清单；无异议后写 `Q-001` 并转 `in_progress`，交回 requirements 走登记 + `dev_flow_request_grill_decision` 链路。后续回合续写已有清单与 Decision Log，不要重开访谈。

### 题数

- 无固定上限：跟随清单走到用户确认为止，不做题数自限。
- 每轮仍只问一个阻塞问题；每轮选项由 core 自动注入「合并剩余」（`merge-remaining`）——点选即按推荐答案一次确认当前题与剩余全部问题，无需逐题继续。
- 「截图 + 参考实现 + 明确视觉目标」：默认 3 题，超出即回到清单核对，不强求压到 3。
- 收敛裁判是用户：由用户显式确认「剩余清单无需再问」或选择「合并剩余」结束，不由模型自判 complete。

### front matter（机器源）

保持 `schema_version: 1`，在 `dev_flow:` 下维护：

```yaml
grill_status: in_progress   # pending | in_progress | complete | not_required
grill_question_id: Q-002
grill_response_hint: "等待结构化选项；无控件时由 requirements 提供一次性回复"
```

- 清单预批轮保持 `pending` 且无当前题字段；清单批准后 `pending` → `in_progress`，写入 `grill_question_id` 与 `grill_response_hint`。
- `complete` / `not_required` 时必须清除 `grill_question_id` 与 `grill_response_hint`。
- 只维护 `## Decision Log` 与 `## Open Questions`；使用稳定 `Q-001...` / `D-001...`。

### 停步话术（登记后、等人前）

逐题轮：

```text
Q-00N：<问题>

A. <方案A>（推荐）
B. <方案B>
C. 其他（补充说明）

回复 A/B/C（或方案名称），也可以直接说出你的想法
```

清单预批轮：

```text
当前：<featureId> · <route>
阶段：grill 清单预批（Q-001..Q-00N）
为何等待：等待批准 / 合并 / 裁剪决策清单
继续：确认清单或提出裁剪；批准后从 Q-001 开始逐题确认
后续：<压缩剩余 route steps>
```

这是合法等待，不是失败/中断。

剩余清单清空后：出示空剩余清单与 Decision Log 摘要，请用户确认「无剩余问题」；用户确认后才 `grill_status: complete`、`## Open Questions` 为 `- None`、清除当前题字段，交接 `requirements`（兼容 `df-requirements` / `dev-flow-requirements`）。用户未确认不得 complete。不要写范围/验收，不做 MCP 状态迁移。

## 显式咨询模式

若没有兼容的活跃 requirements 步骤，仅在对话中压测用户给出的需求或计划。不编辑文件、不变更 Dev Flow 状态，也不替代 `plan-review`。

在 `provided-confirmed` 的 requirements 步骤上显式调用时，使用集成模式。`requirements` 技能必须登记每一次编辑，以便在需要时使既有需求确认哈希失效。
